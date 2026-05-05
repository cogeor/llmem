/**
 * HTTP route DTO contract test (Loop 17 / Phase 7).
 *
 * Pins the request/response wire shape for every route under
 * `src/claude/server/routes/`. The harness lives in
 * `tests/contracts/_helpers/build-server.ts` (extracted in Loop 17 because
 * this file exceeded the 300-line size budget mentioned in the plan).
 *
 * The schemas are colocated with the test (not imported from `src/`)
 * because the production routes don't validate against them today.
 * The contract is "the shape we put on the wire" — adding production
 * validation is a Loop 18+ hardening change.
 *
 * Coverage:
 *   - GET  /api/stats        — response schema
 *   - GET  /api/watched      — response schema
 *   - POST /api/regenerate   — response schema
 *   - POST /api/watch        — request + response schemas; 400 on missing path
 *   - DELETE /api/watch      — same
 *   - GET  /api/arch?path=…  — 200 + 404 response schemas
 *   - POST /api/arch         — request + response schemas; 400 on missing markdown
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';

import { withServer } from './_helpers/build-server';

// -----------------------------------------------------------------------------
// Schemas (colocated — pin the observed wire shape)
// -----------------------------------------------------------------------------

const StatsResponseSchema = z.object({
    importNodes: z.number(),
    importEdges: z.number(),
    callNodes: z.number(),
    callEdges: z.number(),
    fileCount: z.number(),
    lastUpdated: z.string(),
});

const WatchedResponseSchema = z.object({
    watchedFiles: z.array(z.string()),
    totalFiles: z.number(),
    lastUpdated: z.string(),
});

const RegenerateResponseSchema = z.object({
    success: z.literal(true),
    message: z.string(),
});

const WatchRequestSchema = z.object({
    path: z.string(),
});

// Production result shape (from application/toggle-watch): success +
// optional message + addedFiles/removedFiles + watchedFiles.
const WatchAddResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    addedFiles: z.array(z.string()),
    watchedFiles: z.array(z.string()),
});

const WatchRemoveResponseSchema = z.object({
    success: z.boolean(),
    message: z.string().optional(),
    removedFiles: z.array(z.string()),
    watchedFiles: z.array(z.string()),
});

const WatchErrorResponseSchema = z.object({
    success: z.literal(false),
    message: z.string(),
});

const ArchGetResponse200Schema = z.object({
    success: z.literal(true),
    path: z.string(),
    markdown: z.string(),
    html: z.string(),
});

const ArchErrorResponseSchema = z.object({
    success: z.literal(false),
    message: z.string(),
});

const ArchPostRequestSchema = z.object({
    path: z.string(),
    markdown: z.string(),
});

const ArchPostResponse200Schema = z.object({
    success: z.literal(true),
    message: z.string(),
    path: z.string(),
});

// -----------------------------------------------------------------------------
// GET /api/stats
// -----------------------------------------------------------------------------

test('route DTO: GET /api/stats with seeded edge lists parses against schema', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-http-stats-'));
    const artifactDir = path.join(tmp, '.artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    const empty = {
        schemaVersion: 2,
        resolverVersion: 'ts-resolveModuleName-v1',
        timestamp: new Date().toISOString(),
        nodes: [],
        edges: [],
    };
    fs.writeFileSync(path.join(artifactDir, 'import-edgelist.json'), JSON.stringify(empty));
    fs.writeFileSync(path.join(artifactDir, 'call-edgelist.json'), JSON.stringify(empty));

    try {
        await withServer({ config: { workspaceRoot: tmp } }, async (req) => {
            const result = await req({ method: 'GET', path: '/api/stats' });
            assert.equal(result.status, 200, `body=${result.body}`);
            const parsed = StatsResponseSchema.parse(JSON.parse(result.body));
            assert.equal(parsed.importNodes, 0);
            assert.equal(parsed.callEdges, 0);
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// -----------------------------------------------------------------------------
// GET /api/watched
// -----------------------------------------------------------------------------

test('route DTO: GET /api/watched response shape', async () => {
    await withServer({}, async (req) => {
        const result = await req({ method: 'GET', path: '/api/watched' });
        assert.equal(result.status, 200, `body=${result.body}`);
        const parsed = WatchedResponseSchema.parse(JSON.parse(result.body));
        assert.deepEqual(parsed.watchedFiles, []);
        assert.equal(parsed.totalFiles, 0);
        assert.ok(typeof parsed.lastUpdated === 'string');
    });
});

// -----------------------------------------------------------------------------
// POST /api/regenerate
// -----------------------------------------------------------------------------

test('route DTO: POST /api/regenerate response shape', async () => {
    await withServer({}, async (req) => {
        const result = await req({ method: 'POST', path: '/api/regenerate' });
        assert.equal(result.status, 200, `body=${result.body}`);
        const parsed = RegenerateResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, true);
        assert.ok(typeof parsed.message === 'string');
    });
});

// -----------------------------------------------------------------------------
// POST /api/watch
// -----------------------------------------------------------------------------

test('route DTO: POST /api/watch with missing path returns 400 with error shape', async () => {
    await withServer({}, async (req) => {
        const result = await req({
            method: 'POST',
            path: '/api/watch',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.equal(result.status, 400, `body=${result.body}`);
        const parsed = WatchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: POST /api/watch with valid path returns response matching add-result shape', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-http-watch-'));
    fs.writeFileSync(path.join(tmp, 'foo.ts'), 'export const x = 1;\n');

    try {
        await withServer({ config: { workspaceRoot: tmp } }, async (req) => {
            const requestBody = { path: 'foo.ts' };
            assert.ok(WatchRequestSchema.parse(requestBody));

            const result = await req({
                method: 'POST',
                path: '/api/watch',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            // Application can return success=true (added) or success=false
            // (e.g. unsupported file). Either way the response must match
            // WatchAddResponseSchema.
            assert.ok(
                result.status === 200 || result.status === 400,
                `unexpected status ${result.status}: ${result.body}`,
            );
            const parsed = WatchAddResponseSchema.parse(JSON.parse(result.body));
            assert.ok(typeof parsed.success === 'boolean');
            assert.ok(Array.isArray(parsed.addedFiles));
            assert.ok(Array.isArray(parsed.watchedFiles));
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// -----------------------------------------------------------------------------
// DELETE /api/watch
// -----------------------------------------------------------------------------

test('route DTO: DELETE /api/watch with missing path returns 400 with error shape', async () => {
    await withServer({}, async (req) => {
        const result = await req({
            method: 'DELETE',
            path: '/api/watch',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.equal(result.status, 400, `status=${result.status} body=${result.body}`);
        const parsed = WatchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: DELETE /api/watch response matches remove-result shape', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-http-unwatch-'));
    fs.writeFileSync(path.join(tmp, 'foo.ts'), 'export const x = 1;\n');

    try {
        await withServer({ config: { workspaceRoot: tmp } }, async (req) => {
            assert.ok(WatchRequestSchema.parse({ path: 'foo.ts' }));

            const result = await req({
                method: 'DELETE',
                path: '/api/watch',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'foo.ts' }),
            });
            // Remove may return 200 or 400 — both must match the schema.
            assert.ok(
                result.status === 200 || result.status === 400,
                `unexpected status ${result.status}: ${result.body}`,
            );
            const parsed = WatchRemoveResponseSchema.parse(JSON.parse(result.body));
            assert.ok(typeof parsed.success === 'boolean');
            assert.ok(Array.isArray(parsed.removedFiles));
            assert.ok(Array.isArray(parsed.watchedFiles));
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// -----------------------------------------------------------------------------
// GET /api/arch
// -----------------------------------------------------------------------------

test('route DTO: GET /api/arch with missing query parameter returns 400', async () => {
    await withServer({}, async (req) => {
        const result = await req({ method: 'GET', path: '/api/arch' });
        assert.equal(result.status, 400, `body=${result.body}`);
        const parsed = ArchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: GET /api/arch with missing doc returns 404 with error shape', async () => {
    await withServer({}, async (req) => {
        const result = await req({
            method: 'GET',
            path: '/api/arch?path=does-not-exist',
        });
        assert.equal(result.status, 404, `body=${result.body}`);
        const parsed = ArchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: GET /api/arch with seeded doc returns 200 with full shape', async () => {
    await withServer(
        {
            archWatcher: {
                readDoc: async () => ({ markdown: '# hello', html: '<h1>hello</h1>' }),
                writeDoc: async () => true,
            } as any,
        },
        async (req) => {
            const result = await req({
                method: 'GET',
                path: '/api/arch?path=src/foo',
            });
            assert.equal(result.status, 200, `body=${result.body}`);
            const parsed = ArchGetResponse200Schema.parse(JSON.parse(result.body));
            assert.equal(parsed.success, true);
            assert.equal(parsed.path, 'src/foo');
            assert.equal(parsed.markdown, '# hello');
            assert.equal(parsed.html, '<h1>hello</h1>');
        },
    );
});

// -----------------------------------------------------------------------------
// POST /api/arch
// -----------------------------------------------------------------------------

test('route DTO: POST /api/arch with missing markdown returns 400', async () => {
    await withServer({}, async (req) => {
        const result = await req({
            method: 'POST',
            path: '/api/arch',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'src/foo' }),
        });
        assert.equal(result.status, 400, `body=${result.body}`);
        const parsed = ArchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: POST /api/arch with missing path returns 400', async () => {
    await withServer({}, async (req) => {
        const result = await req({
            method: 'POST',
            path: '/api/arch',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markdown: '# hello' }),
        });
        assert.equal(result.status, 400, `body=${result.body}`);
        const parsed = ArchErrorResponseSchema.parse(JSON.parse(result.body));
        assert.equal(parsed.success, false);
    });
});

test('route DTO: POST /api/arch with valid body returns 200 with full shape', async () => {
    await withServer(
        {
            archWatcher: {
                readDoc: async () => null,
                writeDoc: async () => true,
            } as any,
        },
        async (req) => {
            const requestBody = { path: 'src/foo', markdown: '# hello' };
            assert.ok(ArchPostRequestSchema.parse(requestBody));

            const result = await req({
                method: 'POST',
                path: '/api/arch',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });
            assert.equal(result.status, 200, `body=${result.body}`);
            const parsed = ArchPostResponse200Schema.parse(JSON.parse(result.body));
            assert.equal(parsed.success, true);
            assert.equal(parsed.path, 'src/foo');
        },
    );
});
