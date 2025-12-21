/**
 * Worktree State Persistence
 * 
 * Saves and loads watched path state with content hashes for
 * detecting changes and enabling incremental edge regeneration.
 * 
 * Optimization: Folder hashes are computed from child file hashes,
 * not by reading all file contents. This makes change detection O(1)
 * for unchanged files.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface WatchedPathEntry {
    path: string;                    // Relative path (e.g., "src/extension")
    type: 'file' | 'directory';
    hash: string;                    // SHA-256 hash
}

export interface WorktreeState {
    version: string;
    timestamp: string;
    watchedPaths: WatchedPathEntry[];
    fileHashes: Record<string, string>;  // path -> hash for all known files
}

// ============================================================================
// Constants
// ============================================================================

const STATE_VERSION = '1.1.0';
const STATE_FILENAME = 'worktree-state.json';
const PARSABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];

// ============================================================================
// State Persistence
// ============================================================================

/**
 * Load worktree state from disk.
 */
export async function loadState(artifactRoot: string): Promise<WorktreeState | null> {
    const filePath = path.join(artifactRoot, STATE_FILENAME);

    try {
        if (fsSync.existsSync(filePath)) {
            const content = await fs.readFile(filePath, 'utf-8');
            const state = JSON.parse(content) as WorktreeState;
            // Ensure fileHashes exists (backwards compat)
            if (!state.fileHashes) {
                state.fileHashes = {};
            }
            console.error(`[WorktreeState] Loaded ${state.watchedPaths.length} watched paths, ${Object.keys(state.fileHashes).length} file hashes`);
            return state;
        }
    } catch (e) {
        console.error('[WorktreeState] Failed to load state:', e);
    }

    return null;
}

/**
 * Save worktree state to disk.
 */
export async function saveState(state: WorktreeState, artifactRoot: string): Promise<void> {
    const filePath = path.join(artifactRoot, STATE_FILENAME);

    try {
        const dir = path.dirname(filePath);
        if (!fsSync.existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }

        state.timestamp = new Date().toISOString();
        state.version = STATE_VERSION;

        const content = JSON.stringify(state, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');
        console.error(`[WorktreeState] Saved ${state.watchedPaths.length} watched paths, ${Object.keys(state.fileHashes).length} file hashes`);
    } catch (e) {
        console.error('[WorktreeState] Failed to save state:', e);
        throw e;
    }
}

/**
 * Create an empty state.
 */
export function createEmptyState(): WorktreeState {
    return {
        version: STATE_VERSION,
        timestamp: new Date().toISOString(),
        watchedPaths: [],
        fileHashes: {}
    };
}

// ============================================================================
// Hashing (Optimized)
// ============================================================================

/**
 * Compute SHA-256 hash for a single file.
 */
async function hashFile(absolutePath: string): Promise<string> {
    const content = await fs.readFile(absolutePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a file should be hashed (based on extension).
 */
function isParsableFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return PARSABLE_EXTS.includes(ext);
}

/**
 * List all parsable files in a directory (recursive).
 */
async function listParsableFiles(absolutePath: string): Promise<string[]> {
    const files: string[] = [];

    async function walkDir(dir: string) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            // Skip hidden and node_modules
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                await walkDir(fullPath);
            } else if (entry.isFile() && isParsableFile(entry.name)) {
                files.push(fullPath);
            }
        }
    }

    await walkDir(absolutePath);
    return files.sort();
}

/**
 * Compute folder hash from stored file hashes (no file I/O).
 * Falls back to computing individual file hashes if not in cache.
 */
export async function computeFolderHash(
    absoluteFolderPath: string,
    workspaceRoot: string,
    state: WorktreeState
): Promise<{ hash: string; updatedFileHashes: Record<string, string> }> {
    const updatedFileHashes: Record<string, string> = {};
    const files = await listParsableFiles(absoluteFolderPath);
    const hashes: string[] = [];

    for (const absoluteFilePath of files) {
        const relativePath = path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, '/');

        // Use cached hash if available, otherwise compute
        let hash = state.fileHashes[relativePath];
        if (!hash) {
            hash = await hashFile(absoluteFilePath);
            updatedFileHashes[relativePath] = hash;
        }
        hashes.push(hash);
    }

    // Combine all file hashes into a single folder hash
    const combined = hashes.join('');
    const folderHash = crypto.createHash('sha256').update(combined).digest('hex');

    return { hash: folderHash, updatedFileHashes };
}

/**
 * Compute hash for a file or directory.
 * For directories, uses cached file hashes when available.
 */
export async function computeHash(
    absolutePath: string,
    type: 'file' | 'directory',
    workspaceRoot?: string,
    state?: WorktreeState
): Promise<string> {
    try {
        if (type === 'file') {
            return await hashFile(absolutePath);
        } else {
            // For directories, if we have state, use optimized version
            if (workspaceRoot && state) {
                const { hash } = await computeFolderHash(absolutePath, workspaceRoot, state);
                return hash;
            }
            // Fallback: compute from scratch (slower)
            return await computeFolderHashFresh(absolutePath);
        }
    } catch (e) {
        console.error(`[WorktreeState] Failed to hash ${absolutePath}:`, e);
        return '';
    }
}

/**
 * Compute folder hash from scratch (reads all files).
 * Used when no state is available.
 */
async function computeFolderHashFresh(absolutePath: string): Promise<string> {
    const files = await listParsableFiles(absolutePath);
    const hashes: string[] = [];

    for (const file of files) {
        const hash = await hashFile(file);
        hashes.push(hash);
    }

    const combined = hashes.join('');
    return crypto.createHash('sha256').update(combined).digest('hex');
}

/**
 * Update file hashes in state for all files in a folder.
 * Call this after toggling a folder ON to cache all file hashes.
 */
export async function cacheFileHashes(
    absoluteFolderPath: string,
    workspaceRoot: string,
    state: WorktreeState
): Promise<void> {
    const files = await listParsableFiles(absoluteFolderPath);

    for (const absoluteFilePath of files) {
        const relativePath = path.relative(workspaceRoot, absoluteFilePath).replace(/\\/g, '/');

        // Only compute if not already cached
        if (!state.fileHashes[relativePath]) {
            state.fileHashes[relativePath] = await hashFile(absoluteFilePath);
        }
    }

    console.error(`[WorktreeState] Cached ${files.length} file hashes for ${path.basename(absoluteFolderPath)}`);
}

// ============================================================================
// Change Detection (Optimized)
// ============================================================================

/**
 * Detect which watched paths have changed since the state was saved.
 * Uses cached file hashes to avoid reading unchanged files.
 */
export async function detectChangedPaths(
    savedState: WorktreeState,
    workspaceRoot: string
): Promise<WatchedPathEntry[]> {
    const changed: WatchedPathEntry[] = [];

    for (const entry of savedState.watchedPaths) {
        const absolutePath = path.join(workspaceRoot, entry.path);

        // Check if path still exists
        if (!fsSync.existsSync(absolutePath)) {
            console.error(`[WorktreeState] Path no longer exists: ${entry.path}`);
            continue;
        }

        if (entry.type === 'file') {
            // For files, compute hash directly
            const currentHash = await hashFile(absolutePath);
            if (currentHash !== entry.hash) {
                console.error(`[WorktreeState] Changed file: ${entry.path}`);
                changed.push({ ...entry, hash: currentHash });
                // Update cache
                savedState.fileHashes[entry.path] = currentHash;
            } else {
                console.error(`[WorktreeState] Unchanged file: ${entry.path}`);
            }
        } else {
            // For directories, use optimized hash computation
            const { hash: currentHash, updatedFileHashes } = await computeFolderHash(
                absolutePath,
                workspaceRoot,
                savedState
            );

            // Merge new file hashes into state
            Object.assign(savedState.fileHashes, updatedFileHashes);

            if (currentHash !== entry.hash) {
                console.error(`[WorktreeState] Changed folder: ${entry.path} (${Object.keys(updatedFileHashes).length} new files hashed)`);
                changed.push({ ...entry, hash: currentHash });
            } else {
                console.error(`[WorktreeState] Unchanged folder: ${entry.path}`);
            }
        }
    }

    return changed;
}

/**
 * Add or update a watched path entry.
 */
export function addWatchedPath(
    state: WorktreeState,
    entry: WatchedPathEntry
): void {
    const idx = state.watchedPaths.findIndex(p => p.path === entry.path);
    if (idx >= 0) {
        state.watchedPaths[idx] = entry;
    } else {
        state.watchedPaths.push(entry);
    }
}

/**
 * Remove a watched path entry and its cached file hashes.
 */
export function removeWatchedPath(
    state: WorktreeState,
    pathToRemove: string
): void {
    state.watchedPaths = state.watchedPaths.filter(p => p.path !== pathToRemove);

    // Also remove cached file hashes for files under this path
    const prefix = pathToRemove + '/';
    for (const key of Object.keys(state.fileHashes)) {
        if (key === pathToRemove || key.startsWith(prefix)) {
            delete state.fileHashes[key];
        }
    }
}
