/**
 * Unit tests for open_window's live-serve detection (Loop PH-06).
 *
 * open_window is a read-flavored tool that historically always wrote a static
 * snapshot and returned a `file://` URL many agents can't open. PH-06 adds a
 * TCP probe of the serve port(s) so that, when `llmem serve` is running, the
 * tool returns the LIVE `http://localhost:<port>` URL (and skips the disk
 * write); otherwise it keeps the static snapshot but states clearly that it is
 * static.
 *
 * Test strategy (deterministic, no real port binding for the branch tests):
 *   - LIVE branch:   inject a stub `findLivePort` returning a port → assert the
 *                    response carries the http:// URL and says "live".
 *   - STATIC branch: inject a stub `findLivePort` returning `null` AND a stub
 *                    `generateSnapshot` returning a fake index path → assert the
 *                    response carries a file:// URL and says "static" (the real
 *                    snapshot path needs a built webview + populated edge lists,
 *                    which the integration suite already exercises).
 *   - probe helper:  one real-bind smoke test that `findLiveServePort` finds a
 *                    net.Server bound to DEFAULT_PORT (with a fallback to
 *                    DEFAULT_PORT+1 if the default is already taken locally).
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';

import {
    handleOpenWindow,
    probePort,
    findLiveServePort,
} from '../../../src/mcp/tools/open-window';
import { setStoredWorkspaceRoot, setStoredConfig } from '../../../src/mcp/server';
import { DEFAULT_CONFIG, DEFAULT_PORT } from '../../../src/config-defaults';

interface SuccessData {
    message: string;
    url: string;
    mode: string;
    note: string;
}

describe('open_window: live serve detection', () => {
    let root: string;
    const FAKE_INDEX = path.join('C:', 'tmp', 'llmem-fake', 'webview', 'index.html');

    before(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-openwin-'));
        setStoredWorkspaceRoot(root);
        setStoredConfig({ ...DEFAULT_CONFIG });
    });

    after(() => {
        setStoredWorkspaceRoot(null);
        setStoredConfig(null);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('LIVE: returns http://localhost:<port> and says it is live (no snapshot written)', async () => {
        let snapshotCalled = false;
        const response = await handleOpenWindow(
            {},
            {
                findLivePort: async () => DEFAULT_PORT,
                generateSnapshot: async () => {
                    snapshotCalled = true;
                    return FAKE_INDEX;
                },
            },
        );

        assert.equal(response.status, 'success', `got: ${JSON.stringify(response)}`);
        const data = response.data as SuccessData;
        assert.equal(data.url, `http://localhost:${DEFAULT_PORT}`);
        assert.equal(data.mode, 'live');
        assert.match(data.note, /LIVE/);
        // No disk write means no `file://` anywhere in the payload.
        assert.ok(!data.url.startsWith('file://'), 'live URL must not be file://');
        assert.equal(snapshotCalled, false, 'live path must skip the static snapshot write');
    });

    test('LIVE: honors the +1 fallback port reported by the probe', async () => {
        const response = await handleOpenWindow(
            {},
            { findLivePort: async () => DEFAULT_PORT + 1 },
        );
        const data = response.data as SuccessData;
        assert.equal(data.url, `http://localhost:${DEFAULT_PORT + 1}`);
        assert.equal(data.mode, 'live');
    });

    test('STATIC: no serve → returns file:// URL and says it is a static snapshot', async () => {
        const response = await handleOpenWindow(
            {},
            {
                findLivePort: async () => null,
                generateSnapshot: async () => FAKE_INDEX,
            },
        );

        assert.equal(response.status, 'success', `got: ${JSON.stringify(response)}`);
        const data = response.data as SuccessData;
        assert.ok(data.url.startsWith('file://'), `expected file:// URL, got ${data.url}`);
        // The file:// URL points at the generated index.html (forward-slashed).
        assert.match(data.url, /index\.html$/);
        assert.equal(data.mode, 'static');
        assert.match(data.note, /STATIC/);
        // Hints at the live alternative.
        assert.match(data.note, /llmem serve/);
    });
});

describe('open_window: probe helper (real bind)', () => {
    test('findLiveServePort detects a server bound to DEFAULT_PORT (or +1)', async () => {
        // Try the default port; if the local machine already has it taken,
        // fall back to DEFAULT_PORT+1 so the test stays deterministic.
        const tryBind = (port: number): Promise<net.Server | null> =>
            new Promise((resolve) => {
                const server = net.createServer();
                server.once('error', () => resolve(null));
                server.listen(port, '127.0.0.1', () => resolve(server));
            });

        let boundPort = DEFAULT_PORT;
        let server = await tryBind(DEFAULT_PORT);
        if (!server) {
            boundPort = DEFAULT_PORT + 1;
            server = await tryBind(DEFAULT_PORT + 1);
        }
        assert.ok(server, 'could not bind DEFAULT_PORT or DEFAULT_PORT+1 for the probe test');

        try {
            const found = await findLiveServePort();
            assert.equal(found, boundPort, `probe should find the bound port ${boundPort}`);
        } finally {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
        }
    });

    test('probePort resolves false for a (almost certainly) closed port', async () => {
        // Pick an ephemeral port, bind+close it to confirm nothing is listening.
        const ephemeral = await new Promise<number>((resolve) => {
            const s = net.createServer();
            s.listen(0, '127.0.0.1', () => {
                const addr = s.address();
                const port = typeof addr === 'object' && addr ? addr.port : 0;
                s.close(() => resolve(port));
            });
        });
        const alive = await probePort(ephemeral, 200);
        assert.equal(alive, false);
    });
});
