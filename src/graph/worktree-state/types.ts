/**
 * Watch Service — persisted-state types and schema constants.
 *
 * Lifted out of `graph/worktree-state.ts` (B7 split) to keep the
 * `WatchService` class under the graph line budget. The class re-exports
 * the public symbols from here so importers are unchanged.
 *
 * V2.0 format:
 * - watchedFiles: string[] (relative file paths)
 * - fileHashes: Record<string, string> (path -> hash for change detection)
 */

/** V2 state format - file-only */
export interface WatchStateV2 {
    version: string;
    timestamp: string;
    watchedFiles: string[];                    // Only file paths, no directories
    fileHashes: Record<string, string>;        // path -> SHA-256 hash
}

/** Legacy V1 format for migration */
export interface WatchStateV1 {
    version: string;
    watchedPaths: { path: string; type: 'file' | 'directory'; hash: string }[];
    fileHashes: Record<string, string>;
}

export const STATE_VERSION = '2.0.0';
export const STATE_FILENAME = 'worktree-state.json';
