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
 *
 * Loop 04: takes a `WorkspaceContext` instead of the
 * `(workspaceRoot, artifactRoot, io, verbose)` bag.
 */

import { WatchService } from '../../graph/worktree-state';
import { createLogger } from '../../common/logger';
import type { WorkspaceContext } from '../../application/workspace-context';

const log = createLogger('watch-manager');

export interface WatchStateInfo {
    watchedFiles: string[];
    totalFiles: number;
    lastUpdated: string;
}

/**
 * Watch state manager with HTTP API
 */
export class WatchManager {
    private readonly ctx: WorkspaceContext;
    private readonly verbose: boolean;
    private watchService: WatchService;

    constructor(ctx: WorkspaceContext, verbose = false) {
        this.ctx = ctx;
        this.verbose = verbose;

        // L24: WatchService expects an absolute artifact directory (so its
        // workspace-relative state-file path is computed correctly when
        // `io` is set). The context's artifactRoot is already absolute.
        this.watchService = new WatchService(
            this.ctx.artifactRoot,
            this.ctx.workspaceRoot,
            this.ctx.io,
        );
    }

    /**
     * Initialize - load existing watch state
     */
    async initialize(): Promise<void> {
        await this.watchService.load();

        if (this.verbose) {
            const files = this.watchService.getWatchedFiles();
            log.info('Loaded watched files', { count: files.length });
        }
    }

    /**
     * Reload watch state from disk. Called after `application/toggle-watch`
     * mutates the on-disk state so subsequent `getWatchState` calls reflect
     * the new set without staleness.
     */
    async refresh(): Promise<void> {
        this.watchService = new WatchService(
            this.ctx.artifactRoot,
            this.ctx.workspaceRoot,
            this.ctx.io,
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
