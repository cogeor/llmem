/**
 * Watch Service - File-Only Tracking
 * 
 * Centralized service for managing watched file state.
 * Only tracks individual files, folder status is derived.
 * 
 * V2.0 format:
 * - watchedFiles: string[] (relative file paths)
 * - fileHashes: Record<string, string> (path -> hash for change detection)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

/** V2 state format - file-only */
export interface WatchStateV2 {
    version: string;
    timestamp: string;
    watchedFiles: string[];                    // Only file paths, no directories
    fileHashes: Record<string, string>;        // path -> SHA-256 hash
}

/** Legacy V1 format for migration */
interface WatchStateV1 {
    version: string;
    watchedPaths: { path: string; type: 'file' | 'directory'; hash: string }[];
    fileHashes: Record<string, string>;
}

// ============================================================================
// Constants
// ============================================================================

const STATE_VERSION = '2.0.0';
const STATE_FILENAME = 'worktree-state.json';
const PARSABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];

// ============================================================================
// WatchService Class
// ============================================================================

/**
 * Centralized service for managing watched files.
 * 
 * Key design: Only tracks individual files, never directories.
 * Folder status is derived from whether files under it are watched.
 */
export class WatchService {
    private watchedFiles = new Set<string>();
    private fileHashes = new Map<string, string>();
    private artifactRoot: string;
    private workspaceRoot: string;

    constructor(artifactRoot: string, workspaceRoot: string) {
        this.artifactRoot = artifactRoot;
        this.workspaceRoot = workspaceRoot;
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    /**
     * Load state from disk, migrating from v1 if needed.
     */
    async load(): Promise<void> {
        const filePath = path.join(this.artifactRoot, STATE_FILENAME);

        try {
            if (fsSync.existsSync(filePath)) {
                const content = await fs.readFile(filePath, 'utf-8');
                const rawState = JSON.parse(content);

                // Check version and migrate if needed
                if (rawState.version?.startsWith('1.')) {
                    await this.migrateFromV1(rawState as WatchStateV1);
                } else {
                    const state = rawState as WatchStateV2;
                    this.watchedFiles = new Set(state.watchedFiles || []);
                    this.fileHashes = new Map(Object.entries(state.fileHashes || {}));
                }

                console.error(`[WatchService] Loaded ${this.watchedFiles.size} watched files`);
            }
        } catch (e) {
            console.error('[WatchService] Failed to load state:', e);
        }
    }

    /**
     * Migrate from v1 format (directories + files) to v2 (files only).
     */
    private async migrateFromV1(v1State: WatchStateV1): Promise<void> {
        console.error('[WatchService] Migrating from v1 to v2 format...');

        // Collect all files from v1 format
        for (const entry of v1State.watchedPaths || []) {
            if (entry.type === 'file') {
                this.watchedFiles.add(entry.path);
            } else {
                // Directory: expand to all files underneath
                const absolutePath = path.join(this.workspaceRoot, entry.path);
                if (fsSync.existsSync(absolutePath)) {
                    const files = await listParsableFiles(absolutePath);
                    for (const f of files) {
                        const relativePath = path.relative(this.workspaceRoot, f).replace(/\\/g, '/');
                        this.watchedFiles.add(relativePath);
                    }
                }
            }
        }

        // Keep existing file hashes for watched files only
        for (const [path, hash] of Object.entries(v1State.fileHashes || {})) {
            if (this.watchedFiles.has(path)) {
                this.fileHashes.set(path, hash);
            }
        }

        // Save in new format
        await this.save();
        console.error(`[WatchService] Migrated to v2: ${this.watchedFiles.size} files`);
    }

    /**
     * Save state to disk.
     */
    async save(): Promise<void> {
        const filePath = path.join(this.artifactRoot, STATE_FILENAME);

        try {
            const dir = path.dirname(filePath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }

            const state: WatchStateV2 = {
                version: STATE_VERSION,
                timestamp: new Date().toISOString(),
                watchedFiles: Array.from(this.watchedFiles).sort(),
                fileHashes: Object.fromEntries(this.fileHashes)
            };

            await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
            console.error(`[WatchService] Saved ${this.watchedFiles.size} watched files`);
        } catch (e) {
            console.error('[WatchService] Failed to save state:', e);
            throw e;
        }
    }

    // ========================================================================
    // File Operations
    // ========================================================================

    /**
     * Check if a specific file is watched.
     */
    isFileWatched(filePath: string): boolean {
        return this.watchedFiles.has(filePath);
    }

    /**
     * Get all watched file paths.
     */
    getWatchedFiles(): string[] {
        return Array.from(this.watchedFiles);
    }

    /**
     * Add a single file to watching.
     */
    async addFile(relativePath: string): Promise<void> {
        this.watchedFiles.add(relativePath);

        // Compute and store hash
        const absolutePath = path.join(this.workspaceRoot, relativePath);
        if (fsSync.existsSync(absolutePath)) {
            const hash = await hashFile(absolutePath);
            this.fileHashes.set(relativePath, hash);
        }
    }

    /**
     * Remove a single file from watching.
     */
    removeFile(relativePath: string): void {
        this.watchedFiles.delete(relativePath);
        this.fileHashes.delete(relativePath);
    }

    // ========================================================================
    // Folder Operations (convenience - expand to files)
    // ========================================================================

    /**
     * Add all files under a folder to watching.
     * Returns the list of files that were added.
     */
    async addFolder(folderPath: string): Promise<string[]> {
        const absolutePath = path.join(this.workspaceRoot, folderPath);
        const files = await listParsableFiles(absolutePath);
        const addedFiles: string[] = [];

        for (const absoluteFilePath of files) {
            const relativePath = path.relative(this.workspaceRoot, absoluteFilePath).replace(/\\/g, '/');
            if (!this.watchedFiles.has(relativePath)) {
                await this.addFile(relativePath);
                addedFiles.push(relativePath);
            }
        }

        console.error(`[WatchService] Added ${addedFiles.length} files from folder: ${folderPath}`);
        return addedFiles;
    }

    /**
     * Remove all files under a folder from watching.
     * Returns the list of files that were removed.
     */
    removeFolder(folderPath: string): string[] {
        const prefix = folderPath + '/';
        const removedFiles: string[] = [];

        for (const filePath of this.watchedFiles) {
            if (filePath === folderPath || filePath.startsWith(prefix)) {
                this.watchedFiles.delete(filePath);
                this.fileHashes.delete(filePath);
                removedFiles.push(filePath);
            }
        }

        console.error(`[WatchService] Removed ${removedFiles.length} files from folder: ${folderPath}`);
        return removedFiles;
    }

    // ========================================================================
    // Status Checks
    // ========================================================================

    /**
     * Check if a path has any watched descendants.
     * For files: checks exact match
     * For folders: checks if any file under it is watched
     */
    hasWatchedDescendant(pathToCheck: string): boolean {
        // Exact match
        if (this.watchedFiles.has(pathToCheck)) {
            return true;
        }

        // Check if any watched file starts with this path
        const prefix = pathToCheck + '/';
        for (const filePath of this.watchedFiles) {
            if (filePath.startsWith(prefix)) {
                return true;
            }
        }

        return false;
    }

    // ========================================================================
    // Change Detection
    // ========================================================================

    /**
     * Detect which watched files have changed since last save.
     * Returns list of changed file paths.
     */
    async getChangedFiles(): Promise<string[]> {
        const changed: string[] = [];

        for (const filePath of this.watchedFiles) {
            const absolutePath = path.join(this.workspaceRoot, filePath);

            if (!fsSync.existsSync(absolutePath)) {
                console.error(`[WatchService] File no longer exists: ${filePath}`);
                continue;
            }

            const currentHash = await hashFile(absolutePath);
            const savedHash = this.fileHashes.get(filePath);

            if (currentHash !== savedHash) {
                console.error(`[WatchService] Changed: ${filePath}`);
                changed.push(filePath);
                // Update hash
                this.fileHashes.set(filePath, currentHash);
            }
        }

        return changed;
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute SHA-256 hash for a single file.
 */
async function hashFile(absolutePath: string): Promise<string> {
    const content = await fs.readFile(absolutePath);
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Check if a file is parsable based on extension.
 */
export function isParsableFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return PARSABLE_EXTS.includes(ext);
}

/**
 * List all parsable files in a directory (recursive).
 */
export async function listParsableFiles(absolutePath: string): Promise<string[]> {
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
