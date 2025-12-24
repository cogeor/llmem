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

    // Marked module (dynamically imported)
    private marked: any = null;

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

        // Load marked for markdown conversion
        await this.loadMarked();

        // Ensure .arch directory exists
        if (!fs.existsSync(this.archDir)) {
            try {
                fs.mkdirSync(this.archDir, { recursive: true });
                if (this.config.verbose) {
                    console.log('[ArchWatcher] Created .arch directory');
                }
            } catch (e) {
                console.error('[ArchWatcher] Failed to create .arch directory:', e);
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
            console.log(`[ArchWatcher] Chokidar 'add' event: ${filePath}`);
            if (filePath.endsWith('.md')) {
                this.handleEvent('created', filePath);
            }
        });
        this.watcher.on('change', (filePath) => {
            console.log(`[ArchWatcher] Chokidar 'change' event: ${filePath}`);
            if (filePath.endsWith('.md')) {
                this.handleEvent('updated', filePath);
            }
        });
        this.watcher.on('unlink', (filePath) => {
            console.log(`[ArchWatcher] Chokidar 'unlink' event: ${filePath}`);
            if (filePath.endsWith('.md')) {
                this.handleEvent('deleted', filePath);
            }
        });
        this.watcher.on('error', (error) => {
            console.error(`[ArchWatcher] Chokidar error:`, error);
        });
        this.watcher.on('ready', () => {
            console.log(`[ArchWatcher] Chokidar ready - now watching for changes`);
        });

        // Always log this for debugging
        console.log(`[ArchWatcher] Watching: ${watchPattern}`);
    }

    /**
     * Load marked module dynamically (ESM module)
     */
    private async loadMarked(): Promise<void> {
        try {
            const dynamicImport = new Function('specifier', 'return import(specifier)');
            const module = await dynamicImport('marked');
            this.marked = module.marked;
            if (this.config.verbose) {
                console.log('[ArchWatcher] Loaded marked module');
            }
        } catch (e) {
            console.error('[ArchWatcher] Failed to load marked:', e);
        }
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
            this.pendingEvents.delete(absolutePath);
            await this.emitEvent(type, absolutePath);
        }, this.debounceDelay);

        this.pendingEvents.set(absolutePath, timeout);
    }

    /**
     * Emit file event
     */
    private async emitEvent(type: 'created' | 'updated' | 'deleted', absolutePath: string): Promise<void> {
        const relativePath = path.relative(this.archDir, absolutePath).replace(/\\/g, '/');

        // Always log for debugging
        console.log(`[ArchWatcher] ${type}: ${relativePath}`);

        const event: ArchFileEvent = {
            type,
            relativePath,
            absolutePath,
        };

        // For created/updated, read and convert the file
        if (type !== 'deleted' && fs.existsSync(absolutePath)) {
            try {
                event.markdown = fs.readFileSync(absolutePath, 'utf-8');
                if (this.marked) {
                    event.html = await this.marked.parse(event.markdown);
                }
            } catch (e) {
                console.error(`[ArchWatcher] Failed to read file: ${absolutePath}`, e);
            }
        }

        if (this.onEvent) {
            this.onEvent(event);
        }
    }

    /**
     * Read a specific design doc by relative path
     * @param relativePath Path relative to .arch, e.g. "src/parser.md"
     * @returns DesignDoc or null if not found
     */
    async readDoc(relativePath: string): Promise<{ markdown: string; html: string } | null> {
        // Ensure marked is loaded
        if (!this.marked) {
            await this.loadMarked();
        }

        // Ensure .md extension
        const mdPath = relativePath.endsWith('.md') ? relativePath : `${relativePath}.md`;
        const absolutePath = path.join(this.archDir, mdPath);

        if (!fs.existsSync(absolutePath)) {
            return null;
        }

        try {
            const markdown = fs.readFileSync(absolutePath, 'utf-8');
            let html = '';
            if (this.marked) {
                html = await this.marked.parse(markdown);
            }
            return { markdown, html };
        } catch (e) {
            console.error(`[ArchWatcher] Failed to read doc: ${absolutePath}`, e);
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

        try {
            // Ensure directory exists
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(absolutePath, markdown, 'utf-8');

            if (this.config.verbose) {
                console.log(`[ArchWatcher] Wrote: ${mdPath}`);
            }

            return true;
        } catch (e) {
            console.error(`[ArchWatcher] Failed to write doc: ${absolutePath}`, e);
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
            console.log('[ArchWatcher] Closed');
        }
    }
}
