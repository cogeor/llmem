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
    DocumentSchema,
    ReportDocumentSchema,
    ReviewSchema,
    ReportReviewSchema,
    OpenWindowSchema,
} from '../../src/mcp/tools';

// =============================================================================
// document (C5: merged file_info + folder_info — identical payload)
// =============================================================================

describe('mcp tool schema: document', () => {
    const KNOWN_GOOD = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/foo.ts',
    };

    test('parses a known-good payload (refresh defaults to auto)', () => {
        const got = DocumentSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, { ...KNOWN_GOOD, refresh: 'auto' });
    });

    test("accepts refresh: 'skip'", () => {
        const got = DocumentSchema.parse({ ...KNOWN_GOOD, refresh: 'skip' });
        assert.equal(got.refresh, 'skip');
    });

    test('rejects an unknown refresh value', () => {
        assert.throws(
            () => DocumentSchema.parse({ ...KNOWN_GOOD, refresh: 'always' }),
            z.ZodError,
        );
    });

    test('property set is exactly [path, refresh, workspaceRoot]', () => {
        const parsed = DocumentSchema.parse(KNOWN_GOOD);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['path', 'refresh', 'workspaceRoot'],
            'A new property in DocumentSchema requires an explicit pin update.',
        );
    });

    test('rejects payload missing workspaceRoot', () => {
        assert.throws(() => DocumentSchema.parse({ path: 'src/foo.ts' }), z.ZodError);
    });

    test('rejects payload missing path', () => {
        assert.throws(() => DocumentSchema.parse({ workspaceRoot: '/abs/path' }), z.ZodError);
    });
});

// =============================================================================
// report_document (C5: discriminated union on kind over the shared
// contracts/doc-reports payloads + routing fields)
// =============================================================================

describe('mcp tool schema: report_document (kind: file)', () => {
    const KNOWN_GOOD_MINIMAL = {
        kind: 'file',
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
        const got = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(got, KNOWN_GOOD_MINIMAL);
    });

    test('parses a known-good payload (full — with inputs/outputs)', () => {
        const got = ReportDocumentSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(got, KNOWN_GOOD_FULL);
    });

    test('property set (minimal) is exactly [functions, kind, overview, path, workspaceRoot]', () => {
        const parsed = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['functions', 'kind', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('functions[].property set is exactly [implementation, name, purpose]', () => {
        const parsed = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        if (parsed.kind !== 'file') assert.fail('expected file variant');
        assert.equal(parsed.functions.length, 1);
        assert.deepEqual(
            Object.keys(parsed.functions[0]).sort(),
            ['implementation', 'name', 'purpose'],
        );
    });

    test('rejects payload missing kind (the discriminator)', () => {
        const { kind, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportDocumentSchema.parse(bad), z.ZodError);
    });

    test('rejects payload missing overview', () => {
        const { overview, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportDocumentSchema.parse(bad), z.ZodError);
    });

    test('rejects payload missing functions', () => {
        const { functions, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportDocumentSchema.parse(bad), z.ZodError);
    });

    test('rejects payload with function missing required nested field', () => {
        const bad = {
            ...KNOWN_GOOD_MINIMAL,
            functions: [{ name: 'fn', purpose: 'does X' /* missing implementation */ }],
        };
        assert.throws(() => ReportDocumentSchema.parse(bad), z.ZodError);
    });
});

describe('mcp tool schema: report_document (kind: folder)', () => {
    const KNOWN_GOOD_MINIMAL = {
        kind: 'folder',
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
        const got = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(got, KNOWN_GOOD_MINIMAL);
    });

    test('parses a known-good payload (full — with inputs/outputs)', () => {
        const got = ReportDocumentSchema.parse(KNOWN_GOOD_FULL);
        assert.deepEqual(got, KNOWN_GOOD_FULL);
    });

    test('property set (minimal) is exactly [architecture, key_files, kind, overview, path, workspaceRoot]', () => {
        const parsed = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['architecture', 'key_files', 'kind', 'overview', 'path', 'workspaceRoot'],
        );
    });

    test('key_files[].property set is exactly [name, summary]', () => {
        const parsed = ReportDocumentSchema.parse(KNOWN_GOOD_MINIMAL);
        if (parsed.kind !== 'folder') assert.fail('expected folder variant');
        assert.equal(parsed.key_files.length, 1);
        assert.deepEqual(
            Object.keys(parsed.key_files[0]).sort(),
            ['name', 'summary'],
        );
    });

    test('rejects payload missing architecture', () => {
        const { architecture, ...bad } = KNOWN_GOOD_MINIMAL;
        assert.throws(() => ReportDocumentSchema.parse(bad), z.ZodError);
    });

    test('rejects a file body under kind:folder (cross-variant fields)', () => {
        assert.throws(
            () => ReportDocumentSchema.parse({
                kind: 'folder',
                workspaceRoot: '/abs',
                path: 'src/utils',
                overview: 'x',
                functions: [],
            }),
            z.ZodError,
        );
    });
});

// =============================================================================
// review
// =============================================================================

describe('mcp tool schema: review', () => {
    const KNOWN_GOOD = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/webview',
    };

    test('parses a known-good payload (ruleset defaults to both)', () => {
        const got = ReviewSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, { ...KNOWN_GOOD, ruleset: 'both' });
    });

    test('ruleset defaults to both when omitted', () => {
        assert.equal(ReviewSchema.parse(KNOWN_GOOD).ruleset, 'both');
    });

    test("accepts ruleset: 'general' and 'frontend'", () => {
        assert.equal(ReviewSchema.parse({ ...KNOWN_GOOD, ruleset: 'general' }).ruleset, 'general');
        assert.equal(ReviewSchema.parse({ ...KNOWN_GOOD, ruleset: 'frontend' }).ruleset, 'frontend');
    });

    test('rejects an unknown ruleset value', () => {
        assert.throws(
            () => ReviewSchema.parse({ ...KNOWN_GOOD, ruleset: 'backend' }),
            z.ZodError,
        );
    });

    test('property set is exactly [path, ruleset, workspaceRoot]', () => {
        const parsed = ReviewSchema.parse(KNOWN_GOOD);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['path', 'ruleset', 'workspaceRoot'],
        );
    });

    test('rejects payload missing workspaceRoot', () => {
        assert.throws(() => ReviewSchema.parse({ path: 'src/webview' }), z.ZodError);
    });

    test('rejects payload missing path', () => {
        assert.throws(() => ReviewSchema.parse({ workspaceRoot: '/abs/path' }), z.ZodError);
    });
});

// =============================================================================
// report_review
// =============================================================================

describe('mcp tool schema: report_review', () => {
    const KNOWN_GOOD = {
        workspaceRoot: '/abs/path/to/project',
        path: 'src/webview',
        checklist: [
            { id: 'D1', status: 'issue-validated', note: 'owner is X' },
            { id: 'DC1', status: 'non-issue' },
        ],
    };

    test('parses a known-good payload (ruleset defaults to both)', () => {
        const got = ReportReviewSchema.parse(KNOWN_GOOD);
        assert.deepEqual(got, { ...KNOWN_GOOD, ruleset: 'both' });
    });

    test('ruleset defaults to both when omitted', () => {
        assert.equal(ReportReviewSchema.parse(KNOWN_GOOD).ruleset, 'both');
    });

    test('property set is exactly [checklist, path, ruleset, workspaceRoot]', () => {
        const parsed = ReportReviewSchema.parse(KNOWN_GOOD);
        assert.deepEqual(
            Object.keys(parsed).sort(),
            ['checklist', 'path', 'ruleset', 'workspaceRoot'],
        );
    });

    test('checklist[].property set is exactly [id, note, status] (with note) / [id, status] (without)', () => {
        const parsed = ReportReviewSchema.parse(KNOWN_GOOD);
        assert.deepEqual(Object.keys(parsed.checklist[0]).sort(), ['id', 'note', 'status']);
        assert.deepEqual(Object.keys(parsed.checklist[1]).sort(), ['id', 'status']);
    });

    test('rejects an unknown checklist item status', () => {
        const bad = {
            ...KNOWN_GOOD,
            checklist: [{ id: 'D1', status: 'maybe' }],
        };
        assert.throws(() => ReportReviewSchema.parse(bad), z.ZodError);
    });

    test('rejects a checklist item missing required id', () => {
        const bad = {
            ...KNOWN_GOOD,
            checklist: [{ status: 'non-issue' }],
        };
        assert.throws(() => ReportReviewSchema.parse(bad), z.ZodError);
    });

    test('rejects payload missing checklist', () => {
        const { checklist, ...bad } = KNOWN_GOOD;
        assert.throws(() => ReportReviewSchema.parse(bad), z.ZodError);
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
