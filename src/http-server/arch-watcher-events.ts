/**
 * Arch Watcher — deterministic helpers
 *
 * Free-function helpers split out of `ArchWatcherService` to keep the
 * service class shell under the platform line budget. These are pure /
 * deterministic: all `this`-state is threaded in as explicit parameters.
 *
 * Two concerns live here:
 *   1. `.arch` path containment (`archDocWsRel`) — preserves the contract
 *      that this surface only ever touches files under `.llmem/docs/`.
 *   2. chokidar-event → `ArchFileEvent` mapping (`buildArchFileEvent`).
 */

import * as path from 'path';
import { renderMarkdown } from '../webview/markdown-renderer';
import { createLogger } from '../common/logger';
import type { WorkspaceContext } from '../application/workspace-context';
import { PathEscapeError } from '../core/errors';

const log = createLogger('arch-watcher');

export interface ArchFileEvent {
    type: 'created' | 'updated' | 'deleted';
    /** Relative path from .arch, e.g. "src/parser.md" */
    relativePath: string;
    /** Full path to the file */
    absolutePath: string;
    /** File content (markdown) - only for created/updated */
    markdown?: string;
    /** Rendered HTML content - only for created/updated */
    html?: string;
}

/**
 * Compute the workspace-relative path for a doc inside `.arch`. Throws
 * `PathEscapeError` when `relativePath` traverses out of `.arch` —
 * preserves the L23-and-prior contract that this surface only ever
 * touches files under `.llmem/docs/` (the realpath layer in `WorkspaceIO`
 * adds the symlink-escape protection on top).
 *
 * `docsRel` is the `.arch` path expressed as a workspace-relative string;
 * `docsDir` is the absolute `.arch` directory (used only for the error).
 */
export function archDocWsRel(docsRel: string, docsDir: string, relativePath: string): string {
    const mdPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;
    const wsRel = path.join(docsRel, mdPath).replace(/\\/g, '/');
    const archPrefix = docsRel.endsWith('/') ? docsRel : `${docsRel}/`;
    if (wsRel !== docsRel && !wsRel.startsWith(archPrefix)) {
        throw new PathEscapeError(docsDir, relativePath);
    }
    return wsRel;
}

/**
 * Build an {@link ArchFileEvent} for a chokidar event.
 *
 * For created/updated the file is read through `WorkspaceIO` (routes the
 * read through realpath containment) and rendered to HTML. Read failures
 * are logged and leave `markdown`/`html` undefined.
 */
export async function buildArchFileEvent(
    ctx: WorkspaceContext,
    docsDir: string,
    type: 'created' | 'updated' | 'deleted',
    absolutePath: string,
): Promise<ArchFileEvent> {
    const relativePath = path.relative(docsDir, absolutePath).replace(/\\/g, '/');

    log.debug('File event', { type, relativePath });

    const event: ArchFileEvent = {
        type,
        relativePath,
        absolutePath,
    };

    // For created/updated, read and convert the file. L24: convert the
    // chokidar absolute path to workspace-relative and route through
    // WorkspaceIO so the read flows through realpath containment.
    if (type !== 'deleted') {
        const wsRel = path.relative(ctx.io.getRealRoot(), absolutePath).replace(/\\/g, '/');
        try {
            if (await ctx.io.exists(wsRel)) {
                event.markdown = await ctx.io.readFile(wsRel, 'utf-8');
                event.html = await renderMarkdown(event.markdown);
            }
        } catch (e) {
            log.error('Failed to read file', {
                absolutePath,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return event;
}
