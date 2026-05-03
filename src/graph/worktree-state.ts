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
import { createLogger } from '../common/logger';
import { WorkspaceIO } from '../workspace/workspace-io';

const log = createLogger('watch-service');

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
    /**
     * L23: optional realpath-strong I/O surface. When set, all read /
     * write / list operations flow through it; the legacy direct-`fs.*`
     * branch is preserved for callers that haven't migrated.
     */
    private readonly io: WorkspaceIO | null;
    /** State file path relative to the workspace root (only meaningful when `io` is set). */
    private readonly stateRelPath: string;

    constructor(artifactRoot: string, workspaceRoot: string, io?: WorkspaceIO) {
        this.artifactRoot = artifactRoot;
        this.workspaceRoot = workspaceRoot;
        this.io = io ?? null;
        this.stateRelPath = this.io
            ? path.relative(this.io.getRealRoot(), path.join(artifactRoot, STATE_FILENAME))
            : '';
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
            // L23: prefer the realpath-strong path when an `io` was supplied.
            const fileExists = this.io
                ? await this.io.exists(this.stateRelPath)
                : fsSync.existsSync(filePath);
            if (fileExists) {
                const content = this.io
                    ? await this.io.readFile(this.stateRelPath, 'utf-8')
                    : await fs.readFile(filePath, 'utf-8');
                const rawState = JSON.parse(content);

                if (typeof rawState !== 'object' || rawState === null) {
                    log.warn('Invalid state file shape, starting fresh');
                    return;
                }

                // Check version and migrate if needed
                if (rawState.version?.startsWith('1.')) {
                    await this.migrateFromV1(rawState as WatchStateV1);
                } else {
                    const state = rawState as WatchStateV2;
                    this.watchedFiles = new Set(Array.isArray(state.watchedFiles) ? state.watchedFiles : []);
                    this.fileHashes = new Map(Object.entries(
                        (state.fileHashes && typeof state.fileHashes === 'object') ? state.fileHashes : {}
                    ));
                }

                log.debug('Loaded watched files', { count: this.watchedFiles.size });
            }
        } catch (e) {
            log.error('Failed to load state', {
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    /**
     * Migrate from v1 format (directories + files) to v2 (files only).
     */
    private async migrateFromV1(v1State: WatchStateV1): Promise<void> {
        log.info('Migrating from v1 to v2 format...');

        // Collect all files from v1 format
        for (const entry of v1State.watchedPaths || []) {
            if (entry.type === 'file') {
                this.watchedFiles.add(entry.path);
            } else {
                // Directory: expand to all files underneath
                const absolutePath = path.join(this.workspaceRoot, entry.path);
                const dirExists = this.io
                    ? await this.io.exists(entry.path)
                    : fsSync.existsSync(absolutePath);
                if (dirExists) {
                    const files = this.io
                        ? await listParsableFilesIO(this.io, entry.path)
                        : await listParsableFiles(absolutePath);
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
        log.info('Migrated to v2', { fileCount: this.watchedFiles.size });
    }

    /**
     * Save state to disk.
     */
    async save(): Promise<void> {
        const filePath = path.join(this.artifactRoot, STATE_FILENAME);

        try {
            const state: WatchStateV2 = {
                version: STATE_VERSION,
                timestamp: new Date().toISOString(),
                watchedFiles: Array.from(this.watchedFiles).sort(),
                fileHashes: Object.fromEntries(this.fileHashes)
            };
            const content = JSON.stringify(state, null, 2);

            if (this.io) {
                // mkdirRecursive is idempotent, so the legacy `existsSync`
                // pre-check is unnecessary on this path.
                await this.io.mkdirRecursive(path.dirname(this.stateRelPath));
                await this.io.writeFile(this.stateRelPath, content);
            } else {
                const dir = path.dirname(filePath);
                if (!fsSync.existsSync(dir)) {
                    await fs.mkdir(dir, { recursive: true });
                }
                await fs.writeFile(filePath, content, 'utf-8');
            }
            log.debug('Saved watched files', { count: this.watchedFiles.size });
        } catch (e) {
            log.error('Failed to save state', {
                error: e instanceof Error ? e.message : String(e),
            });
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
        if (this.io) {
            if (await this.io.exists(relativePath)) {
                const buf = await this.io.readFile(relativePath, null);
                const hash = crypto.createHash('sha256').update(buf).digest('hex');
                this.fileHashes.set(relativePath, hash);
            }
        } else if (fsSync.existsSync(absolutePath)) {
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
        const files = this.io
            ? await listParsableFilesIO(this.io, folderPath)
            : await listParsableFiles(absolutePath);
        const addedFiles: string[] = [];

        for (const absoluteFilePath of files) {
            const relativePath = path.relative(this.workspaceRoot, absoluteFilePath).replace(/\\/g, '/');
            if (!this.watchedFiles.has(relativePath)) {
                await this.addFile(relativePath);
                addedFiles.push(relativePath);
            }
        }

        log.debug('Added files from folder', { count: addedFiles.length, folderPath });
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

        log.debug('Removed files from folder', { count: removedFiles.length, folderPath });
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

            let currentHash: string;
            if (this.io) {
                if (!(await this.io.exists(filePath))) {
                    log.warn('File no longer exists', { filePath });
                    continue;
                }
                const buf = await this.io.readFile(filePath, null);
                currentHash = crypto.createHash('sha256').update(buf).digest('hex');
            } else {
                if (!fsSync.existsSync(absolutePath)) {
                    log.warn('File no longer exists', { filePath });
                    continue;
                }
                currentHash = await hashFile(absolutePath);
            }

            const savedHash = this.fileHashes.get(filePath);

            if (currentHash !== savedHash) {
                log.debug('Changed', { filePath });
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
 *
 * Legacy signature: takes an absolute path and walks via raw `fs.readdir`.
 * Preserved for callers that haven't migrated to `WorkspaceIO`.
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

/**
 * L23: realpath-strong variant of `listParsableFiles`. Walks the
 * workspace-relative `startRel` via `WorkspaceIO.readDir` + `lstat`,
 * returning absolute paths (anchored on `io.getRealRoot()`). Symlinks
 * are deliberately skipped via `lstat` to avoid double-counting and to
 * stop the walk at symlink boundaries; targets pointing outside the
 * workspace would be rejected by `readDir`'s realpath check anyway.
 */
export async function listParsableFilesIO(
    io: WorkspaceIO,
    startRel: string,
): Promise<string[]> {
    const files: string[] = [];
    const root = io.getRealRoot();

    async function walkDir(rel: string) {
        let entries: string[];
        try {
            entries = await io.readDir(rel);
        } catch {
            return;
        }
        for (const name of entries) {
            if (name.startsWith('.') || name === 'node_modules') continue;
            const childRel = rel === '' || rel === '.' ? name : path.join(rel, name);
            let st;
            try {
                st = await io.lstat(childRel);
            } catch {
                continue;
            }
            if (st.isSymbolicLink()) continue;
            if (st.isDirectory()) {
                await walkDir(childRel);
            } else if (st.isFile() && isParsableFile(name)) {
                files.push(path.join(root, childRel));
            }
        }
    }

    await walkDir(startRel);
    return files.sort();
}
