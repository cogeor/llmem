/**
 * Arch Watcher Service
 *
 * Dedicated file watcher for .arch directory.
 * Watches markdown files and emits incremental updates via WebSocket.
 * Completely separated from source file watching for edge regeneration.
 *
 * Loop 24: every direct `fs.*` use site is replaced with `WorkspaceIO`
 * (rooted on the *workspace*, not on `.arch`). The previous textual
 * `assertInArchDir` containment check is retired in favor of:
 *
 *   1. an explicit `.arch/` prefix check on the workspace-relative path
 *      (preserves the old "operates only inside .arch" contract), and
 *   2. `WorkspaceIO`'s realpath layer (defeats symlink-target-outside-
 *      workspace attacks).
 *
 * Chokidar is intentionally NOT routed through `WorkspaceIO` — it is the
 * OS notification surface and needs absolute paths for its watch syscalls.
 * The actual reads / writes triggered by chokidar events flow through
 * `WorkspaceIO`.
 */

import * as path from 'path';
import * as chokidar from 'chokidar';
import { renderMarkdown } from '../../webview/markdown-renderer';
import { createLogger } from '../../common/logger';
import type { WorkspaceContext } from '../../application/workspace-context';
import { PathEscapeError } from '../../core/errors';

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
 * Watcher service for .arch directory
 * Emits events when design documents are created, updated, or deleted.
 *
 * Loop 04: takes a `WorkspaceContext` instead of `(workspaceRoot, io, verbose)`.
 */
export class ArchWatcherService {
    private watcher: chokidar.FSWatcher | null = null;
    private readonly ctx: WorkspaceContext;
    private readonly verbose: boolean;
    private archDir: string;
    /** `.arch` path expressed as a workspace-relative string. */
    private archRel: string;
    private onEvent?: (event: ArchFileEvent) => void;

    // Debounce state per file
    private pendingEvents: Map<string, NodeJS.Timeout> = new Map();
    private debounceDelay = 300; // ms

    constructor(ctx: WorkspaceContext, verbose = false) {
        this.ctx = ctx;
        this.verbose = verbose;
        this.archDir = this.ctx.archRoot;
        this.archRel = this.ctx.archRootRel;
    }

    /**
     * Initialize the watcher
     * @param onEvent Callback for file events
     */
    async setup(onEvent: (event: ArchFileEvent) => void): Promise<void> {
        this.onEvent = onEvent;

        // Ensure .arch directory exists. L24: io.mkdirRecursive realpath-
        // validates the parent containment.
        if (!(await this.ctx.io.exists(this.archRel))) {
            try {
                await this.ctx.io.mkdirRecursive(this.archRel);
                if (this.verbose) {
                    log.info('Created .arch directory');
                }
            } catch (e) {
                log.error('Failed to create .arch directory', {
                    error: e instanceof Error ? e.message : String(e),
                });
                return;
            }
        }

        // Setup chokidar watcher for .arch directory
        // Watch the directory directly and filter for .md files in events
        const watchPattern = this.archDir;

        this.watcher = chokidar.watch(watchPattern, {
            persistent: true,
            ignoreInitial: true,
            // Use polling on Windows for more reliable detection
            usePolling: process.platform === 'win32',
            interval: 100,
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 50
            }
        });

        this.watcher.on('add', (filePath) => {
            log.debug("Chokidar 'add' event", { filePath });
            if (filePath.endsWith('.md')) {
                this.handleEvent('created', filePath);
            }
        });
        this.watcher.on('change', (filePath) => {
            log.debug("Chokidar 'change' event", { filePath });
            if (filePath.endsWith('.md')) {
                this.handleEvent('updated', filePath);
            }
        });
        this.watcher.on('unlink', (filePath) => {
            log.debug("Chokidar 'unlink' event", { filePath });
            if (filePath.endsWith('.md')) {
                this.handleEvent('deleted', filePath);
            }
        });
        this.watcher.on('error', (error) => {
            log.error('Chokidar error', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
        this.watcher.on('ready', () => {
            log.info('Chokidar ready - now watching for changes');
        });

        log.info('Watching', { watchPattern });
    }

    /**
     * Handle file event with debouncing
     */
    private handleEvent(type: 'created' | 'updated' | 'deleted', absolutePath: string): void {
        // Cancel any pending event for this file
        const pending = this.pendingEvents.get(absolutePath);
        if (pending) {
            clearTimeout(pending);
        }

        // Schedule new event
        const timeout = setTimeout(async () => {
            try {
                this.pendingEvents.delete(absolutePath);
                await this.emitEvent(type, absolutePath);
            } catch (e) {
                log.error('Error in debounce handler', {
                    absolutePath,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, this.debounceDelay);

        this.pendingEvents.set(absolutePath, timeout);
    }

    /**
     * Emit file event
     */
    private async emitEvent(type: 'created' | 'updated' | 'deleted', absolutePath: string): Promise<void> {
        const relativePath = path.relative(this.archDir, absolutePath).replace(/\\/g, '/');

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
            const wsRel = path.relative(this.ctx.io.getRealRoot(), absolutePath).replace(/\\/g, '/');
            try {
                if (await this.ctx.io.exists(wsRel)) {
                    event.markdown = await this.ctx.io.readFile(wsRel, 'utf-8');
                    event.html = await renderMarkdown(event.markdown);
                }
            } catch (e) {
                log.error('Failed to read file', {
                    absolutePath,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        if (this.onEvent) {
            this.onEvent(event);
        }
    }

    /**
     * Compute the workspace-relative path for a doc inside `.arch`. Throws
     * `PathEscapeError` when `relativePath` traverses out of `.arch` —
     * preserves the L23-and-prior contract that this surface only ever
     * touches files under `.arch/` (the realpath layer in `WorkspaceIO`
     * adds the symlink-escape protection on top).
     */
    private archDocWsRel(relativePath: string): string {
        const mdPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;
        const wsRel = path.join(this.archRel, mdPath).replace(/\\/g, '/');
        const archPrefix = this.archRel.endsWith('/') ? this.archRel : `${this.archRel}/`;
        if (wsRel !== this.archRel && !wsRel.startsWith(archPrefix)) {
            throw new PathEscapeError(this.archDir, relativePath);
        }
        return wsRel;
    }

    /**
     * Read a specific design doc by relative path
     * @param relativePath Path relative to .arch, e.g. "src/parser.md"
     * @returns DesignDoc or null if not found
     */
    async readDoc(relativePath: string): Promise<{ markdown: string; html: string } | null> {
        let wsRel: string;
        try {
            wsRel = this.archDocWsRel(relativePath);
        } catch (e) {
            // PathEscapeError → propagate so HTTP route can render 400.
            if (e instanceof Error && e.name === 'PathEscapeError') throw e;
            throw e;
        }

        try {
            if (!(await this.ctx.io.exists(wsRel))) {
                return null;
            }
            const markdown = await this.ctx.io.readFile(wsRel, 'utf-8');
            const html = await renderMarkdown(markdown);
            return { markdown, html };
        } catch (e) {
            // PathEscapeError must surface; other errors get logged + null.
            if (e instanceof Error && e.name === 'PathEscapeError') throw e;
            log.error('Failed to read doc', {
                wsRel,
                error: e instanceof Error ? e.message : String(e),
            });
            return null;
        }
    }

    /**
     * Write a design doc
     * @param relativePath Path relative to .arch (without .md extension)
     * @param markdown Markdown content
     * @returns Success status
     */
    async writeDoc(relativePath: string, markdown: string): Promise<boolean> {
        const wsRel = this.archDocWsRel(relativePath);

        try {
            // Ensure directory exists. L24: io.mkdirRecursive does the
            // realpath check on the parent.
            const dirRel = path.dirname(wsRel);
            await this.ctx.io.mkdirRecursive(dirRel);
            await this.ctx.io.writeFile(wsRel, markdown);

            if (this.verbose) {
                log.debug('Wrote doc', { wsRel });
            }

            return true;
        } catch (e) {
            // PathEscapeError must surface; other errors get logged + false.
            if (e instanceof Error && e.name === 'PathEscapeError') throw e;
            log.error('Failed to write doc', {
                wsRel,
                error: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    }

    /**
     * Check if .arch directory exists.
     *
     * L24: returns Promise<boolean> (was synchronous boolean) because
     * realpath-strong existence checking requires async fs.realpath.
     */
    async hasArchDir(): Promise<boolean> {
        return this.ctx.io.exists(this.archRel);
    }

    /**
     * Get the .arch directory path
     */
    getArchDir(): string {
        return this.archDir;
    }

    /**
     * Close the watcher
     */
    async close(): Promise<void> {
        // Clear pending events
        for (const timeout of this.pendingEvents.values()) {
            clearTimeout(timeout);
        }
        this.pendingEvents.clear();

        // Close watcher
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }

        if (this.verbose) {
            log.debug('Closed');
        }
    }
}
