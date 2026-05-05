/**
 * File Watcher for Source Files and Edge Lists
 *
 * Watches source files (for edge regeneration) and edge lists (for graph updates).
 * Design docs (.arch) are now handled by ArchWatcherService for incremental updates.
 *
 * Loop 04: takes a `WorkspaceContext` instead of the
 * `(workspaceRoot, artifactRoot, io, verbose)` bag.
 */

import * as path from 'path';
import * as chokidar from 'chokidar';
import { WatchService } from '../../graph/worktree-state';
import { createLogger } from '../../common/logger';
import type { WorkspaceContext } from '../../application/workspace-context';

const log = createLogger('file-watcher');

export interface FileChangeEvent {
    type: 'source' | 'edgelist';
    action: 'added' | 'changed' | 'removed';
    path: string;
    relativePath: string;
}

/**
 * File watching service
 */
export class FileWatcherService {
    private watcher: chokidar.FSWatcher | null = null;
    private readonly ctx: WorkspaceContext;
    private readonly verbose: boolean;
    private watchedSourcePaths: Set<string> = new Set();
    private edgeListFiles: string[] = [];

    private onSourceChange?: (files: string[]) => Promise<void>;
    private onEdgeListChange?: () => Promise<void>;

    // Debounce state
    private sourceTimeout: NodeJS.Timeout | null = null;
    private edgeListTimeout: NodeJS.Timeout | null = null;
    private changedSourceFiles: Set<string> = new Set();

    constructor(ctx: WorkspaceContext, verbose = false) {
        this.ctx = ctx;
        this.verbose = verbose;
    }

    /**
     * Setup file watching for source files and edge lists
     * Note: .arch directory watching is handled by ArchWatcherService
     */
    async setup(handlers: {
        onSourceChange?: (files: string[]) => Promise<void>;
        onEdgeListChange?: () => Promise<void>;
    }): Promise<void> {
        this.onSourceChange = handlers.onSourceChange;
        this.onEdgeListChange = handlers.onEdgeListChange;

        const artifactDir = this.ctx.artifactRoot;

        // Load watched files from WatchService
        const watchService = new WatchService(artifactDir, this.ctx.workspaceRoot, this.ctx.io);
        await watchService.load();
        const watchedFiles = watchService.getWatchedFiles();

        // Setup paths to watch
        this.edgeListFiles = [
            path.join(artifactDir, 'import-edgelist.json'),
            path.join(artifactDir, 'call-edgelist.json'),
        ];

        const watchedSourcePaths = watchedFiles.map(f =>
            path.join(this.ctx.workspaceRoot, f)
        );
        this.watchedSourcePaths = new Set(watchedSourcePaths);

        // Combine source files and edge lists (no .arch - handled separately)
        const watchPaths = [
            ...this.edgeListFiles,
            ...watchedSourcePaths,
        ];

        // L24: Filter valid paths through the realpath-strong I/O surface.
        // Each path is workspace-rooted by construction; we convert to
        // workspace-relative form, ask `io.exists`, and skip on
        // PathEscapeError (defensive — should not happen since the paths
        // were built from inside-workspace sources).
        const existingPaths: string[] = [];
        for (const p of watchPaths) {
            const rel = path.relative(this.ctx.io.getRealRoot(), p);
            try {
                if (await this.ctx.io.exists(rel)) existingPaths.push(p);
            } catch (err) {
                log.warn('Watch path escapes workspace; skipping', {
                    path: p,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        if (existingPaths.length === 0) {
            if (this.verbose) {
                log.debug('No paths to watch');
            }
            return;
        }

        // Setup chokidar watcher
        this.watcher = chokidar.watch(existingPaths, {
            ignored: /(^|[\/\\])\../, // Ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        // Setup event handlers
        this.watcher.on('add', (filePath) => this.handleFileEvent('added', filePath));
        this.watcher.on('change', (filePath) => this.handleFileEvent('changed', filePath));
        this.watcher.on('unlink', (filePath) => this.handleFileEvent('removed', filePath));

        if (this.verbose) {
            log.info('Watching files', {
                sourceFiles: watchedFiles.length,
                edgeLists: this.edgeListFiles.length,
            });
        }
    }

    /**
     * Handle file change event
     */
    private handleFileEvent(action: 'added' | 'changed' | 'removed', filePath: string): void {
        // Determine file type and route to appropriate handler
        if (this.edgeListFiles.includes(filePath)) {
            this.handleEdgeListEvent(action, filePath);
        } else if (this.watchedSourcePaths.has(filePath)) {
            this.handleSourceEvent(action, filePath);
        }
        // Note: .arch files are handled by ArchWatcherService
    }

    /**
     * Handle source file change
     */
    private handleSourceEvent(action: string, filePath: string): void {
        const relativePath = path.relative(this.ctx.workspaceRoot, filePath).replace(/\\/g, '/');

        if (this.verbose) {
            log.debug('Source change', { action, relativePath });
        }

        // Track changed file
        this.changedSourceFiles.add(relativePath);

        // Debounce
        if (this.sourceTimeout) {
            clearTimeout(this.sourceTimeout);
        }

        this.sourceTimeout = setTimeout(async () => {
            try {
                const files = Array.from(this.changedSourceFiles);
                this.changedSourceFiles.clear();

                if (this.onSourceChange) {
                    await this.onSourceChange(files);
                }
            } catch (e) {
                log.error('Error in source change handler', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 1000);
    }

    /**
     * Handle edge list change
     */
    private handleEdgeListEvent(action: string, filePath: string): void {
        if (this.verbose) {
            log.debug('Edge list change', { action, filename: path.basename(filePath) });
        }

        // Debounce
        if (this.edgeListTimeout) {
            clearTimeout(this.edgeListTimeout);
        }

        this.edgeListTimeout = setTimeout(async () => {
            try {
                if (this.onEdgeListChange) {
                    await this.onEdgeListChange();
                }
            } catch (e) {
                log.error('Error in edge list change handler', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 500);
    }

    /**
     * Close file watcher
     */
    async close(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
        }

        // Clear timers
        if (this.sourceTimeout) clearTimeout(this.sourceTimeout);
        if (this.edgeListTimeout) clearTimeout(this.edgeListTimeout);
    }

    /**
     * Get watched file count
     */
    getWatchedFileCount(): number {
        return this.watchedSourcePaths.size;
    }
}
