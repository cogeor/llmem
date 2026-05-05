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

export const OpenWindowSchema = z.object({
    viewColumn: z.number().optional().describe('View column to open in (1-3)'),
});

export type OpenWindowInput = z.infer<typeof OpenWindowSchema>;

async function handleOpenWindowImpl(
    args: unknown
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(OpenWindowSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const ctx = await getStoredContext();
    const artifactDir = ctx.artifactRoot;

    // Load split edge lists and build graphs
    const importStore = new ImportEdgeListStore(artifactDir);
    const callStore = new CallEdgeListStore(artifactDir);
    await Promise.all([importStore.load(), callStore.load()]);
    const graphData = prepareWebviewDataFromSplitEdgeLists(importStore.getData(), callStore.getData());

    // Generate Webview
    const webviewDir = path.join(artifactDir, 'webview');
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');

    const indexPath = await generateStaticWebview(
        webviewDir,
        extensionRoot,
        ctx.workspaceRoot,
        graphData,
        {},
        undefined,
        ctx,
    );

    return formatSuccess({
        message: 'Webview generated successfully.',
        url: `file://${indexPath.replace(/\\/g, '/')}`,
        note: 'Please open this URL in your browser to view the graph.',
    });
}

export const handleOpenWindow = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'open_window',
        },
        handleOpenWindowImpl
    )(args);

export const openWindowTool = {
    name: 'open_window',
    description: 'Open the LLMem graph visualization. In standalone mode (Claude Code CLI) this opens a file:// URL in the browser; in IDE mode (VS Code / Antigravity) it opens an integrated webview panel.',
    schema: OpenWindowSchema,
    handler: handleOpenWindow,
};
