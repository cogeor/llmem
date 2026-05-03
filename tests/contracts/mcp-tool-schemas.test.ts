/**
 * MCP tool schema DTO contract test (Loop 17 / Phase 7).
 *
 * Pins the public wire shape for every MCP tool's Zod schema. The intent is
 * not "the schema works" — the per-tool integration tests already cover that
 * — but to lock the **property set** so a refactor that silently adds a
 * required field, renames a property, or relaxes a constraint trips a noisy
 * red. Each schema is tested for:
 *
 *   1. `parses a known-good payload` (round-trip identity).
 *   2. `property set is exactly [...]` (Object.keys pin against the parsed
 *      output — catches accidental property additions).
 *   3. one or more `rejects payload missing <required>` cases.
 *
 * Loop 17 picks runtime `Object.keys` over `expectTypeOf` because the
 * project doesn't already use a type-test harness, and the runtime
 * assertion catches the actual contract drift we care about (a property
 * showing up in the parsed output).
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
    FileInfoSchema,
    ReportFileInfoSchema,
    FolderInfoSchema,
    ReportFolderInfoSchema,
    InspectSourceSchema,
    OpenWindowSchema,
} from '../../src/mcp/tools';

// =============================================================================
// file_info
// =============================================================================

describe('mcp tool schema: file_info', () => {
    const KNOWN_GOOD = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/foo.ts',
    };

    test('parses a known-good payload', () => {
        const got = FileInfoSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, KNOWN_GOOD);
    });

    test('property set is exactly [path, workspaceRoot]', () => {
        const parsed = FileInfoSchema.parse(KNOWN_GOOD);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['path', 'workspaceRoot'],
            'A new property in FileInfoSchema requires an explicit pin update.',
        );
    });

    test('rejects payload missing workspaceRoot', () => {
        assert.throws(() => FileInfoSchema.parse({ path: 'src/foo.ts' }), z.ZodError);
    });

    test('rejects payload missing path', () => {
        assert.throws(() => FileInfoSchema.parse({ workspaceRoot: '/abs/path' }), z.ZodError);
    });
});

// =============================================================================
// report_file_info
// =============================================================================

describe('mcp tool schema: report_file_info', () => {
    const KNOWN_GOOD_MINIMAL = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/foo.ts',
        overview: 'Overview text.',
        functions: [
            { name: 'fn', purpose: 'does X', implementation: '- step 1' },
        ],
    };

    const KNOWN_GOOD_FULL = {
        ...KNOWN_GOOD_MINIMAL,
        inputs: 'Takes a config object.',
        outputs: 'Returns processed data.',
    };

    test('parses a known-good payload (minimal — no optional inputs/outputs)', () => {
        const got = ReportFileInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(got, KNOWN_GOOD_MINIMAL);
    });

    test('parses a known-good payload (full — with inputs/outputs)', () => {
        const got = ReportFileInfoSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(got, KNOWN_GOOD_FULL);
    });

    test('property set (minimal) is exactly [functions, overview, path, workspaceRoot]', () => {
        // Optional fields that are absent from the input do not appear in the
        // parsed output (Zod default behaviour). Pin both shapes explicitly.
        const parsed = ReportFileInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['functions', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('property set (full) is exactly [functions, inputs, outputs, overview, path, workspaceRoot]', () => {
        const parsed = ReportFileInfoSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['functions', 'inputs', 'outputs', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('functions[].property set is exactly [implementation, name, purpose]', () => {
        const parsed = ReportFileInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.equal(parsed.functions.length, 1);
        assert.deepEqual(
            Object.keys(parsed.functions[0]).sort(),
            ['implementation', 'name', 'purpose'],
        );
    });

    test('rejects payload missing overview', () => {
        const { overview, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportFileInfoSchema.parse(bad), z.ZodError);
    });

    test('rejects payload missing functions', () => {
        const { functions, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportFileInfoSchema.parse(bad), z.ZodError);
    });

    test('rejects payload with function missing required nested field', () => {
        const bad = {
            ...KNOWN_GOOD_MINIMAL,
            functions: [{ name: 'fn', purpose: 'does X' /* missing implementation */ }],
        };
        assert.throws(() => ReportFileInfoSchema.parse(bad), z.ZodError);
    });
});

// =============================================================================
// folder_info
// =============================================================================

describe('mcp tool schema: folder_info', () => {
    const KNOWN_GOOD = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/utils',
    };

    test('parses a known-good payload', () => {
        const got = FolderInfoSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, KNOWN_GOOD);
    });

    test('property set is exactly [path, workspaceRoot]', () => {
        const parsed = FolderInfoSchema.parse(KNOWN_GOOD);
        assert.deepEqual(Object.keys(parsed).sort(), ['path', 'workspaceRoot']);
    });

    test('rejects payload missing workspaceRoot', () => {
        assert.throws(() => FolderInfoSchema.parse({ path: 'src/utils' }), z.ZodError);
    });

    test('rejects payload missing path', () => {
        assert.throws(() => FolderInfoSchema.parse({ workspaceRoot: '/abs/path' }), z.ZodError);
    });
});

// =============================================================================
// report_folder_info
// =============================================================================

describe('mcp tool schema: report_folder_info', () => {
    const KNOWN_GOOD_MINIMAL = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/utils',
        overview: 'Folder overview text.',
        key_files: [
            { name: 'helpers.ts', summary: 'Common helpers.' },
        ],
        architecture: 'Flat file layout.',
    };

    const KNOWN_GOOD_FULL = {
        ...KNOWN_GOOD_MINIMAL,
        inputs: 'External dependencies.',
        outputs: 'Public API.',
    };

    test('parses a known-good payload (minimal)', () => {
        const got = ReportFolderInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(got, KNOWN_GOOD_MINIMAL);
    });

    test('parses a known-good payload (full — with inputs/outputs)', () => {
        const got = ReportFolderInfoSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(got, KNOWN_GOOD_FULL);
    });

    test('property set (minimal) is exactly [architecture, key_files, overview, path, workspaceRoot]', () => {
        const parsed = ReportFolderInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['architecture', 'key_files', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('property set (full) is exactly [architecture, inputs, key_files, outputs, overview, path, workspaceRoot]', () => {
        const parsed = ReportFolderInfoSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['architecture', 'inputs', 'key_files', 'outputs', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('key_files[].property set is exactly [name, summary]', () => {
        const parsed = ReportFolderInfoSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.equal(parsed.key_files.length, 1);
        assert.deepEqual(
            Object.keys(parsed.key_files[0]).sort(),
            ['name', 'summary'],
        );
    });

    test('rejects payload missing overview', () => {
        const { overview, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportFolderInfoSchema.parse(bad), z.ZodError);
    });

    test('rejects payload missing architecture', () => {
        const { architecture, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportFolderInfoSchema.parse(bad), z.ZodError);
    });

    test('rejects payload with key_file missing required nested field', () => {
        const bad = {
            ...KNOWN_GOOD_MINIMAL,
            key_files: [{ name: 'foo.ts' /* missing summary */ }],
        };
        assert.throws(() => ReportFolderInfoSchema.parse(bad), z.ZodError);
    });
});

// =============================================================================
// inspect_source
// =============================================================================

describe('mcp tool schema: inspect_source', () => {
    const KNOWN_GOOD = {
        path: 'src/foo.ts',
        startLine: 10,
        endLine: 50,
    };

    test('parses a known-good payload', () => {
        const got = InspectSourceSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, KNOWN_GOOD);
    });

    test('property set is exactly [endLine, path, startLine]', () => {
        const parsed = InspectSourceSchema.parse(KNOWN_GOOD);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['endLine', 'path', 'startLine'],
        );
    });

    test('rejects payload missing path', () => {
        assert.throws(
            () => InspectSourceSchema.parse({ startLine: 1, endLine: 10 }),
            z.ZodError,
        );
    });

    test('rejects payload with non-numeric startLine', () => {
        assert.throws(
            () => InspectSourceSchema.parse({ path: 'src/foo.ts', startLine: 'one', endLine: 10 }),
            z.ZodError,
        );
    });

    test('rejects payload with non-numeric endLine', () => {
        assert.throws(
            () => InspectSourceSchema.parse({ path: 'src/foo.ts', startLine: 1, endLine: 'ten' }),
            z.ZodError,
        );
    });
});

// =============================================================================
// open_window
// =============================================================================

describe('mcp tool schema: open_window', () => {
    test('parses an empty payload (viewColumn is optional)', () => {
        const got = OpenWindowSchema.parse({});
        assert.deepEqual(got, {});
    });

    test('parses a payload with viewColumn', () => {
        const got = OpenWindowSchema.parse({ viewColumn: 2 });
        assert.deepEqual(got, { viewColumn: 2 });
    });

    test('property set with no viewColumn is empty', () => {
        const parsed = OpenWindowSchema.parse({});
        assert.deepEqual(Object.keys(parsed), []);
    });

    test('property set with viewColumn is exactly [viewColumn]', () => {
        const parsed = OpenWindowSchema.parse({ viewColumn: 1 });
        assert.deepEqual(Object.keys(parsed), ['viewColumn']);
    });

    test('rejects payload with non-numeric viewColumn', () => {
        assert.throws(() => OpenWindowSchema.parse({ viewColumn: 'one' }), z.ZodError);
    });
});
