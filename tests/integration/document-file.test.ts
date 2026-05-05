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
} from '../../src/application/document-file';
import { asRelPath } from '../../src/core/paths';
import { createWorkspaceContext } from '../../src/application/workspace-context';

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

        // The archPath must be inside tmpRoot, not in process.cwd() (fakeAppData).
        const tmpRootResolved = fs.realpathSync(tmpRoot);
        const fakeAppDataResolved = fs.realpathSync(fakeAppData);
        const archPathResolved = fs.realpathSync(result.archPath);

        assert.ok(
            archPathResolved.startsWith(tmpRootResolved),
            `archPath ${archPathResolved} must start with tmpRoot ${tmpRootResolved}`,
        );
        assert.ok(
            !archPathResolved.startsWith(fakeAppDataResolved),
            `archPath ${archPathResolved} must NOT start with fakeAppData ${fakeAppDataResolved}`,
        );

        // The file must actually exist at archPath.
        assert.ok(fs.existsSync(result.archPath), `archPath must exist on disk: ${result.archPath}`);

        // And the .arch directory must be inside tmpRoot.
        const expectedArch = path.join(tmpRoot, '.arch', 'src', 'foo.ts.md');
        assert.equal(
            path.resolve(result.archPath),
            path.resolve(expectedArch),
            'archPath must equal <tmpRoot>/.arch/src/foo.ts.md',
        );

        // Sanity: contents include the overview text.
        const contents = fs.readFileSync(result.archPath, 'utf-8');
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
        const stat = fs.statSync(result.archPath);
        assert.equal(result.bytesWritten, stat.size);
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
