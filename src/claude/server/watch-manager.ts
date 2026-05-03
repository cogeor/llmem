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

import * as path from 'path';
import { WatchService } from '../../graph/worktree-state';
import { createLogger } from '../../common/logger';
import type { WorkspaceIO } from '../../workspace/workspace-io';

const log = createLogger('watch-manager');

export interface WatchManagerConfig {
    workspaceRoot: string;
    /**
     * Workspace-relative artifact root (e.g. `.artifacts`). Joined with
     * `workspaceRoot` internally before being handed to `WatchService`.
     * Loop 24 surfaced this — previously the relative form was passed
     * straight through, which silently resolved against the host's cwd.
     */
    artifactRoot: string;
    /** Required (L24): realpath-strong I/O surface anchored on the workspace root. */
    io: WorkspaceIO;
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
            io: config.io,
            verbose: config.verbose || false,
        };

        // L24: WatchService expects an absolute artifact directory (so its
        // workspace-relative state-file path is computed correctly when
        // `io` is set). Compute it once here.
        const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);

        this.watchService = new WatchService(
            artifactDir,
            this.config.workspaceRoot,
            this.config.io,
        );
    }

    /**
     * Initialize - load existing watch state
     */
    async initialize(): Promise<void> {
        await this.watchService.load();

        if (this.config.verbose) {
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
        const artifactDir = path.join(this.config.workspaceRoot, this.config.artifactRoot);
        this.watchService = new WatchService(
            artifactDir,
            this.config.workspaceRoot,
            this.config.io,
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
