/**
 * B5 (2026-07-13) — drift guard: the docs tree lives at `.llmem/docs/`
 * (DOCS_DIR in src/docs/doc-store.ts), but the MCP tool descriptions used
 * to tell agents `.arch/` — so agents cited/looked up paths that don't
 * exist. Pin every user-facing description to the real prefix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { reportFileInfoTool } from '../../src/mcp/tools/report-file-info';
import { reportFolderInfoTool } from '../../src/mcp/tools/report-folder-info';
import { DOCS_DIR } from '../../src/docs/doc-store';

test('DOCS_DIR is the .llmem/docs prefix (single source of truth)', () => {
    assert.equal(DOCS_DIR, '.llmem/docs');
});

test('report_file_info / report_folder_info descriptions name the REAL docs path', () => {
    for (const tool of [reportFileInfoTool, reportFolderInfoTool]) {
        assert.ok(
            tool.description.includes('.llmem/docs'),
            `${tool.name} description must contain '.llmem/docs'; got: ${tool.description}`,
        );
        assert.ok(
            !tool.description.includes('.arch'),
            `${tool.name} description must not mention the retired '.arch' tree; got: ${tool.description}`,
        );
    }
});
