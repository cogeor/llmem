/**
 * MCP tool: open_window
 *
 * Generates a static webview for browser viewing. The workspace root and
 * configuration come from server initialization; the caller only chooses
 * the optional view column.
 *
 * Loop 04: shares the server-side `WorkspaceContext` via
 * `getStoredContext()`. The artifact directory is read from
 * `ctx.artifactRoot`, replacing the inline `path.join(root, config.artifactRoot)`.
 */

import { z } from 'zod';
import * as path from 'path';
import * as net from 'net';
import {
    McpResponse,
    validateRequest,
    formatSuccess,
    formatError,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import { getStoredContext } from '../server';
import { generateStaticWebview } from '../../webview/generator';
import { prepareWebviewDataFromSplitEdgeLists } from '../../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../../graph/edgelist';
import { DEFAULT_PORT } from '../../config-defaults';

export const OpenWindowSchema = z.object({
    viewColumn: z.number().optional().describe('View column to open in (1-3)'),
});

export type OpenWindowInput = z.infer<typeof OpenWindowSchema>;

/**
 * TCP-probe a single port on 127.0.0.1. Resolves `true` if a connection is
 * established (something is listening), `false` on error or timeout.
 *
 * This is a best-effort liveness check — there is no pidfile, so a connect
 * only tells us *some* process holds the port. The caller probes
 * `DEFAULT_PORT` and the documented `+1` fallback to find a live `serve`.
 */
export function probePort(port: number, timeoutMs = 300): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' });
        let settled = false;
        const done = (alive: boolean) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(alive);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

/**
 * Find a live `serve` by probing the default port then its documented `+1`
 * fallback (see `cli-port-fallback`: serve walks to DEFAULT_PORT+1 when the
 * default is taken). Returns the first live port, or `null` if none respond.
 */
export async function findLiveServePort(
    probe: (port: number) => Promise<boolean> = probePort,
): Promise<number | null> {
    if (await probe(DEFAULT_PORT)) return DEFAULT_PORT;
    if (await probe(DEFAULT_PORT + 1)) return DEFAULT_PORT + 1;
    return null;
}

/**
 * Generate the static webview snapshot from the stored WorkspaceContext and
 * return the absolute path to the written `index.html`. This is the
 * disk-writing, no-serve fallback path — extracted so it can be stubbed in
 * tests (it requires a built webview + populated edge lists in production).
 */
export async function generateStaticSnapshot(): Promise<string> {
    const ctx = await getStoredContext();
    const artifactDir = ctx.artifactRoot;

    // Load split edge lists and build graphs
    const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
    const callStore = new CallEdgeListStore(artifactDir, ctx.io);
    await Promise.all([importStore.load(), callStore.load()]);
    const graphData = prepareWebviewDataFromSplitEdgeLists(importStore.getData(), callStore.getData());

    // Generate Webview
    const webviewDir = path.join(artifactDir, 'webview');
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');

    return generateStaticWebview(
        webviewDir,
        extensionRoot,
        ctx.workspaceRoot,
        graphData,
        {},
        undefined,
        ctx,
    );
}

/**
 * Dependencies injectable for testing the live-vs-static branch
 * deterministically without binding real ports or building a webview.
 */
export interface OpenWindowDeps {
    findLivePort?: () => Promise<number | null>;
    generateSnapshot?: () => Promise<string>;
}

async function handleOpenWindowImpl(
    args: unknown,
    deps: OpenWindowDeps = {},
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(OpenWindowSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    // Prefer a running `serve`: return its live, browser-openable localhost
    // URL and skip the disk-writing static snapshot (this is a read-flavored
    // tool — avoid mutating disk when a live server can render the graph).
    const findLivePort = deps.findLivePort ?? (() => findLiveServePort());
    const livePort = await findLivePort();
    if (livePort !== null) {
        return formatSuccess({
            message: `LLMem serve is running. Open the live graph in your browser.`,
            url: `http://localhost:${livePort}`,
            mode: 'live',
            note: `This is the LIVE server at http://localhost:${livePort} — open it directly in a browser.`,
        });
    }

    const generateSnapshot = deps.generateSnapshot ?? generateStaticSnapshot;
    const indexPath = await generateSnapshot();

    return formatSuccess({
        message: 'Generated a STATIC snapshot of the graph.',
        url: `file://${indexPath.replace(/\\/g, '/')}`,
        mode: 'static',
        note:
            'This is a STATIC snapshot written to a local file path (the ' +
            'file:// URL above), not a live server — some agents/browsers ' +
            'cannot open file:// URLs. Run `llmem serve` for a live, ' +
            'browser-openable URL (http://localhost:' + DEFAULT_PORT + ').',
    });
}

export const handleOpenWindow = (args: unknown, deps?: OpenWindowDeps) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'open_window',
        },
        (a: unknown) => handleOpenWindowImpl(a, deps)
    )(args);

export const openWindowTool = {
    name: 'open_window',
    description:
        'Open the LLMem graph visualization. If `llmem serve` is running, ' +
        'returns the LIVE, browser-openable localhost URL (no disk write). ' +
        'Otherwise writes a STATIC HTML snapshot and returns a local file:// ' +
        'URL (which some agents/browsers cannot open) — the response states ' +
        'whether it is live or static. In IDE mode (VS Code / Antigravity) ' +
        'it opens an integrated webview panel.',
    schema: OpenWindowSchema,
    handler: handleOpenWindow,
};
