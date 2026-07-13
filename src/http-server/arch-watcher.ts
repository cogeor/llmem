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
 *   1. an explicit `.llmem/docs/` prefix check on the workspace-relative path
 *      (preserves the old "operates only inside .arch" contract), and
 *   2. `WorkspaceIO`'s realpath layer (defeats symlink-target-outside-
 *      workspace attacks).
 *
 * Chokidar is intentionally NOT routed through `WorkspaceIO` — it is the
 * OS notification surface and needs absolute paths for its watch syscalls.
 * The reads / writes triggered by chokidar events flow through `WorkspaceIO`.
 *
 * Deterministic helpers (path containment + chokidar-event mapping) live in
 * the sibling `arch-watcher-events` module so this shell stays under budget.
 */

import * as path from 'path';
import * as chokidar from 'chokidar';
import { renderMarkdown } from '../webview/markdown-renderer';
import { createLogger } from '../common/logger';
import type { WorkspaceContext } from '../application/workspace-context';
import { archDocWsRel, buildArchFileEvent } from './arch-watcher-events';
import type { ArchFileEvent } from './arch-watcher-events';

export type { ArchFileEvent } from './arch-watcher-events';

const log = createLogger('arch-watcher');

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
    private docsDir: string;
    /** `.arch` path expressed as a workspace-relative string. */
    private docsRel: string;
    private onEvent?: (event: ArchFileEvent) => void;

    // Debounce state per file
    private pendingEvents: Map<string, NodeJS.Timeout> = new Map();
    private debounceDelay = 300; // ms

    constructor(ctx: WorkspaceContext, verbose = false) {
        this.ctx = ctx;
        this.verbose = verbose;
        this.docsDir = this.ctx.docsRoot;
        this.docsRel = this.ctx.docsRootRel;
    }

    /** Initialize the watcher. @param onEvent Callback for file events */
    async setup(onEvent: (event: ArchFileEvent) => void): Promise<void> {
        this.onEvent = onEvent;

        // Ensure .arch directory exists. L24: io.mkdirRecursive realpath-
        // validates the parent containment.
        if (!(await this.ctx.io.exists(this.docsRel))) {
            try {
                await this.ctx.io.mkdirRecursive(this.docsRel);
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

        // Watch the .arch directory directly; filter for .md files in events.
        const watchPattern = this.docsDir;

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

    /** Handle file event with debouncing */
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
                const event = await buildArchFileEvent(this.ctx, this.docsDir, type, absolutePath);
                if (this.onEvent) {
                    this.onEvent(event);
                }
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
     * Read a specific design doc by relative path
     * @param relativePath Path relative to .arch, e.g. "src/parser.md"
     * @returns DesignDoc or null if not found
     */
    async readDoc(relativePath: string): Promise<{ markdown: string; html: string } | null> {
        const wsRel = archDocWsRel(this.docsRel, this.docsDir, relativePath);

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
        const wsRel = archDocWsRel(this.docsRel, this.docsDir, relativePath);

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
        return this.ctx.io.exists(this.docsRel);
    }

    /** Get the .arch directory path */
    getArchDir(): string {
        return this.docsDir;
    }

    /** Close the watcher */
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
