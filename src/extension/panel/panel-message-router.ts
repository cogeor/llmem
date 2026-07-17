/**
 * Panel message router (Loop 15 split).
 *
 * Carved verbatim from the former `panel.ts` monolith: the `_handleMessage`
 * switch that dispatches webview→panel messages to the data handlers. A free
 * function taking the `PanelHost` so the controller just forwards each
 * incoming message here.
 *
 * Re-exported through the `panel.ts` barrel; consumed by the panel
 * controller.
 */

import type { PanelHost } from './panel-host';
import {
    loadFolderNodes,
    loadFolderTree,
    loadFolderEdges,
} from './panel-data-handlers';
import {
    handleToggleWatch,
    startHotReloadAndSendInitialData,
} from './panel-watch-handlers';

/**
 * Minimal shape of a webview -> panel message. The `command`/`type`
 * discriminant selects the case; the remaining fields are the arguments each
 * handler reads for its case (guaranteed present by the webview sender). This
 * is an untrusted external boundary — kept intentionally narrow rather than
 * widened to `any`.
 */
interface PanelInboundMessage {
    command?: string;
    type?: string;
    folderPath: string;
    requestId?: string;
    path: string;
    watched: boolean;
}

export async function handleMessage(host: PanelHost, message: PanelInboundMessage): Promise<void> {
    switch (message.command || message.type) {
        case 'webview:ready':
            await startHotReloadAndSendInitialData(host);
            break;
        case 'loadFolderNodes':
            await loadFolderNodes(host, message.folderPath);
            break;
        // Loop 02: panel-side echo for whole-tree / whole-edgelist data
        // requests posted by `VSCodeDataProvider.loadFolderTree()` and
        // `loadFolderEdges()`. The webview-side handler ignores responses
        // whose `requestId` is not a string (see vscodeDataProvider.ts
        // lines 194 and 209), so we forward `message.requestId` as-is —
        // typed-unioning the message shape is loop 14's concern.
        case 'loadFolderTree':
            await loadFolderTree(host, message.requestId);
            break;
        case 'loadFolderEdges':
            await loadFolderEdges(host, message.requestId);
            break;
        case 'toggleWatch':
            // Loop 14: pass through the webview-supplied requestId so
            // the response message can be matched back to the right
            // pending promise in `VSCodeDataProvider.toggleWatch`.
            await handleToggleWatch(host, message.path, message.watched, message.requestId);
            break;
    }
}
