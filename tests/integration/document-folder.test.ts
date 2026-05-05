// tests/integration/document-folder.test.ts
//
// Loop 08 regression test for the README "Known Issue" workaround
// (folder side). Mirrors tests/integration/document-file.test.ts.
//
// Loop 04: `processFolderInfoReport` now takes `(ctx, request)`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    processFolderInfoReport,
    buildDocumentFolderPrompt,
} from '../../src/application/document-folder';
import { asRelPath } from '../../src/core/paths';
import { createWorkspaceContext } from '../../src/application/workspace-context';

function makeTmp(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('processFolderInfoReport writes to workspaceRoot/.arch, never elsewhere', async () => {
    const tmpRoot = makeTmp('llmem-doc-folder-root-');
    const fakeAppData = makeTmp('llmem-doc-folder-other-');

    const originalCwd = process.cwd();
    process.chdir(fakeAppData);
    try {
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await processFolderInfoReport(ctx, {
            folderPath: asRelPath('src/info'),
            overview: 'Sample folder overview',
            inputs: 'Edge list data',
            outputs: 'Markdown documentation',
            keyFiles: [
                { name: 'extractor.ts', summary: 'Extracts file structure' },
            ],
            architecture: 'Composes parser output and rendering',
        });

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

        assert.ok(fs.existsSync(result.readmePath), `readmePath must exist on disk: ${result.readmePath}`);

        const expectedReadme = path.join(tmpRoot, '.arch', 'src', 'info', 'README.md');
        assert.equal(
            path.resolve(result.readmePath),
            path.resolve(expectedReadme),
            'readmePath must equal <tmpRoot>/.arch/src/info/README.md',
        );

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
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        const result = await processFolderInfoReport(ctx, {
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
        const ctx = await createWorkspaceContext({ workspaceRoot: tmpRoot });
        await assert.rejects(
            processFolderInfoReport(ctx, {
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

test('buildDocumentFolderPrompt reads from ctx.artifactRoot, not literal .artifacts', async () => {
    const tmpRoot = makeTmp('llmem-doc-folder-artroot-');
    try {
        // Create the source folder being documented.
        fs.mkdirSync(path.join(tmpRoot, 'src', 'demo'), { recursive: true });

        // Lay down edge-list fixtures under a NON-default artifact root.
        const customRel = 'custom-artifacts';
        const customAbs = path.join(tmpRoot, customRel);
        fs.mkdirSync(customAbs, { recursive: true });
        const emptyEdges = JSON.stringify({
            schemaVersion: 2,
            resolverVersion: 'ts-resolveModuleName-v1',
            timestamp: new Date().toISOString(),
            nodes: [],
            edges: [],
        });
        fs.writeFileSync(path.join(customAbs, 'import-edgelist.json'), emptyEdges);
        fs.writeFileSync(path.join(customAbs, 'call-edgelist.json'), emptyEdges);

        // ALSO seed the default artifact directory to prove we are not
        // silently reading from there. Use a poison sentinel so a
        // regression would surface as a parse error or unexpected node
        // count.
        const poisonAbs = path.join(tmpRoot, '.artifacts');
        fs.mkdirSync(poisonAbs, { recursive: true });
        fs.writeFileSync(path.join(poisonAbs, 'import-edgelist.json'), '{ not valid json');
        fs.writeFileSync(path.join(poisonAbs, 'call-edgelist.json'), '{ not valid json');

        const ctx = await createWorkspaceContext({
            workspaceRoot: tmpRoot,
            configOverrides: { artifactRoot: customRel },
        });

        // If the implementation still hardcoded the default artifact
        // directory, this would throw on the poison JSON. With the fix,
        // it loads from `custom-artifacts` and returns an empty-graph
        // prompt.
        const data = await buildDocumentFolderPrompt(ctx, {
            folderPath: asRelPath('src/demo'),
        });
        assert.equal(data.stats.nodes, 0);
        assert.equal(data.stats.edges, 0);
        assert.ok(
            data.prompt.includes('src/demo'),
            'prompt should mention the documented folder path',
        );
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});
