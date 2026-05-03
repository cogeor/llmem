/**
 * Webview regeneration + source-change handling.
 *
 * Loop 11 lifted these helpers out of `GraphServer` so `index.ts` only
 * holds the lifecycle wiring. The class still owns the `isRegenerating`
 * latch and websocket service references; this module exposes pure-ish
 * functions the class composes.
 */

import * as path from 'path';
import { generateGraph as generateGraphLauncher } from '../web-launcher';
import { scanFile } from '../../application/scan';
import { asWorkspaceRoot } from '../../core/paths';
import type { Logger } from '../../core/logger';
import type { WebSocketService } from './websocket';
import type { ArchFileEvent } from './arch-watcher';

export interface RegenerateDeps {
    workspaceRoot: string;
    artifactRoot: string;
    verbose: boolean;
    webSocket: WebSocketService;
    logger: Logger;
}

/**
 * Regenerate the static webview and broadcast a websocket reload.
 */
export async function regenerateWebview(deps: RegenerateDeps): Promise<void> {
    console.log('Regenerating webview...');
    const result = await generateGraphLauncher({
        workspaceRoot: deps.workspaceRoot,
        artifactRoot: deps.artifactRoot,
        graphOnly: false,
    });

    if (deps.verbose) {
        console.log('Graph generated:');
        console.log(`  Import: ${result.importNodeCount} nodes, ${result.importEdgeCount} edges`);
        console.log(`  Call: ${result.callNodeCount} nodes, ${result.callEdgeCount} edges`);
    }
    console.log('Webview updated');

    deps.webSocket.broadcast({
        type: 'reload',
        message: 'Graph updated, reloading...',
    });
}

/**
 * Run `scanFile` on every changed source path, then regenerate the webview.
 */
export async function rescanSourcesAndRegenerate(
    files: string[],
    deps: RegenerateDeps,
): Promise<void> {
    console.log(`Regenerating edges for ${files.length} changed file(s)...`);
    const artifactDir = path.join(deps.workspaceRoot, deps.artifactRoot);

    for (const file of files) {
        await scanFile({
            workspaceRoot: asWorkspaceRoot(deps.workspaceRoot),
            filePath: file,
            artifactDir,
            logger: deps.logger,
        });
    }

    console.log('Edges regenerated');
    await regenerateWebview(deps);
}

/**
 * Translate an ArchWatcher event into a websocket broadcast.
 */
export function broadcastArchEvent(
    event: ArchFileEvent,
    webSocket: WebSocketService,
): void {
    console.log(`[GraphServer] Arch event: ${event.type} ${event.relativePath}`);

    const wsType =
        `arch:${event.type}` as 'arch:created' | 'arch:updated' | 'arch:deleted';

    console.log(
        `[GraphServer] Broadcasting ${wsType} to ${webSocket.getClientCount()} clients`,
    );

    webSocket.broadcastArchEvent(
        wsType,
        event.relativePath,
        event.markdown,
        event.html,
    );
}
