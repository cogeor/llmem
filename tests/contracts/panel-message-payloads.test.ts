/**
 * Panel outbound message payload contract test (H2).
 *
 * Pins the extension -> webview `postMessage` wire shape for every message
 * the panel handlers emit (`src/extension/panel/panel-data-handlers.ts` and
 * `panel-watch-handlers.ts`). Mirrors the `http-route-dtos.test.ts` pattern:
 * the schemas are colocated with the test (not imported from `src/`) and pin
 * the observed shape, so a handler that changes a field name breaks here.
 *
 * Coverage:
 *   - data:init          — { type, data }
 *   - data:refresh       — { type, data }
 *   - state:watchedPaths — { type, paths, requestId?, addedFiles?/removedFiles? }
 *   - data:folderNodes   — { type, folderPath, data? | error? }
 *   - data:folderTree    — { type, requestId?, data? | error? }
 *   - data:folderEdges   — { type, requestId?, data? | error? }
 *
 * A compile-time exhaustiveness check ties the colocated schema list to the
 * `PanelOutboundMessage` union so the contract and the test cannot drift.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import type { PanelOutboundMessage, PanelOutboundMessageType } from '../../src/contracts/panel-messages';
import type { WorkTreeNode } from '../../src/contracts/webview-payloads';

// -----------------------------------------------------------------------------
// Shared shapes (colocated — pin the observed wire shape)
// -----------------------------------------------------------------------------

const VisNodeSchema = z
    .object({
        id: z.string(),
        label: z.string(),
        group: z.string(),
        fileId: z.string().optional(),
    })
    .passthrough();

const VisEdgeSchema = z
    .object({
        from: z.string(),
        to: z.string(),
    })
    .passthrough();

const GraphSliceSchema = z.object({
    nodes: z.array(VisNodeSchema),
    edges: z.array(VisEdgeSchema),
});

const ViewerDataPayloadSchema = z.object({
    graphData: z.object({
        importGraph: GraphSliceSchema,
        callGraph: GraphSliceSchema,
    }),
    workTree: z.object({
        name: z.string(),
        type: z.string(),
        path: z.string(),
    }).passthrough(),
    designDocs: z.record(z.object({ markdown: z.string(), html: z.string() })),
});

// -----------------------------------------------------------------------------
// Message schemas (one per `type`)
// -----------------------------------------------------------------------------

const DataInitSchema = z.object({
    type: z.literal('data:init'),
    data: ViewerDataPayloadSchema,
});

const DataRefreshSchema = z.object({
    type: z.literal('data:refresh'),
    data: ViewerDataPayloadSchema,
});

const StateWatchedPathsSchema = z.object({
    type: z.literal('state:watchedPaths'),
    paths: z.array(z.string()),
    requestId: z.string().optional(),
    addedFiles: z.array(z.string()).optional(),
    removedFiles: z.array(z.string()).optional(),
});

const DataFolderNodesSchema = z.object({
    type: z.literal('data:folderNodes'),
    folderPath: z.string(),
    data: GraphSliceSchema.optional(),
    error: z.string().optional(),
});

const DataFolderTreeSchema = z.object({
    type: z.literal('data:folderTree'),
    requestId: z.string().optional(),
    data: z
        .object({
            schemaVersion: z.literal(1),
            timestamp: z.string(),
            root: z.any(),
        })
        .optional(),
    error: z.string().optional(),
});

const DataFolderEdgesSchema = z.object({
    type: z.literal('data:folderEdges'),
    requestId: z.string().optional(),
    data: z
        .object({
            schemaVersion: z.literal(1),
            timestamp: z.string(),
            edges: z.array(z.any()),
            weightP90: z.number(),
        })
        .optional(),
    error: z.string().optional(),
});

// Schema registry keyed by the discriminant. The `satisfies Record<...>`
// gives a compile-time exhaustiveness check: if `PanelOutboundMessageType`
// gains/loses a member, this object stops matching and the build fails —
// keeping the colocated schemas and the contract union in lock-step.
const MESSAGE_SCHEMAS = {
    'data:init': DataInitSchema,
    'data:refresh': DataRefreshSchema,
    'state:watchedPaths': StateWatchedPathsSchema,
    'data:folderNodes': DataFolderNodesSchema,
    'data:folderTree': DataFolderTreeSchema,
    'data:folderEdges': DataFolderEdgesSchema,
} satisfies Record<PanelOutboundMessageType, z.ZodTypeAny>;

// -----------------------------------------------------------------------------
// Representative valid payloads (one per type)
// -----------------------------------------------------------------------------

const emptyGraphData = {
    importGraph: { nodes: [], edges: [] },
    callGraph: { nodes: [], edges: [] },
};
const emptyWorkTree: WorkTreeNode = { name: 'root', type: 'directory', path: '', children: [] };
const viewerData = { graphData: emptyGraphData, workTree: emptyWorkTree, designDocs: {} };

// `satisfies PanelOutboundMessage` means a handler-shape drift in the contract
// also fails these fixtures at compile time.
const VALID_PAYLOADS = [
    { type: 'data:init', data: viewerData },
    { type: 'data:refresh', data: viewerData },
    { type: 'state:watchedPaths', paths: ['src/a.ts'], requestId: 'r1', addedFiles: ['src/a.ts'] },
    { type: 'state:watchedPaths', paths: ['src/a.ts'], removedFiles: ['src/a.ts'] },
    { type: 'state:watchedPaths', paths: ['src/a.ts'] },
    {
        type: 'data:folderNodes',
        folderPath: 'src',
        data: { nodes: [{ id: 'n1', label: 'fn', group: 'src/a.ts', fileId: 'src/a.ts' }], edges: [{ from: 'n1', to: 'n2' }] },
    },
    { type: 'data:folderNodes', folderPath: 'src', error: 'Context not initialized' },
    {
        type: 'data:folderTree',
        requestId: 'r2',
        data: { schemaVersion: 1, timestamp: '2026-01-01T00:00:00.000Z', root: { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children: [] } },
    },
    { type: 'data:folderTree', error: 'parse-error' },
    {
        type: 'data:folderEdges',
        requestId: 'r3',
        data: { schemaVersion: 1, timestamp: '2026-01-01T00:00:00.000Z', edges: [], weightP90: 0 },
    },
    { type: 'data:folderEdges', error: 'schema-error' },
] satisfies PanelOutboundMessage[];

// -----------------------------------------------------------------------------
// (a) Each representative valid payload parses against its schema.
// -----------------------------------------------------------------------------

test('panel message: every representative valid payload parses', () => {
    for (const payload of VALID_PAYLOADS) {
        const schema = MESSAGE_SCHEMAS[payload.type];
        const parsed = schema.parse(payload);
        assert.equal((parsed as { type: string }).type, payload.type);
    }
});

// -----------------------------------------------------------------------------
// (b) The discriminant literals are exhaustive — all six are covered.
// -----------------------------------------------------------------------------

test('panel message: discriminant types are exhaustive (six covered)', () => {
    const expected: PanelOutboundMessageType[] = [
        'data:init',
        'data:refresh',
        'state:watchedPaths',
        'data:folderNodes',
        'data:folderTree',
        'data:folderEdges',
    ];
    const registered = Object.keys(MESSAGE_SCHEMAS).sort();
    assert.deepEqual(registered, [...expected].sort());
    assert.equal(registered.length, 6);

    // Every type has at least one representative valid payload.
    const covered = new Set(VALID_PAYLOADS.map((p) => p.type));
    for (const t of expected) {
        assert.ok(covered.has(t), `missing valid payload for ${t}`);
    }
});

// -----------------------------------------------------------------------------
// (c) Negative cases — malformed payloads are rejected (schemas load-bearing).
// -----------------------------------------------------------------------------

test('panel message: malformed payloads are rejected', () => {
    // Wrong discriminant literal.
    assert.equal(DataInitSchema.safeParse({ type: 'data:refresh', data: viewerData }).success, false);

    // Missing required field (`paths`).
    assert.equal(StateWatchedPathsSchema.safeParse({ type: 'state:watchedPaths' }).success, false);

    // `folderPath` must be a string, not a number.
    assert.equal(
        DataFolderNodesSchema.safeParse({ type: 'data:folderNodes', folderPath: 123 }).success,
        false,
    );

    // Folder-tree data with the wrong schemaVersion literal.
    assert.equal(
        DataFolderTreeSchema.safeParse({
            type: 'data:folderTree',
            data: { schemaVersion: 99, timestamp: 't', root: {} },
        }).success,
        false,
    );

    // `paths` must be an array of strings.
    assert.equal(
        StateWatchedPathsSchema.safeParse({ type: 'state:watchedPaths', paths: [1, 2, 3] }).success,
        false,
    );
});
