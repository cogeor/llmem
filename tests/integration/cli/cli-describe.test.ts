/**
 * Integration test for `bin/llmem describe [--json]`.
 *
 * Loop 04 contract:
 *   1. `describe` (no flags) exits 0 and lists every non-hidden REGISTRY
 *      command name in stdout.
 *   2. `describe --json` exits 0 and emits valid JSON parseable as the
 *      DescribeOutput shape (version / binary / commands).
 *   3. The JSON validates against an in-test meta-schema (Zod) — every
 *      command has at least one example, every command has a non-empty
 *      description, every command's args is a JSON-schema object.
 *   4. Every non-hidden REGISTRY command name appears in the JSON, and no
 *      orphan commands appear that are not in REGISTRY.
 *   5. No orphan flag: every property in `cmd.args.properties` exists in
 *      the corresponding REGISTRY entry's Zod schema shape.
 *   6. The spawned-process JSON output deep-equals the in-process
 *      `buildDescribeOutput()` return value (modulo serialization).
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim.
 * - Stdout is normalized via `.replace(/\r\n/g, '\n')` before any string
 *   assertion or `JSON.parse` (Windows `node` may emit `\r\n` line
 *   endings into pipes).
 * - `FORCE_COLOR=0` in the spawn env so the structured logger doesn't
 *   inject ANSI codes if `describe` ever logs through it (it currently
 *   doesn't, but defensive).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { z } from 'zod';

import { REGISTRY } from '../../../src/claude/cli/registry';
import { buildDescribeOutput } from '../../../src/claude/cli/commands/describe';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

function normalizeStdout(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

function spawnDescribe(extraArgs: string[] = []): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync('node', [BIN, 'describe', ...extraArgs], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    return {
        stdout: normalizeStdout(result.stdout ?? ''),
        stderr: normalizeStdout(result.stderr ?? ''),
        status: result.status,
    };
}

// -----------------------------------------------------------------------------
// Meta-schema (defined in the test, not imported from source — this is the
// regression catcher for source-side schema drift).
// -----------------------------------------------------------------------------
const ExampleSchema = z.object({
    scenario: z.string().min(1),
    command: z.string().min(1),
});
const CommandEntrySchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    args: z.object({}).passthrough(),
    examples: z.array(ExampleSchema).min(1),
});
const DescribeOutputSchema = z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+/),
    binary: z.literal('llmem'),
    commands: z.array(CommandEntrySchema).min(1),
});

test('bin/llmem describe (no flags) exits 0 and lists every non-hidden command name', () => {
    ensureBuilt();
    const { stdout, stderr, status } = spawnDescribe();
    assert.equal(status, 0, `expected exit 0, got ${status}; stderr=${stderr}`);

    for (const cmd of REGISTRY) {
        if (cmd.hidden) continue;
        assert.match(stdout, new RegExp(`\\b${cmd.name}\\b`), `human tree mentions '${cmd.name}'`);
    }
    // Forward-compat: when a command is hidden, its name must not appear as a
    // word token in the human tree. Loop 07 exercises this for `generate` and
    // `stats`. Use a word-boundary regex (NOT `stdout.includes`) so an English
    // word like "Generate" embedded in another command's description (e.g.
    // `document`'s "Generate the LLM prompt...") does not produce a false
    // positive — the contract is about command identifiers, not English usage.
    for (const cmd of REGISTRY) {
        if (!cmd.hidden) continue;
        assert.ok(
            !new RegExp(`\\b${cmd.name}\\b`).test(stdout),
            `hidden command '${cmd.name}' must not appear as a word token`,
        );
    }
});

test('bin/llmem describe --json exits 0 and emits valid JSON', () => {
    ensureBuilt();
    const { stdout, stderr, status } = spawnDescribe(['--json']);
    assert.equal(status, 0, `expected exit 0, got ${status}; stderr=${stderr}`);
    assert.doesNotThrow(() => JSON.parse(stdout));
});

test('bin/llmem describe --json output validates against meta-schema', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    DescribeOutputSchema.parse(parsed);
});

test('every non-hidden REGISTRY command appears in describe --json (no missing, no orphan)', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as { commands: { name: string }[] };

    const expected = REGISTRY.filter(c => !c.hidden).map(c => c.name).sort();
    const actual = parsed.commands.map(c => c.name).sort();
    assert.deepEqual(actual, expected);
});

test('no orphan flags — every cmd.args.properties key matches the REGISTRY Zod shape', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as {
        commands: { name: string; args: { properties?: Record<string, unknown> } }[];
    };

    for (const describedCmd of parsed.commands) {
        const registryEntry = REGISTRY.find(c => c.name === describedCmd.name);
        assert.ok(registryEntry, `described command '${describedCmd.name}' has a REGISTRY entry`);
        const argsSchema = registryEntry.args;
        assert.ok(
            argsSchema instanceof z.ZodObject,
            `REGISTRY entry '${describedCmd.name}' uses a ZodObject schema`,
        );
        const shape = (argsSchema as z.ZodObject<z.ZodRawShape>).shape;
        const shapeKeys = new Set(Object.keys(shape));
        const propKeys = Object.keys(describedCmd.args.properties ?? {});
        for (const key of propKeys) {
            assert.ok(
                shapeKeys.has(key),
                `flag '${key}' on command '${describedCmd.name}' exists in the Zod shape`,
            );
        }
    }
});

test('spawned describe --json deep-equals in-process buildDescribeOutput()', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const fromSpawn = JSON.parse(stdout);
    const fromInProcess = JSON.parse(JSON.stringify(buildDescribeOutput()));
    assert.deepEqual(fromSpawn, fromInProcess);
});

// -----------------------------------------------------------------------------
// Loop 07: explicit hidden-command behavior. Two assertions on top of the
// REGISTRY-derived parity tests above. The previous tests pass when the
// REGISTRY-vs-described sets agree; these two pin the loop-07 contract that
// (a) `generate` and `stats` are absent from `describe --json`, and (b) the
// commands remain callable despite being hidden — `findCommand` looks them
// up by name regardless of `hidden`.
// -----------------------------------------------------------------------------

test('generate and stats are hidden — absent from describe --json', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as { commands: { name: string }[] };
    assert.equal(
        parsed.commands.find(c => c.name === 'generate'),
        undefined,
        '`generate` must not appear in describe --json (hidden in loop 07)',
    );
    assert.equal(
        parsed.commands.find(c => c.name === 'stats'),
        undefined,
        '`stats` must not appear in describe --json (hidden in loop 07)',
    );
});

test('generate and stats remain callable despite being hidden', () => {
    ensureBuilt();

    // Build a tmp workspace seeded with minimal edge lists so `generate` /
    // `stats` find what they expect (`hasEdgeLists` is just a file
    // existence check). Inline rather than reusing a helper — the test is
    // narrow enough that an extracted utility would obscure the intent.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-hidden-'));
    try {
        fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8');
        const artifactDir = path.join(tmp, '.artifacts');
        fs.mkdirSync(artifactDir, { recursive: true });
        // Edge-list shape is the v1 wire shape from `edgelist-schema.ts`
        // (schemaVersion: 1, plus nodes/edges arrays + timestamp). An empty
        // edge list parses cleanly — `generate` will render an empty webview,
        // `stats` will report all zeros.
        const emptyEdgelist = JSON.stringify({
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            nodes: [],
            edges: [],
        });
        fs.writeFileSync(path.join(artifactDir, 'import-edgelist.json'), emptyEdgelist, 'utf8');
        fs.writeFileSync(path.join(artifactDir, 'call-edgelist.json'), emptyEdgelist, 'utf8');

        // `generate` exits 0 — hiding does not gate dispatch.
        const gen = spawnSync('node', [BIN, 'generate', '--workspace', tmp], {
            encoding: 'utf8',
            env: { ...process.env, FORCE_COLOR: '0', LOG_LEVEL: 'error' },
        });
        const genStdout = (gen.stdout ?? '').replace(/\r\n/g, '\n');
        const genStderr = (gen.stderr ?? '').replace(/\r\n/g, '\n');
        assert.equal(
            gen.status, 0,
            `expected generate to exit 0 (hidden but callable); stdout=${genStdout}\nstderr=${genStderr}`,
        );

        // `stats` exits 0 with the statistics header.
        const stats = spawnSync('node', [BIN, 'stats', '--workspace', tmp], {
            encoding: 'utf8',
            env: { ...process.env, FORCE_COLOR: '0', LOG_LEVEL: 'error' },
        });
        const statsStdout = (stats.stdout ?? '').replace(/\r\n/g, '\n');
        const statsStderr = (stats.stderr ?? '').replace(/\r\n/g, '\n');
        assert.equal(
            stats.status, 0,
            `expected stats to exit 0 (hidden but callable); stdout=${statsStdout}\nstderr=${statsStderr}`,
        );
        assert.ok(
            statsStdout.includes('Graph Statistics:'),
            `stats should still print its header; got:\n${statsStdout}`,
        );
    } finally {
        try {
            fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
            // Best-effort cleanup — Windows file watchers can delay release.
        }
    }
});
