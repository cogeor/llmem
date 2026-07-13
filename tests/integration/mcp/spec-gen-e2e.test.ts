/**
 * Stdio JSON-RPC integration test for the MCP spec-gen workflow.
 *
 * This is the first integration test that goes past server bootstrap into
 * real `tools/call` traffic. It spawns the actual `llmem mcp` subprocess
 * (the same code path Claude Code drives in production), connects via the
 * SDK's `Client` + `StdioClientTransport`, and exercises three protocol
 * round-trips against a fresh temp workspace:
 *
 *   1. `tools/list` — asserts exactly the five trimmed tools survive,
 *      and that `inspect_source` is gone (locks in Loop 01).
 *   2. `file_info` → `report_file_info` — proves the file-doc pair
 *      writes `.llmem/docs/<path>.md` containing the stub's overview/purpose
 *      text.
 *   3. `folder_info` → `report_folder_info` — proves the folder-doc
 *      pair writes `.llmem/docs/<folder>/README.md` containing the stub's
 *      overview/architecture/key-file strings.
 *
 * Design choices (cross-platform + isolation):
 *
 * - Spawns via `process.execPath` with args `['./bin/llmem', 'mcp']`,
 *   never the shim directly — on Windows `child_process.spawn` cannot
 *   exec the `#!/usr/bin/env node` shebang natively. Same convention as
 *   `cli-serve-zero-config.test.ts:117`.
 * - Sets `LLMEM_WORKSPACE` explicitly to the temp dir. Without this,
 *   `detectWorkspaceRoot()` in `src/mcp/main.ts` walks up from cwd
 *   and would happily find the llmem repo itself (which has `.git`,
 *   `package.json`, `.arch`, every marker), polluting the repo with a
 *   real `.llmem/docs/` write.
 * - Uses the SDK `Client` + `StdioClientTransport` — never hand-frames
 *   JSON-RPC. MCP stdio uses newline-delimited JSON-RPC (confirmed in
 *   LOOPS.yaml notes) so the SDK transport handles framing internally.
 * - `client.connect(transport)` runs the MCP `initialize` handshake
 *   automatically; no manual initialize.
 * - Fresh workspace per test (`t.before`/`t.after` via the helper). Each
 *   `test()` block gets its own tempDir + client so cleanup is
 *   independent and assertions don't leak across blocks.
 * - All `.llmem/docs/` assertion paths are `path.join(tempDir, ...)`, never
 *   relative — the test must never write under the llmem repo.
 * - First `callTool` after handshake uses a 10s timeout to absorb lazy
 *   parser registry init (the first `file_info` after a cold spawn
 *   pays a 1-3s init cost).
 * - `stderr: 'pipe'` keeps the child's logger output off the test
 *   runner's console; we tee stderr into a buffer and surface it in
 *   assertion messages so failures stay diagnosable.
 */

import { test, type TestContext } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ============================================================================
// Repo + build gate
// ============================================================================

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:entrypoints\` before running the integration suite.`,
        );
    }
}

// ============================================================================
// Fixture builder
// ============================================================================

interface Fixture {
    tempDir: string;
    /** posix-style relative path the MCP `RelPath` schema expects */
    fixtureFile: string;
    /** posix-style relative folder path */
    fixtureFolder: string;
}

/**
 * Build a minimal 2-file TypeScript workspace at `os.tmpdir()`, with a
 * `.git/` marker so the server's auto-detect would also find it (we set
 * `LLMEM_WORKSPACE` explicitly, but the marker is belt-and-suspenders).
 *
 * Also seeds an empty `.llmem/graph/` directory. Historically `folder_info`
 * hard-failed with "Artifacts directory not found ... run 'npm run scan'
 * first" if the directory was missing; LS-06 removed that throw —
 * `refreshFolderGraph` now creates the artifact root on demand. The seed is
 * kept as harmless belt-and-suspenders. This test exercises the protocol +
 * docs-writer; refresh parses the two fixture files into a small graph, which
 * is irrelevant to the assertions below (they check the prompt + written doc).
 *
 * Returns posix-style relative paths because that's what the MCP schemas
 * accept across platforms.
 */
function createFixtureWorkspace(): Fixture {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-mcp-e2e-'));
    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.llmem', 'graph'), { recursive: true });

    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
        path.join(srcDir, 'b.ts'),
        "export function helloB(): string { return 'b'; }\n",
        'utf8',
    );
    fs.writeFileSync(
        path.join(srcDir, 'a.ts'),
        "import { helloB } from './b';\nexport function helloA(): string { return helloB() + 'a'; }\n",
        'utf8',
    );

    return {
        tempDir,
        fixtureFile: 'src/a.ts',
        fixtureFolder: 'src',
    };
}

// ============================================================================
// Client wiring
// ============================================================================

interface StartedClient {
    client: Client;
    transport: StdioClientTransport;
    /** Tee'd stderr buffer (so we can surface it in assertion messages). */
    stderrBuf: { value: string };
}

/**
 * Build the env object passed to the spawned MCP server. The SDK transport
 * types `env` as `Record<string, string>`, so we must strip `undefined`
 * entries from `process.env`. We then layer in `LLMEM_WORKSPACE` (pins the
 * server's workspace to the temp dir) and `FORCE_COLOR=0` (keeps log
 * output ANSI-clean if anything ever surfaces it).
 */
function buildSpawnEnv(tempDir: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value === 'string') {
            env[key] = value;
        }
    }
    env.LLMEM_WORKSPACE = tempDir;
    env.FORCE_COLOR = '0';
    return env;
}

async function startMcpClient(tempDir: string): Promise<StartedClient> {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [BIN, 'mcp'],
        env: buildSpawnEnv(tempDir),
        cwd: tempDir,
        stderr: 'pipe',
    });

    // Tee child stderr into a buffer for diagnostics. The transport
    // exposes a PassThrough stream when `stderr: 'pipe'` is requested,
    // and the SDK doc note guarantees the stream is created before
    // `start()` so we can attach the listener immediately.
    const stderrBuf = { value: '' };
    const stderrStream = transport.stderr;
    if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer | string) => {
            stderrBuf.value += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        });
    }

    const client = new Client(
        { name: 'llmem-e2e-test', version: '0.0.0' },
        { capabilities: {} },
    );

    // connect() spawns the child via the transport AND runs the MCP
    // `initialize` handshake automatically. The first tools/call after
    // this resolves is safe.
    await client.connect(transport);

    return { client, transport, stderrBuf };
}

// ============================================================================
// Per-test setup + teardown
// ============================================================================

interface E2ESetup {
    client: Client;
    tempDir: string;
    fixtureFile: string;
    fixtureFolder: string;
    /** Captured stderr from the child — surface this in failure messages. */
    stderrBuf: { value: string };
}

async function setupSpecGenE2E(t: TestContext): Promise<E2ESetup> {
    ensureBuilt();
    const fixture = createFixtureWorkspace();
    const started = await startMcpClient(fixture.tempDir);

    t.after(async () => {
        try {
            await started.client.close();
        } catch {
            // Best-effort: client.close() kills the child + closes the
            // transport. If the child already exited (e.g. failed
            // bootstrap), close() can reject — swallow it.
        }
        try {
            fs.rmSync(fixture.tempDir, { recursive: true, force: true });
        } catch {
            // Windows file-watcher races on a freshly-killed child can
            // transiently hold handles. `force: true` already best-effort
            // covers it; swallow remaining errors.
        }
    });

    return {
        client: started.client,
        tempDir: fixture.tempDir,
        fixtureFile: fixture.fixtureFile,
        fixtureFolder: fixture.fixtureFolder,
        stderrBuf: started.stderrBuf,
    };
}

// ============================================================================
// Response payload helpers
// ============================================================================

interface TextContent {
    type: 'text';
    text: string;
}

/**
 * The server wraps every tool response in `{ content: [{ type: 'text',
 * text: JSON.stringify(mcpResponse) }] }` (see `src/mcp/server.ts:228-235`).
 * Strip that envelope and return the actual MCP response payload.
 *
 * The SDK's `callTool` return type is a union of `{ content, isError? }`
 * and a legacy `{ toolResult }` shape, so we accept `unknown` and narrow
 * inside. Also asserts `isError !== true` as a fast-fail before parsing
 * — if the server flagged the call as an error, the inner JSON is an
 * error response and we want a clear assertion failure rather than a
 * vague "status === 'success' failed" deeper in the test.
 */
function unwrapToolResult(
    result: unknown,
    diagnostic: { stderr: string },
): Record<string, unknown> {
    assert.ok(
        typeof result === 'object' && result !== null,
        `tool call result was not an object: ${JSON.stringify(result)}`,
    );
    const obj = result as { isError?: boolean; content?: unknown };
    assert.ok(
        obj.isError !== true,
        `tool call returned isError. Result: ${JSON.stringify(result)}. Child stderr:\n${diagnostic.stderr}`,
    );
    const content = obj.content as TextContent[] | undefined;
    assert.ok(
        Array.isArray(content) && content.length > 0 && content[0].type === 'text',
        `expected content[0] to be a text part, got: ${JSON.stringify(obj.content)}`,
    );
    const text = content[0].text;
    return JSON.parse(text) as Record<string, unknown>;
}

// ============================================================================
// Tests
// ============================================================================

test('MCP spec-gen e2e: tools/list returns exactly the 7 trimmed tools', async (t) => {
    const { client, stderrBuf } = await setupSpecGenE2E(t);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    assert.deepEqual(
        names,
        [
            'file_info',
            'folder_info',
            'open_window',
            'report_file_info',
            'report_folder_info',
            'report_review',
            'review',
        ],
        `tools/list returned unexpected name set. Child stderr:\n${stderrBuf.value}`,
    );

    // Explicit negative for diagnostic clarity if Loop 01 ever regresses.
    assert.ok(
        !names.includes('inspect_source'),
        'inspect_source must be dropped (loop 01)',
    );
});

test('MCP spec-gen e2e: file_info → report_file_info writes .llmem/docs/<path>.md', async (t) => {
    const { client, tempDir, fixtureFile, stderrBuf } = await setupSpecGenE2E(t);

    // First call: 10s timeout absorbs lazy parser registry init.
    const fileInfoResult = await client.callTool(
        { name: 'file_info', arguments: { workspaceRoot: tempDir, path: fixtureFile } },
        undefined,
        { timeout: 10_000 },
    );
    const fileInfoPayload = unwrapToolResult(fileInfoResult, { stderr: stderrBuf.value });

    assert.equal(
        fileInfoPayload.status,
        'prompt_ready',
        `file_info status should be prompt_ready: ${JSON.stringify(fileInfoPayload)}`,
    );
    const promptForHostLLM = fileInfoPayload.promptForHostLLM;
    assert.ok(
        typeof promptForHostLLM === 'string' && promptForHostLLM.length > 0,
        'file_info should return a non-empty promptForHostLLM',
    );
    assert.equal(fileInfoPayload.callbackTool, 'report_file_info');
    const callbackArgs = fileInfoPayload.callbackArgs as { workspaceRoot: string; path: string };
    assert.equal(callbackArgs.workspaceRoot, tempDir);
    assert.equal(callbackArgs.path, fixtureFile);

    // Stub the LLM step — matches ReportFileInfoSchema.
    const stub = {
        workspaceRoot: tempDir,
        path: fixtureFile,
        overview: 'STUB-OVERVIEW: a.ts re-exports helloA which calls helloB.',
        functions: [
            {
                name: 'helloA',
                purpose: 'STUB-PURPOSE: returns helloB() + a',
                implementation: 'STUB-IMPL: calls helloB, concatenates "a".',
            },
        ],
    };

    const reportResult = await client.callTool(
        { name: 'report_file_info', arguments: stub },
        undefined,
        { timeout: 10_000 },
    );
    const reportPayload = unwrapToolResult(reportResult, { stderr: stderrBuf.value });

    assert.equal(
        reportPayload.status,
        'success',
        `report_file_info status should be success: ${JSON.stringify(reportPayload)}`,
    );
    const reportData = reportPayload.data as { artifactPath?: unknown };
    assert.equal(
        typeof reportData.artifactPath,
        'string',
        `report_file_info should return an artifactPath string: ${JSON.stringify(reportData)}`,
    );

    // Matches getFileDocPath in src/docs/doc-store.ts:32-34
    // → .llmem/docs/{src}.md, so .llmem/docs/src/a.ts.md.
    const docPath = path.join(tempDir, '.llmem', 'docs', 'src', 'a.ts.md');
    assert.ok(
        fs.existsSync(docPath),
        `expected ${docPath} to exist after report_file_info. Child stderr:\n${stderrBuf.value}`,
    );

    const content = fs.readFileSync(docPath, 'utf8');
    assert.ok(content.includes('STUB-OVERVIEW'), `archived doc missing STUB-OVERVIEW: ${content}`);
    assert.ok(content.includes('STUB-PURPOSE'), `archived doc missing STUB-PURPOSE: ${content}`);
    assert.ok(content.includes('helloA'), `archived doc missing helloA: ${content}`);
});

test('MCP spec-gen e2e: folder_info → report_folder_info writes .llmem/docs/<folder>/README.md', async (t) => {
    const { client, tempDir, fixtureFolder, stderrBuf } = await setupSpecGenE2E(t);

    const folderInfoResult = await client.callTool(
        { name: 'folder_info', arguments: { workspaceRoot: tempDir, path: fixtureFolder } },
        undefined,
        { timeout: 10_000 },
    );
    const folderInfoPayload = unwrapToolResult(folderInfoResult, { stderr: stderrBuf.value });

    assert.equal(
        folderInfoPayload.status,
        'prompt_ready',
        `folder_info status should be prompt_ready: ${JSON.stringify(folderInfoPayload)}`,
    );
    const folderPrompt = folderInfoPayload.promptForHostLLM;
    assert.ok(
        typeof folderPrompt === 'string' && folderPrompt.length > 0,
        'folder_info should return a non-empty promptForHostLLM',
    );
    assert.equal(folderInfoPayload.callbackTool, 'report_folder_info');

    const folderStub = {
        workspaceRoot: tempDir,
        path: fixtureFolder,
        overview: 'STUB-FOLDER-OVERVIEW: src contains a.ts and b.ts.',
        key_files: [
            { name: 'a.ts', summary: 'STUB-KEYFILE-A: re-exports helloA.' },
            { name: 'b.ts', summary: 'STUB-KEYFILE-B: exports helloB.' },
        ],
        architecture: 'STUB-ARCH: a.ts imports b.ts; both export trivial string functions.',
    };

    const reportResult = await client.callTool(
        { name: 'report_folder_info', arguments: folderStub },
        undefined,
        { timeout: 10_000 },
    );
    const reportPayload = unwrapToolResult(reportResult, { stderr: stderrBuf.value });

    assert.equal(
        reportPayload.status,
        'success',
        `report_folder_info status should be success: ${JSON.stringify(reportPayload)}`,
    );
    const reportData = reportPayload.data as { artifactPath?: unknown };
    assert.equal(
        typeof reportData.artifactPath,
        'string',
        `report_folder_info should return an artifactPath string: ${JSON.stringify(reportData)}`,
    );

    // Matches getFolderDocPath in src/docs/doc-store.ts:36-38
    // → .llmem/docs/{src}/README.md, so .llmem/docs/src/README.md.
    const readmePath = path.join(tempDir, '.llmem', 'docs', 'src', 'README.md');
    assert.ok(
        fs.existsSync(readmePath),
        `expected ${readmePath} to exist after report_folder_info. Child stderr:\n${stderrBuf.value}`,
    );

    const content = fs.readFileSync(readmePath, 'utf8');
    assert.ok(content.includes('STUB-FOLDER-OVERVIEW'), `folder readme missing STUB-FOLDER-OVERVIEW: ${content}`);
    assert.ok(content.includes('STUB-ARCH'), `folder readme missing STUB-ARCH: ${content}`);
    assert.ok(content.includes('a.ts'), `folder readme missing a.ts: ${content}`);
    assert.ok(content.includes('b.ts'), `folder readme missing b.ts: ${content}`);
});
