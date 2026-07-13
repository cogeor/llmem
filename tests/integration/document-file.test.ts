// tests/integration/document-file.test.ts
//
// Loop 07 regression test for the README "Known Issue" workaround.
//
// The legacy `report_file_info` MCP handler relied on `getWorkspaceRoot()`
// (artifact/service) which sometimes returned a misleading default. The
// prompt template told the agent to manually copy the saved file from
// the wrong location into the workspace.
//
// Loop 07's fix: every entry to `application/document-file::processFileInfoReport`
// takes a branded `WorkspaceRoot`, and that brand is the only source of
// truth. Even when `process.cwd()` points elsewhere, the file lands in
// `<workspaceRoot>/.arch/`.
//
// Loop 04: `processFileInfoReport` now takes `(ctx, request)`. The
// `WorkspaceContext` carries the branded workspace root, and that is
// still the only source of truth.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    processFileInfoReport,
    buildDocumentFilePrompt,
} from '../../src/application/document-file';
import { asRelPath } from '../../src/core/paths';
import { createWorkspaceContext } from '../../src/application/workspace-context';
import {
    ImportEdgeListStore,
    CallEdgeListStore,
} from '../../src/graph/edgelist';

function makeTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('processFileInfoReport writes to workspaceRoot/.arch, never elsewhere', async () => {
    const tmpRoot = makeTmp('llmem-doc-file-root-');
    const fakeAppData = makeTmp('llmem-doc-file-other-');

    // Point process.cwd at a different temp dir to simulate the legacy
    // bug condition. The branded workspaceRoot must take precedence.
    const originalCwd = process.cwd();
    process.chdir(fakeAppData);
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await processFileInfoReport(ctx, {
            filePath: asRelPath('src/foo.ts'),
            overview: 'Sample overview',
            functions: [
                { name: 'foo', purpose: 'does foo', implementation: '- step 1\n- step 2' },
            ],
        });

        // The docPath must be inside tmpRoot, not in process.cwd() (fakeAppData).
        const tmpRootResolved = fs.realpathSync(tmpRoot);
        const fakeAppDataResolved = fs.realpathSync(fakeAppData);
        const archPathResolved = fs.realpathSync(result.docPath);

        assert.ok(
            archPathResolved.startsWith(tmpRootResolved),
            `docPath ${archPathResolved} must start with tmpRoot ${tmpRootResolved}`,
        );
        assert.ok(
            !archPathResolved.startsWith(fakeAppDataResolved),
            `docPath ${archPathResolved} must NOT start with fakeAppData ${fakeAppDataResolved}`,
        );

        // The file must actually exist at docPath.
        assert.ok(fs.existsSync(result.docPath), `docPath must exist on disk: ${result.docPath}`);

        // And the docs directory must be inside tmpRoot.
        const expectedArch = path.join(tmpRoot, '.llmem', 'docs', 'src', 'foo.ts.md');
        assert.equal(
            path.resolve(result.docPath),
            path.resolve(expectedArch),
            'docPath must equal <tmpRoot>/.llmem/docs/src/foo.ts.md',
        );

        // Sanity: contents include the overview text.
        const contents = fs.readFileSync(result.docPath, 'utf-8');
        assert.ok(
            contents.includes('Sample overview'),
            'design document must include the supplied overview',
        );
        assert.ok(
            contents.includes('# DESIGN DOCUMENT: src/foo.ts'),
            'design document must include the header',
        );
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.rmSync(fakeAppData, { recursive: true, force: true });
    }
});

test('processFileInfoReport bytesWritten matches utf-8 byte length', async () => {
    const tmpRoot = makeTmp('llmem-doc-file-bytes-');
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await processFileInfoReport(ctx, {
            filePath: asRelPath('a/b/c.ts'),
            overview: 'overview',
            functions: [],
        });
        const stat = fs.statSync(result.docPath);
        assert.equal(result.bytesWritten, stat.size);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('buildDocumentFilePrompt on a never-scanned file refreshes that file\'s edges (LS-08)', async () => {
    const tmpRoot = makeTmp('llmem-doc-file-cold-');
    try {
        // A source file with an import + a function so the refresh produces
        // at least one node/edge in the stores.
        const srcDir = path.join(tmpRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(
            path.join(srcDir, 'a.ts'),
            "import { helper } from './b';\nexport function run() { return helper(); }\n",
            'utf-8',
        );

        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });

        const data = await buildDocumentFilePrompt(ctx, {
            filePath: asRelPath('src/a.ts'),
        });

        // The normal prompt shape is preserved (no caveat for a clean file).
        assert.ok(
            data.prompt.includes('# DESIGN DOCUMENT GENERATION TASK'),
            'prompt header must be present',
        );
        assert.ok(
            !data.prompt.includes('COVERAGE NOTES'),
            'a clean file must NOT carry a coverage caveat',
        );

        // The refresh populated the edge stores: the file node exists.
        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
        await importStore.load();
        const nodeFiles = importStore.getNodes().map((n) => n.fileId);
        assert.ok(
            nodeFiles.includes('src/a.ts'),
            `import store must contain a node for src/a.ts; got ${nodeFiles.join(', ')}`,
        );
        const importTargets = importStore.getEdges().map((e) => e.target);
        assert.ok(
            importTargets.some((t) => t.includes('b')),
            `import edge for ./b must be present; got ${importTargets.join(', ')}`,
        );

        // The call store is created too (cold refresh saved both).
        const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
        await callStore.load();
        assert.ok(
            callStore.getNodes().length > 0,
            'call store must have nodes after a cold refresh',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('buildDocumentFilePrompt on an over-line file emits the COVERAGE NOTES caveat (LS-08)', async () => {
    const tmpRoot = makeTmp('llmem-doc-file-overline-');
    try {
        const srcDir = path.join(tmpRoot, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        // 6 trivial lines; configure maxFileLines = 3 so the file is gated.
        fs.writeFileSync(
            path.join(srcDir, 'big.ts'),
            'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\nconst f = 6;\n',
            'utf-8',
        );

        const ctx = await createWorkspaceContext({
            workspaceRoot: tmpRoot,
            configOverrides: { maxFileLines: 3 },
        });

        const data = await buildDocumentFilePrompt(ctx, {
            filePath: asRelPath('src/big.ts'),
        });

        // The §7 caveat is appended, using the SHARED renderCoverageCaveat
        // wording (line-limit reason renders the LIMIT).
        assert.ok(
            data.prompt.includes('## ⚠️ COVERAGE NOTES (graph may be incomplete)'),
            'over-line file must carry the coverage caveat header',
        );
        assert.ok(
            data.prompt.includes('src/big.ts — exceeds line limit (3)'),
            'caveat must name the over-line file with the configured limit',
        );

        // The gated file's edges are NOT in the stores (it was not parsed).
        const importStore = new ImportEdgeListStore(ctx.artifactRoot, ctx.io);
        await importStore.load();
        const hasBig = importStore
            .getNodes()
            .some((n) => n.fileId === 'src/big.ts');
        assert.ok(!hasBig, 'an over-line file must NOT be parsed into the graph');
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('processFileInfoReport refuses path-escape (../../..) via PathEscapeError', async () => {
    const tmpRoot = makeTmp('llmem-doc-file-escape-');
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        // Use a deep ../ chain so even after concatenating ".arch/<filePath>.md"
        // the resolved path lands outside tmpRoot.
        await assert.rejects(
            processFileInfoReport(ctx, {
                filePath: asRelPath('../../../escape.ts'),
                overview: 'overview',
                functions: [],
            }),
            (err: Error) => err.name === 'PathEscapeError',
            'A path that escapes the workspace must throw PathEscapeError',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
