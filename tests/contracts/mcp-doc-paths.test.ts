/**
 * B5 (2026-07-13) — drift guard: the docs tree lives at `.llmem/docs/`
 * (DOCS_DIR in src/docs/doc-store.ts), but the MCP tool descriptions used
 * to tell agents `.arch/` — so agents cited/looked up paths that don't
 * exist. Pin every user-facing description to the real prefix.
 *
 * C5: the four file/folder tools merged into the document/report_document
 * pair; the guard now pins the merged pair's descriptions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { documentTool } from '../../src/mcp/tools/document';
import { reportDocumentTool } from '../../src/mcp/tools/report-document';
import { DOCS_DIR } from '../../src/docs/doc-store';

test('DOCS_DIR is the .llmem/docs prefix (single source of truth)', () => {
    assert.equal(DOCS_DIR, '.llmem/docs');
});

test('report_document description names the REAL docs paths', () => {
    assert.ok(
        reportDocumentTool.description.includes('.llmem/docs'),
        `report_document description must contain '.llmem/docs'; got: ${reportDocumentTool.description}`,
    );
    for (const tool of [documentTool, reportDocumentTool]) {
        assert.ok(
            !tool.description.includes('.arch'),
            `${tool.name} description must not mention the retired '.arch' tree; got: ${tool.description}`,
        );
    }
});
