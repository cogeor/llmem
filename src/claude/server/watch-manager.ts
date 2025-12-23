/**
 * Watch State Manager
 *
 * Manages watched files/folders with HTTP API support.
 * Provides a more elegant interface than direct WatchService manipulation.
 */

import * as path from 'path';
import * as fs from 'fs';
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

    /**
     * Add file or folder to watched state
     */
    async addToWatch(relativePath: string): Promise<{
        success: boolean;
        addedFiles: string[];
        message: string;
    }> {
        const absolutePath = path.join(this.config.workspaceRoot, relativePath);

        // Check if path exists
        if (!fs.existsSync(absolutePath)) {
            return {
                success: false,
                addedFiles: [],
                message: `Path does not exist: ${relativePath}`,
            };
        }

        const isDir = fs.statSync(absolutePath).isDirectory();
        let addedFiles: string[];

        if (isDir) {
            addedFiles = await this.watchService.addFolder(relativePath);
        } else {
            await this.watchService.addFile(relativePath);
            addedFiles = [relativePath];
        }

        await this.watchService.save();

        if (this.config.verbose) {
            console.log(`[WatchManager] Added ${addedFiles.length} file(s) to watch: ${relativePath}`);
        }

        return {
            success: true,
            addedFiles,
            message: `Added ${addedFiles.length} file(s) to watch`,
        };
    }

    /**
     * Remove file or folder from watched state
     */
    async removeFromWatch(relativePath: string): Promise<{
        success: boolean;
        removedFiles: string[];
        message: string;
    }> {
        const absolutePath = path.join(this.config.workspaceRoot, relativePath);
        const isDir = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory();

        let removedFiles: string[];

        if (isDir) {
            removedFiles = this.watchService.removeFolder(relativePath);
        } else {
            this.watchService.removeFile(relativePath);
            removedFiles = [relativePath];
        }

        await this.watchService.save();

        if (this.config.verbose) {
            console.log(`[WatchManager] Removed ${removedFiles.length} file(s) from watch: ${relativePath}`);
        }

        return {
            success: true,
            removedFiles,
            message: `Removed ${removedFiles.length} file(s) from watch`,
        };
    }

    /**
     * Check if path is watched
     */
    isWatched(relativePath: string): boolean {
        const watchedFiles = this.watchService.getWatchedFiles();
        return watchedFiles.includes(relativePath);
    }

    /**
     * Get watched files
     */
    getWatchedFiles(): string[] {
        return this.watchService.getWatchedFiles();
    }

    /**
     * Clear all watched files
     */
    async clearAll(): Promise<void> {
        const watchedFiles = this.watchService.getWatchedFiles();

        for (const file of watchedFiles) {
            this.watchService.removeFile(file);
        }

        await this.watchService.save();

        if (this.config.verbose) {
            console.log(`[WatchManager] Cleared all ${watchedFiles.length} watched files`);
        }
    }
}
