// tests/unit/web-viewer/vscode-data-provider.test.ts
//
// Loop 14 — pin the request-id keying for VSCodeDataProvider.toggleWatch.
//
// The original single-slot `pendingWatchToggle` field meant a second toggle
// in flight overwrote the first. The Map-keyed-by-requestId implementation
// must:
//   1. resolve concurrent toggles independently, in any response order;
//   2. ignore responses that carry an unknown requestId (stale / bogus);
//   3. fall back to oldest-pending when an extension echoes no requestId
//      at all (legacy panel host);
//   4. reject with a Timeout if no response arrives within 30s.
//
// VSCodeDataProvider depends on three globals at construction time:
//   - `acquireVsCodeApi()` — returns the host-side message bus stub;
//   - `window.addEventListener('message', ...)` — receives back-channel
//     messages from the extension;
//   - `crypto.randomUUID` (preferred) for requestId generation.
//
// Boot a JSDOM window and pin every required global to globalThis BEFORE
// importing the module — this matches the pattern Loop 13 used for
// sanitize.test.ts. Each test resets the mock postMessage queue and
// instantiates a fresh provider so they don't share message listeners.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import type { FolderTreeData } from '../../../src/graph/folder-tree';
import type { FolderEdgelistData } from '../../../src/graph/folder-edges';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

// jsdom exposes addEventListener on its window. We need it on globalThis
// so the production code's `window.addEventListener('message', ...)` lands
// on the jsdom event target.
g.HTMLElement = dom.window.HTMLElement;

// `acquireVsCodeApi` is provided by the VS Code webview runtime. Tests
// install a fresh mock before each provider instantiation; the global
// declaration is enough for the module-load type check.
type Posted = unknown;
let postedMessages: Posted[] = [];
function installMockVsCodeApi(): void {
    (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({
        postMessage(msg: Posted) {
            postedMessages.push(msg);
        },
    });
}
installMockVsCodeApi();

// Some jsdom builds don't expose `crypto.randomUUID`. The provider's
// fallback (a counter) handles this — explicitly delete to exercise it
// here so the test doesn't silently depend on Node's native crypto.
delete (globalThis as { crypto?: unknown }).crypto;

// Now safe to import — the module's `declare const acquireVsCodeApi` is
// resolved at runtime against globalThis.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { VSCodeDataProvider } = require('../../../src/webview/ui/services/vscodeDataProvider') as {
    VSCodeDataProvider: new () => {
        toggleWatch(path: string, watched: boolean): Promise<{
            success: boolean;
            addedFiles?: string[];
            removedFiles?: string[];
        }>;
        loadFolderTree(): Promise<FolderTreeData>;
        loadFolderEdges(): Promise<FolderEdgelistData>;
        hostKind: 'vscode' | 'browser';
    };
};

/**
 * Dispatch a `message` event into the jsdom window so the provider's
 * `window.addEventListener('message', ...)` handler fires. The provider
 * reads `event.data`, so we put the payload there.
 */
function dispatchExtensionMessage(payload: unknown): void {
    const event = new dom.window.MessageEvent('message', { data: payload });
    dom.window.dispatchEvent(event);
}

function freshProvider() {
    postedMessages = [];
    return new VSCodeDataProvider();
}

test('VSCodeDataProvider: hostKind is "vscode"', () => {
    const p = freshProvider();
    assert.equal(p.hostKind, 'vscode');
});

test('VSCodeDataProvider: concurrent toggles resolve independently by requestId', async () => {
    const p = freshProvider();

    // Two toggles in flight.
    const promiseA = p.toggleWatch('src/a.ts', true);
    const promiseB = p.toggleWatch('src/b.ts', false);

    // The provider posted two messages with distinct requestIds. We use
    // those ids to drive the responses back in REVERSED order — this is
    // the bug the keying fixes.
    const sent = postedMessages.filter(
        (m): m is { type: string; requestId: string; path: string; watched: boolean } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'toggleWatch'
    );
    assert.equal(sent.length, 2, 'two toggleWatch messages should be posted');
    assert.notEqual(sent[0].requestId, sent[1].requestId, 'requestIds must be distinct');
    const [reqA, reqB] = sent;

    // Respond to B first, then A — the OLD code would resolve A's promise
    // with B's payload (single-slot overwrite). The keyed code routes
    // each response to its own pending entry.
    dispatchExtensionMessage({
        type: 'state:watchedPaths',
        requestId: reqB.requestId,
        paths: ['src/b.ts'],
        removedFiles: ['src/b.ts'],
    });
    dispatchExtensionMessage({
        type: 'state:watchedPaths',
        requestId: reqA.requestId,
        paths: ['src/a.ts'],
        addedFiles: ['src/a.ts'],
    });

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    assert.deepEqual(resA, { success: true, addedFiles: ['src/a.ts'], removedFiles: undefined });
    assert.deepEqual(resB, { success: true, addedFiles: undefined, removedFiles: ['src/b.ts'] });
});

test('VSCodeDataProvider: response with unknown requestId is ignored (no crash)', async () => {
    const p = freshProvider();

    const promise = p.toggleWatch('src/c.ts', true);

    // First, dispatch a response for an unknown id — must NOT resolve the
    // pending promise and must NOT throw.
    dispatchExtensionMessage({
        type: 'state:watchedPaths',
        requestId: 'this-id-was-never-issued',
        paths: ['src/x.ts'],
        addedFiles: ['src/x.ts'],
    });

    // The pending promise is still unresolved. Race it against a tick
    // microtask resolver — the toggle promise should NOT win.
    const tick = await Promise.race([
        promise.then(() => 'toggleResolved' as const),
        new Promise<'tick'>(r => setTimeout(() => r('tick'), 20)),
    ]);
    assert.equal(tick, 'tick', 'toggle promise should still be pending');

    // Now respond correctly using the real id and confirm the promise
    // resolves.
    const sent = postedMessages.find(
        (m): m is { requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'toggleWatch'
    )!;
    dispatchExtensionMessage({
        type: 'state:watchedPaths',
        requestId: sent.requestId,
        paths: ['src/c.ts'],
        addedFiles: ['src/c.ts'],
    });

    const result = await promise;
    assert.equal(result.success, true);
    assert.deepEqual(result.addedFiles, ['src/c.ts']);
});

test('VSCodeDataProvider: legacy response without requestId resolves the oldest pending', async () => {
    // Backwards-compatibility path — an older extension host echoes no
    // requestId. The provider falls back to oldest-pending so toggles
    // still complete (instead of timing out).
    const p = freshProvider();

    const promise = p.toggleWatch('src/legacy.ts', true);

    dispatchExtensionMessage({
        type: 'state:watchedPaths',
        // no requestId
        paths: ['src/legacy.ts'],
        addedFiles: ['src/legacy.ts'],
    });

    const result = await promise;
    assert.equal(result.success, true);
    assert.deepEqual(result.addedFiles, ['src/legacy.ts']);
});

test('VSCodeDataProvider: toggleWatch rejects with timeout when no response arrives', async () => {
    const p = freshProvider();

    // We can't realistically wait 30s in a test. Instead we monkey-patch
    // setTimeout to fire immediately so the timeout branch is exercised.
    const realSetTimeout = globalThis.setTimeout;
    let firedTimeout: (() => void) | null = null;
    (globalThis as { setTimeout: typeof globalThis.setTimeout }).setTimeout = ((
        fn: () => void,
        _ms: number
    ) => {
        // Capture the first scheduled callback (the toggle's own timeout).
        // Subsequent calls (jsdom internals etc.) get a no-op.
        if (!firedTimeout) {
            firedTimeout = fn;
            return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
        }
        return realSetTimeout(fn, 0);
    }) as typeof globalThis.setTimeout;

    try {
        const promise = p.toggleWatch('src/never.ts', true);
        // Manually fire the captured timeout — drain microtasks first so
        // the provider has actually registered the entry.
        await Promise.resolve();
        const cb = firedTimeout as (() => void) | null;
        assert.ok(cb, 'expected toggleWatch to schedule a timeout');
        cb!();

        await assert.rejects(promise, /Timeout toggling watch for src\/never\.ts/);
    } finally {
        (globalThis as { setTimeout: typeof globalThis.setTimeout }).setTimeout = realSetTimeout;
    }
});

// ---------------------------------------------------------------------------
// Loop 13 — folder-tree / folder-edges request methods.
//
// The methods post `{ type: 'loadFolderTree' | 'loadFolderEdges', requestId }`
// and resolve / reject on a matching `data:folderTree` / `data:folderEdges`
// response with the same requestId. The panel-side handler echoes
// `data:folderTree` / `data:folderEdges` (loop 02). These tests pin the wire
// shape both sides agree on.
// ---------------------------------------------------------------------------

test('VSCodeDataProvider.loadFolderTree posts the correct message type with a fresh requestId', async () => {
    const p = freshProvider();
    // Attach a catch sink so the unhandled-rejection guard in node:test
    // doesn't pick up the eventual 30s timeout if the test exits before
    // the promise settles. We resolve it explicitly below to drain.
    const promise = p.loadFolderTree().catch(() => undefined);

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderTree',
    );
    assert.ok(sent, 'loadFolderTree should post a message of type "loadFolderTree"');
    assert.equal(typeof sent.requestId, 'string');
    assert.ok(sent.requestId.length > 0, 'requestId should be non-empty');

    // Drain the pending promise so it doesn't leak past the test boundary.
    dispatchExtensionMessage({
        type: 'data:folderTree',
        requestId: sent.requestId,
        data: { schemaVersion: 1, timestamp: '', root: { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children: [] } },
    });
    await promise;
});

test('VSCodeDataProvider.loadFolderTree resolves on data:folderTree with matching requestId', async () => {
    const p = freshProvider();
    const promise = p.loadFolderTree();

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderTree',
    )!;
    assert.ok(sent, 'expected a posted loadFolderTree message');

    const fixture: FolderTreeData = {
        schemaVersion: 1,
        timestamp: '2026-05-03T00:00:00.000Z',
        root: { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children: [] },
    };
    dispatchExtensionMessage({
        type: 'data:folderTree',
        requestId: sent.requestId,
        data: fixture,
    });

    const result = await promise;
    assert.deepEqual(result, fixture);
});

test('VSCodeDataProvider.loadFolderTree rejects when host responds with an error', async () => {
    const p = freshProvider();
    const promise = p.loadFolderTree();

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderTree',
    )!;

    dispatchExtensionMessage({
        type: 'data:folderTree',
        requestId: sent.requestId,
        error: 'No folder tree available — run `llmem scan` first.',
    });

    await assert.rejects(
        promise,
        /No folder tree available/,
    );
});

test('VSCodeDataProvider.loadFolderTree ignores responses with unknown requestId', async () => {
    const p = freshProvider();
    const promise = p.loadFolderTree();

    // Dispatch a bogus requestId — the pending promise must NOT resolve.
    dispatchExtensionMessage({
        type: 'data:folderTree',
        requestId: 'bogus-' + Date.now(),
        data: {
            schemaVersion: 1,
            timestamp: '',
            root: { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children: [] },
        },
    });

    // Race against a small timeout — if the promise resolves, keying is broken.
    const settled = await Promise.race([
        promise.then(() => 'resolved' as const),
        new Promise<'pending'>((r) => setTimeout(() => r('pending'), 30)),
    ]);
    assert.equal(settled, 'pending');

    // Now resolve correctly so the test exits cleanly without a 30s timeout.
    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderTree',
    )!;
    dispatchExtensionMessage({
        type: 'data:folderTree',
        requestId: sent.requestId,
        data: {
            schemaVersion: 1,
            timestamp: '',
            root: { path: '', name: '', fileCount: 0, totalLOC: 0, documented: false, children: [] },
        },
    });
    await promise;
});

test('VSCodeDataProvider.loadFolderEdges posts the correct message type with a fresh requestId', async () => {
    const p = freshProvider();
    const promise = p.loadFolderEdges().catch(() => undefined);

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderEdges',
    );
    assert.ok(sent, 'loadFolderEdges should post a message of type "loadFolderEdges"');
    assert.equal(typeof sent.requestId, 'string');
    assert.ok(sent.requestId.length > 0, 'requestId should be non-empty');

    dispatchExtensionMessage({
        type: 'data:folderEdges',
        requestId: sent.requestId,
        data: { schemaVersion: 1, timestamp: '', edges: [], weightP90: 0 },
    });
    await promise;
});

test('VSCodeDataProvider.loadFolderEdges resolves on data:folderEdges with matching requestId', async () => {
    const p = freshProvider();
    const promise = p.loadFolderEdges();

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderEdges',
    )!;

    const fixture: FolderEdgelistData = {
        schemaVersion: 1,
        timestamp: '2026-05-03T00:00:00.000Z',
        edges: [],
        weightP90: 0,
    };
    dispatchExtensionMessage({
        type: 'data:folderEdges',
        requestId: sent.requestId,
        data: fixture,
    });

    const result = await promise;
    assert.deepEqual(result, fixture);
});

test('VSCodeDataProvider.loadFolderEdges rejects when host responds with an error', async () => {
    const p = freshProvider();
    const promise = p.loadFolderEdges();

    const sent = postedMessages.find(
        (m): m is { type: string; requestId: string } =>
            !!m && typeof m === 'object' && (m as { type?: string }).type === 'loadFolderEdges',
    )!;

    dispatchExtensionMessage({
        type: 'data:folderEdges',
        requestId: sent.requestId,
        error: 'No folder edges available — run `llmem scan` first.',
    });

    await assert.rejects(
        promise,
        /No folder edges available/,
    );
});
