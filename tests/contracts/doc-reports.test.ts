/**
 * C4 (2026-07-13) — doc-report payload drift canary.
 *
 * The CLI `document` command and the MCP `report_file_info` /
 * `report_folder_info` tools consume ONE shared payload schema
 * (contracts/doc-reports.ts). This test parses the same fixture payloads
 * through the shared schema and through the MCP tools' extended schemas —
 * if either face forks the shape again, one side stops accepting the
 * canonical payload and this fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    fileReportPayloadSchema,
    folderReportPayloadSchema,
} from '../../src/contracts/doc-reports';
import { ReportFileInfoSchema } from '../../src/mcp/tools/report-file-info';
import { ReportFolderInfoSchema } from '../../src/mcp/tools/report-folder-info';

const FILE_PAYLOAD = {
    overview: 'Parses TypeScript files into FileArtifacts.',
    inputs: 'absolute file path',
    outputs: 'FileArtifact',
    functions: [
        { name: 'extract', purpose: 'walk the AST', implementation: '- visits nodes' },
    ],
};

const FOLDER_PAYLOAD = {
    overview: 'The parser layer.',
    key_files: [{ name: 'registry.ts', summary: 'loads parsers per language' }],
    architecture: 'registry -> per-language extractors',
};

test('file payload: shared schema and MCP extended schema accept the same body', () => {
    const shared = fileReportPayloadSchema.parse(FILE_PAYLOAD);
    assert.equal(shared.functions.length, 1);

    const viaMcp = ReportFileInfoSchema.parse({
        ...FILE_PAYLOAD,
        workspaceRoot: '/repo',
        path: 'src/parser/ts.ts',
    });
    assert.deepEqual(viaMcp.functions, shared.functions);
    assert.equal(viaMcp.overview, shared.overview);
});

test('folder payload: shared schema and MCP extended schema accept the same body', () => {
    const shared = folderReportPayloadSchema.parse(FOLDER_PAYLOAD);
    assert.equal(shared.key_files.length, 1);

    const viaMcp = ReportFolderInfoSchema.parse({
        ...FOLDER_PAYLOAD,
        workspaceRoot: '/repo',
        path: 'src/parser',
    });
    assert.deepEqual(viaMcp.key_files, shared.key_files);
    assert.equal(viaMcp.architecture, shared.architecture);
});

test('enrichment arrays are REQUIRED on the shared payload (MCP rejects skipped enrichment)', () => {
    assert.throws(() => fileReportPayloadSchema.parse({ overview: 'x' }));
    assert.throws(() => folderReportPayloadSchema.parse({ overview: 'x', architecture: 'y' }));
});
