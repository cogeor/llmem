/**
 * Watch State Manager
 *
 * Server-side state-query helper for watched files. Loop 09 retired the
 * `addToWatch`/`removeFromWatch` mutation surface — those flows now live
 * in `application/toggle-watch.ts` and the server's `/api/watch` handler
 * calls them directly. This class survives because `/api/watched` (GET)
 * needs a thin in-memory cache of the watched-file set.
 *
 * The application function persists state to disk via WatchService; this
 * class keeps an internal WatchService for read-side queries and
 * exposes `refresh()` so the `/api/watch` handler can reload after the
 * application function mutates disk state.
 */

import { WatchService } from '../../graph/worktree-state';

export interface WatchManagerConfig {
    workspaceRoot: string;
    artifactRoot: string;
    verbose?: boolean;
}

export interface WatchStateInfo {
    watchedFiles: string[];
    totalFiles: number;
    lastUpdated: string;
}

/**
 * Watch state manager with HTTP API
 */
export class WatchManager {
    private config: Required<WatchManagerConfig>;
    private watchService: WatchService;

    constructor(config: WatchManagerConfig) {
        this.config = {
            workspaceRoot: config.workspaceRoot,
            artifactRoot: config.artifactRoot,
            verbose: config.verbose || false,
        };

        this.watchService = new WatchService(
            this.config.artifactRoot,
            this.config.workspaceRoot
        );
    }

    /**
     * Initialize - load existing watch state
     */
    async initialize(): Promise<void> {
        await this.watchService.load();

        if (this.config.verbose) {
            const files = this.watchService.getWatchedFiles();
            console.log(`[WatchManager] Loaded ${files.length} watched files`);
        }
    }

    /**
     * Reload watch state from disk. Called after `application/toggle-watch`
     * mutates the on-disk state so subsequent `getWatchState` calls reflect
     * the new set without staleness.
     */
    async refresh(): Promise<void> {
        this.watchService = new WatchService(
            this.config.artifactRoot,
            this.config.workspaceRoot,
        );
        await this.watchService.load();
    }

    /**
     * Get current watch state
     */
    getWatchState(): WatchStateInfo {
        const watchedFiles = this.watchService.getWatchedFiles();

        return {
            watchedFiles,
            totalFiles: watchedFiles.length,
            lastUpdated: new Date().toISOString(),
        };
    }
}
