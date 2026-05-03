/**
 * Arch Watcher Service
 *
 * Dedicated file watcher for .arch directory.
 * Watches markdown files and emits incremental updates via WebSocket.
 * Completely separated from source file watching for edge regeneration.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { renderMarkdown } from '../../webview/markdown-renderer';
import { createLogger } from '../../common/logger';

const log = createLogger('arch-watcher');

export interface ArchWatcherConfig {
    workspaceRoot: string;
    verbose?: boolean;
}

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
 */
export class ArchWatcherService {
    private watcher: chokidar.FSWatcher | null = null;
    private config: Required<ArchWatcherConfig>;
    private archDir: string;
    private onEvent?: (event: ArchFileEvent) => void;

    // Debounce state per file
    private pendingEvents: Map<string, NodeJS.Timeout> = new Map();
    private debounceDelay = 300; // ms

    constructor(config: ArchWatcherConfig) {
        this.config = {
            workspaceRoot: config.workspaceRoot,
            verbose: config.verbose || false,
        };
        this.archDir = path.join(this.config.workspaceRoot, '.arch');
    }

    /**
     * Initialize the watcher
     * @param onEvent Callback for file events
     */
    async setup(onEvent: (event: ArchFileEvent) => void): Promise<void> {
        this.onEvent = onEvent;

        // Ensure .arch directory exists
        if (!fs.existsSync(this.archDir)) {
            try {
                fs.mkdirSync(this.archDir, { recursive: true });
                if (this.config.verbose) {
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

        // For created/updated, read and convert the file
        if (type !== 'deleted' && fs.existsSync(absolutePath)) {
            try {
                event.markdown = fs.readFileSync(absolutePath, 'utf-8');
                event.html = await renderMarkdown(event.markdown);
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
     * Assert that absolutePath is contained within archDir to prevent directory traversal.
     */
    private assertInArchDir(absolutePath: string): void {
        const base = path.resolve(this.archDir);
        const target = path.resolve(absolutePath);
        const sep = path.sep;
        if (!target.startsWith(base + sep) && target !== base) {
            throw new Error(`Path escapes .arch boundary: ${absolutePath}`);
        }
    }

    /**
     * Read a specific design doc by relative path
     * @param relativePath Path relative to .arch, e.g. "src/parser.md"
     * @returns DesignDoc or null if not found
     */
    async readDoc(relativePath: string): Promise<{ markdown: string; html: string } | null> {
        // Ensure .md extension
        const mdPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;
        const absolutePath = path.join(this.archDir, mdPath);

        this.assertInArchDir(absolutePath);

        if (!fs.existsSync(absolutePath)) {
            return null;
        }

        try {
            const markdown = fs.readFileSync(absolutePath, 'utf-8');
            const html = await renderMarkdown(markdown);
            return { markdown, html };
        } catch (e) {
            log.error('Failed to read doc', {
                absolutePath,
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
        // Ensure .md extension
        const mdPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;
        const absolutePath = path.join(this.archDir, mdPath);

        this.assertInArchDir(absolutePath);

        try {
            // Ensure directory exists
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(absolutePath, markdown, 'utf-8');

            if (this.config.verbose) {
                log.debug('Wrote doc', { mdPath });
            }

            return true;
        } catch (e) {
            log.error('Failed to write doc', {
                absolutePath,
                error: e instanceof Error ? e.message : String(e),
            });
            return false;
        }
    }

    /**
     * Check if .arch directory exists
     */
    hasArchDir(): boolean {
        return fs.existsSync(this.archDir);
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

        if (this.config.verbose) {
            log.debug('Closed');
        }
    }
}
