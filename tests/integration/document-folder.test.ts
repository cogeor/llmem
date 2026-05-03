// tests/integration/document-folder.test.ts
//
// Loop 08 regression test for the README "Known Issue" workaround
// (folder side). Mirrors tests/integration/document-file.test.ts.
//
// The legacy `report_folder_info` MCP handler relied on
// `getWorkspaceRoot()` (artifact/service) which sometimes returned a
// misleading default. The folder prompt template told the agent to
// manually copy the saved README from the wrong location into the
// workspace.
//
// Loop 08's fix: every entry to
// `application/document-folder::processFolderInfoReport` takes a
// branded `WorkspaceRoot`, and that brand is the only source of
// truth. Even when `process.cwd()` points elsewhere, the README lands
// in `<workspaceRoot>/.arch/<folder>/README.md`.
//
// This test pins that contract. Removing the threading (e.g. ignoring
// `req.workspaceRoot` and using `process.cwd()`) makes this test fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    processFolderInfoReport,
} from '../../src/application/document-folder';
import { asWorkspaceRoot, asRelPath } from '../../src/core/paths';

function makeTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('processFolderInfoReport writes to workspaceRoot/.arch, never elsewhere', async () => {
    const tmpRoot = makeTmp('llmem-doc-folder-root-');
    const fakeAppData = makeTmp('llmem-doc-folder-other-');

    // Point process.cwd at a different temp dir to simulate the legacy
    // bug condition. The branded workspaceRoot must take precedence.
    const originalCwd = process.cwd();
    process.chdir(fakeAppData);
    try {
        const result = await processFolderInfoReport({
            workspaceRoot: asWorkspaceRoot(tmpRoot),
            folderPath: asRelPath('src/info'),
            overview: 'Sample folder overview',
            inputs: 'Edge list data',
            outputs: 'Markdown documentation',
            keyFiles: [
                { name: 'extractor.ts', summary: 'Extracts file structure' },
            ],
            architecture: 'Composes parser output and rendering',
        });

        // The readmePath must be inside tmpRoot, not in process.cwd() (fakeAppData).
        const tmpRootResolved = fs.realpathSync(tmpRoot);
        const fakeAppDataResolved = fs.realpathSync(fakeAppData);
        const readmeResolved = fs.realpathSync(result.readmePath);

        assert.ok(
            readmeResolved.startsWith(tmpRootResolved),
            `readmePath ${readmeResolved} must start with tmpRoot ${tmpRootResolved}`,
        );
        assert.ok(
            !readmeResolved.startsWith(fakeAppDataResolved),
            `readmePath ${readmeResolved} must NOT start with fakeAppData ${fakeAppDataResolved}`,
        );

        // The file must actually exist at readmePath.
        assert.ok(fs.existsSync(result.readmePath), `readmePath must exist on disk: ${result.readmePath}`);

        // And the README must be at <tmpRoot>/.arch/<folder>/README.md.
        const expectedReadme = path.join(tmpRoot, '.arch', 'src', 'info', 'README.md');
        assert.equal(
            path.resolve(result.readmePath),
            path.resolve(expectedReadme),
            'readmePath must equal <tmpRoot>/.arch/src/info/README.md',
        );

        // Sanity: contents include the overview text and folder header.
        const contents = fs.readFileSync(result.readmePath, 'utf-8');
        assert.ok(
            contents.includes('Sample folder overview'),
            'README must include the supplied overview',
        );
        assert.ok(
            contents.includes('# FOLDER: src/info'),
            'README must include the folder header',
        );
        assert.ok(
            contents.includes('extractor.ts'),
            'README must list the supplied key file',
        );
    } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpRoot, { recursive: true, force: true });
        fs.rmSync(fakeAppData, { recursive: true, force: true });
    }
});

test('processFolderInfoReport bytesWritten matches utf-8 byte length', async () => {
    const tmpRoot = makeTmp('llmem-doc-folder-bytes-');
    try {
        const result = await processFolderInfoReport({
            workspaceRoot: asWorkspaceRoot(tmpRoot),
            folderPath: asRelPath('a/b'),
            overview: 'overview',
            keyFiles: [],
            architecture: 'arch',
        });
        const stat = fs.statSync(result.readmePath);
        assert.equal(result.bytesWritten, stat.size);
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('processFolderInfoReport refuses path-escape (../../..) via PathEscapeError', async () => {
    const tmpRoot = makeTmp('llmem-doc-folder-escape-');
    try {
        // Use a deep ../ chain so even after concatenating
        // ".arch/<folderPath>/README.md" the resolved path lands outside
        // tmpRoot.
        await assert.rejects(
            processFolderInfoReport({
                workspaceRoot: asWorkspaceRoot(tmpRoot),
                folderPath: asRelPath('../../../escape'),
                overview: 'overview',
                keyFiles: [],
                architecture: 'arch',
            }),
            (err: Error) => err.name === 'PathEscapeError',
            'A folder path that escapes the workspace must throw PathEscapeError',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
