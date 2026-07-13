/**
 * B3 (2026-07-13) — `ScanFolderRequest.onFile` fires once per parsed file
 * with the workspace-relative path, across recursion. Application-level; no
 * console assertions — the application layer stays console-free (the CLI's
 * rendering of this seam is tested in tests/unit/cli/progress.test.ts).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { scanFolderRecursive } from '../../../src/application/scan';
import { createWorkspaceContext } from '../../../src/application/workspace-context';

test('scanFolderRecursive: onFile fires per parsed file, across subfolders', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-onfile-'));
    try {
        fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n', 'utf8');
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src', 'b.ts'),
            'export const b = 2;\n',
            'utf8',
        );

        const ctx = await createWorkspaceContext({ workspaceRoot: root });
        const seen: string[] = [];
        const result = await scanFolderRecursive(ctx, {
            folderPath: '.',
            onFile: (rel) => seen.push(rel),
        });

        assert.equal(result.filesProcessed, 2, 'both files parsed');
        assert.deepEqual(
            seen.sort(),
            ['a.ts', 'src/b.ts'],
            'onFile saw each file once, workspace-relative',
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
