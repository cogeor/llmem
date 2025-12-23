/**
 * File Watcher for Live Reload
 *
 * Watches source files, edge lists, and design docs for changes.
 * Regenerates edges and notifies when files are modified.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import { WatchService } from '../../graph/worktree-state';

export interface FileWatcherConfig {
    workspaceRoot: string;
    artifactRoot: string;
    verbose?: boolean;
}

export interface FileChangeEvent {
    type: 'source' | 'edgelist' | 'arch';
    action: 'added' | 'changed' | 'removed';
    path: string;
    relativePath: string;
}

/**
 * File watching service
 */
export class FileWatcherService {
    private watcher: chokidar.FSWatcher | null = null;
    private config: Required<FileWatcherConfig>;
    private watchedSourcePaths: Set<string> = new Set();
    private edgeListFiles: string[] = [];
    private archDir: string;

    private onSourceChange?: (files: string[]) => Promise<void>;
    private onEdgeListChange?: () => Promise<void>;
    private onArchChange?: () => Promise<void>;

    // Debounce state
    private sourceTimeout: NodeJS.Timeout | null = null;
    private edgeListTimeout: NodeJS.Timeout | null = null;
    private archTimeout: NodeJS.Timeout | null = null;
    private changedSourceFiles: Set<string> = new Set();

    constructor(config: FileWatcherConfig) {
        this.config = {
            workspaceRoot: config.workspaceRoot,
            artifactRoot: config.artifactRoot,
            verbose: config.verbose || false,
        };

        this.archDir = path.join(this.config.workspaceRoot, '.arch');
    }

    /**
     * Setup file watching
     */
    async setup(handlers: {
        onSourceChange?: (files: string[]) => Promise<void>;
        onEdgeListChange?: () => Promise<void>;
        onArchChange?: () => Promise<void>;
    }): Promise<void> {
        this.onSourceChange = handlers.onSourceChange;
        this.onEdgeListChange = handlers.onEdgeListChange;
        this.onArchChange = handlers.onArchChange;

        const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);

        // Load watched files from WatchService
        const watchService = new WatchService(artifactDir, this.config.workspaceRoot);
        await watchService.load();
        const watchedFiles = watchService.getWatchedFiles();

        // Setup paths to watch
        this.edgeListFiles = [
            path.join(artifactDir, 'import-edgelist.json'),
            path.join(artifactDir, 'call-edgelist.json'),
        ];

        const watchedSourcePaths = watchedFiles.map(f =>
            path.join(this.config.workspaceRoot, f)
        );
        this.watchedSourcePaths = new Set(watchedSourcePaths);

        // Combine all paths
        const allPaths = [...this.edgeListFiles, ...watchedSourcePaths];
        if (fs.existsSync(this.archDir)) {
            allPaths.push(this.archDir);
        }

        // Filter to only existing paths
        const existingPaths = allPaths.filter(p => fs.existsSync(p));

        if (existingPaths.length === 0) {
            if (this.config.verbose) {
                console.log('[FileWatcher] No paths to watch');
            }
            return;
        }

        // Setup chokidar watcher
        this.watcher = chokidar.watch(existingPaths, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles except .arch
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

        if (this.config.verbose) {
            console.log(`[FileWatcher] Watching ${watchedFiles.length} source files, ${this.edgeListFiles.length} edge lists, and .arch directory`);
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
        } else if (filePath.startsWith(this.archDir)) {
            this.handleArchEvent(action, filePath);
        }
    }

    /**
     * Handle source file change
     */
    private handleSourceEvent(action: string, filePath: string): void {
        const relativePath = path.relative(this.config.workspaceRoot, filePath).replace(/\\/g, '/');

        if (this.config.verbose) {
            console.log(`[FileWatcher] Source ${action}: ${relativePath}`);
        }

        // Track changed file
        this.changedSourceFiles.add(relativePath);

        // Debounce
        if (this.sourceTimeout) {
            clearTimeout(this.sourceTimeout);
        }

        this.sourceTimeout = setTimeout(async () => {
            const files = Array.from(this.changedSourceFiles);
            this.changedSourceFiles.clear();

            if (this.onSourceChange) {
                await this.onSourceChange(files);
            }
        }, 1000);
    }

    /**
     * Handle edge list change
     */
    private handleEdgeListEvent(action: string, filePath: string): void {
        if (this.config.verbose) {
            console.log(`[FileWatcher] Edge list ${action}: ${path.basename(filePath)}`);
        }

        // Debounce
        if (this.edgeListTimeout) {
            clearTimeout(this.edgeListTimeout);
        }

        this.edgeListTimeout = setTimeout(async () => {
            if (this.onEdgeListChange) {
                await this.onEdgeListChange();
            }
        }, 500);
    }

    /**
     * Handle .arch directory change
     */
    private handleArchEvent(action: string, filePath: string): void {
        if (this.config.verbose) {
            console.log(`[FileWatcher] .arch ${action}: ${path.relative(this.archDir, filePath)}`);
        }

        // Debounce
        if (this.archTimeout) {
            clearTimeout(this.archTimeout);
        }

        this.archTimeout = setTimeout(async () => {
            if (this.onArchChange) {
                await this.onArchChange();
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
        if (this.archTimeout) clearTimeout(this.archTimeout);
    }

    /**
     * Get watched file count
     */
    getWatchedFileCount(): number {
        return this.watchedSourcePaths.size;
    }
}
