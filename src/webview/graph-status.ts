/**
 * Graph Status Computation
 *
 * Determines the status of import/call graphs for each folder.
 * Status is based on comparing edge list timestamps with file modification times.
 *
 * Loop 26: every read-side `fs.*` site is replaced with `WorkspaceIO`
 * calls (existsSync × 2, readdirSync × 3, statSync × 3 — 7 sites).
 * The internal helpers are converted to operate on workspace-relative
 * paths so `io.readDir` / `io.stat` / `io.exists` apply uniformly.
 */

import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { IGNORED_FOLDERS, ALL_SUPPORTED_EXTENSIONS } from '../parser/config';
import { GraphStatus } from './worktree';
import { WorkspaceIO } from '../workspace/workspace-io';

export interface FolderGraphStatus {
    folderPath: string;          // Relative folder path
    importStatus: GraphStatus;   // Import graph status
    callStatus: GraphStatus;     // Call graph status
    hasImportEdges: boolean;     // Whether folder has any import edges
    hasCallEdges: boolean;       // Whether folder has any call edges
    fileCount: number;           // Number of supported source files
    lastModified: number;        // Most recent file modification timestamp
}

/** Convert an absolute path under the workspace to its workspace-relative POSIX form. */
function toWorkspaceRel(workspaceRoot: string, abs: string): string {
    return path.relative(workspaceRoot, abs).replace(/\\/g, '/');
}

/**
 * Compute graph status for all folders in a worktree.
 *
 * @param projectRoot Workspace root (absolute path)
 * @param artifactRoot Artifact directory (absolute path)
 * @param io Realpath-strong I/O surface anchored on the workspace root
 * @returns Map of folder path to status
 */
export async function computeAllFolderStatuses(
    projectRoot: string,
    artifactRoot: string,
    io: WorkspaceIO
): Promise<Map<string, FolderGraphStatus>> {
    const results = new Map<string, FolderGraphStatus>();

    // Load edge lists
    const importStore = new ImportEdgeListStore(artifactRoot, io);
    const callStore = new CallEdgeListStore(artifactRoot, io);

    const importPath = path.join(artifactRoot, 'import-edgelist.json');
    const callPath = path.join(artifactRoot, 'call-edgelist.json');
    const importRel = toWorkspaceRel(projectRoot, importPath);
    const callRel = toWorkspaceRel(projectRoot, callPath);

    const hasImportStore = await io.exists(importRel);
    const hasCallStore = await io.exists(callRel);

    if (hasImportStore) await importStore.load();
    if (hasCallStore) await callStore.load();

    // Get edge list timestamps
    const importTimestamp = hasImportStore ? await getFileTimestamp(io, importRel) : 0;
    const callTimestamp = hasCallStore ? await getFileTimestamp(io, callRel) : 0;

    // Build set of FILES that have edges (not folders)
    const filesWithImportEdges = new Set<string>();
    const filesWithCallEdges = new Set<string>();

    if (hasImportStore) {
        for (const node of importStore.getNodes()) {
            if (node.kind === 'file') {
                filesWithImportEdges.add(node.fileId);
            }
        }
    }

    if (hasCallStore) {
        // For call edges, track files that have been processed (have nodes)
        for (const node of callStore.getNodes()) {
            if (node.kind === 'file') {
                filesWithCallEdges.add(node.fileId);
            }
        }
    }

    // Scan all folders and compute status based on files inside.
    // Start at the workspace root ('.' relative).
    await scanFoldersRecursive(
        io,
        '.',
        results,
        filesWithImportEdges,
        filesWithCallEdges,
        importTimestamp,
        callTimestamp
    );

    // Apply status bubble-up: if ANY child is red, parent is red
    bubbleUpStatus(results);

    return results;
}

/**
 * Bubble up status from children to parents.
 * If ANY child folder has 'never' or 'outdated' status, parent gets the worst status.
 * Priority: never (red) > outdated (orange) > current (green)
 */
function bubbleUpStatus(results: Map<string, FolderGraphStatus>): void {
    // Sort folders by path depth (deepest first - children before parents)
    const sortedPaths = Array.from(results.keys()).sort((a, b) => {
        const depthA = a === '.' ? 0 : a.split('/').length;
        const depthB = b === '.' ? 0 : b.split('/').length;
        return depthB - depthA; // Deepest first
    });

    for (const folderPath of sortedPaths) {
        const status = results.get(folderPath);
        if (!status) continue;

        // Find parent folder
        const parentPath = folderPath === '.' ? null : (
            folderPath.includes('/')
                ? folderPath.substring(0, folderPath.lastIndexOf('/'))
                : '.'
        );

        if (parentPath !== null) {
            const parentStatus = results.get(parentPath);
            if (parentStatus) {
                // Bubble up: parent gets worst status between self and child
                parentStatus.importStatus = getWorstStatus(parentStatus.importStatus, status.importStatus);
                parentStatus.callStatus = getWorstStatus(parentStatus.callStatus, status.callStatus);
            }
        }
    }
}

/**
 * Get the worst (most urgent) status between two statuses.
 * never (red) > outdated (orange) > current (green)
 */
function getWorstStatus(a: 'never' | 'outdated' | 'current', b: 'never' | 'outdated' | 'current'): 'never' | 'outdated' | 'current' {
    if (a === 'never' || b === 'never') return 'never';
    if (a === 'outdated' || b === 'outdated') return 'outdated';
    return 'current';
}

/**
 * Recursively scan folders and compute their status based on files inside.
 * `currentRel` is workspace-relative POSIX form ('.' for the workspace root).
 */
async function scanFoldersRecursive(
    io: WorkspaceIO,
    currentRel: string,
    results: Map<string, FolderGraphStatus>,
    filesWithImportEdges: Set<string>,
    filesWithCallEdges: Set<string>,
    importTimestamp: number,
    callTimestamp: number
): Promise<void> {
    const relativePath = currentRel || '.';

    // Skip ignored folders
    const folderName = relativePath === '.' ? '' : path.posix.basename(relativePath);
    if (folderName && IGNORED_FOLDERS.has(folderName)) return;

    // Get files in this folder and check their status
    const {
        fileCount,
        lastModified,
        filesInFolder
    } = await getFolderInfoWithFiles(io, relativePath);

    // Check how many files have edges computed
    let filesWithImport = 0;
    let filesWithCall = 0;

    for (const file of filesInFolder) {
        const fileRelPath = relativePath === '.' ? file : `${relativePath}/${file}`;
        if (filesWithImportEdges.has(fileRelPath)) filesWithImport++;
        if (filesWithCallEdges.has(fileRelPath)) filesWithCall++;
    }

    // Determine status based on whether ALL files have edges
    let importStatus: GraphStatus = 'never';
    let callStatus: GraphStatus = 'never';

    if (fileCount === 0) {
        // Empty folder - inherit from children (will be set by bubble-up)
        importStatus = 'current';
        callStatus = 'current';
    } else if (filesWithImport === fileCount) {
        // All files have import edges
        importStatus = lastModified > importTimestamp ? 'outdated' : 'current';
    } else if (filesWithImport > 0) {
        // Some files have import edges
        importStatus = 'outdated';
    }

    if (fileCount === 0) {
        // Empty folder
        callStatus = 'current';
    } else if (filesWithCall === fileCount) {
        // All files have call edges
        callStatus = lastModified > callTimestamp ? 'outdated' : 'current';
    } else if (filesWithCall > 0) {
        // Some files have call edges
        callStatus = 'outdated';
    }

    results.set(relativePath, {
        folderPath: relativePath,
        importStatus,
        callStatus,
        hasImportEdges: filesWithImport > 0,
        hasCallEdges: filesWithCall > 0,
        fileCount,
        lastModified
    });

    // Recurse into subdirectories
    let entries: string[];
    try {
        entries = await io.readDir(relativePath);
    } catch (e) {
        return;
    }

    for (const entry of entries) {
        if (IGNORED_FOLDERS.has(entry)) continue;

        const entryRel = relativePath === '.' ? entry : `${relativePath}/${entry}`;
        let isDir = false;
        try {
            const stats = await io.stat(entryRel);
            isDir = stats.isDirectory();
        } catch (e) {
            continue;
        }

        if (isDir) {
            await scanFoldersRecursive(
                io,
                entryRel,
                results,
                filesWithImportEdges,
                filesWithCallEdges,
                importTimestamp,
                callTimestamp
            );
        }
    }
}

/**
 * Get file modification timestamp.
 * `relPath` is workspace-relative POSIX form.
 */
async function getFileTimestamp(io: WorkspaceIO, relPath: string): Promise<number> {
    try {
        const stats = await io.stat(relPath);
        return stats.mtimeMs;
    } catch (e) {
        return 0;
    }
}

/**
 * Get folder info with files list.
 * `folderRel` is workspace-relative POSIX form.
 */
async function getFolderInfoWithFiles(
    io: WorkspaceIO,
    folderRel: string,
): Promise<{ fileCount: number; lastModified: number; filesInFolder: string[] }> {
    let fileCount = 0;
    let lastModified = 0;
    const filesInFolder: string[] = [];

    let entries: string[];
    try {
        entries = await io.readDir(folderRel);
    } catch (e) {
        return { fileCount, lastModified, filesInFolder };
    }

    for (const entry of entries) {
        const entryRel = folderRel === '.' ? entry : `${folderRel}/${entry}`;

        let isFile = false;
        let mtimeMs = 0;
        try {
            const stats = await io.stat(entryRel);
            isFile = stats.isFile();
            mtimeMs = stats.mtimeMs;
        } catch (e) {
            continue;
        }

        if (!isFile) continue;

        // Check if supported extension
        const ext = path.extname(entry).toLowerCase();
        const actualExt = entry.endsWith('.R') ? '.R' : ext;

        if (!ALL_SUPPORTED_EXTENSIONS.includes(ext) && !ALL_SUPPORTED_EXTENSIONS.includes(actualExt)) {
            continue;
        }

        fileCount++;
        filesInFolder.push(entry);
        if (mtimeMs > lastModified) {
            lastModified = mtimeMs;
        }
    }

    return { fileCount, lastModified, filesInFolder };
}

/**
 * Get combined status for display (green/orange/red).
 * - 'current' (green): both import and call are current
 * - 'outdated' (orange): at least one is outdated
 * - 'never' (red): at least one has never been computed
 */
export function getCombinedStatus(importStatus: GraphStatus, callStatus: GraphStatus): GraphStatus {
    if (importStatus === 'never' || callStatus === 'never') {
        return 'never';
    }
    if (importStatus === 'outdated' || callStatus === 'outdated') {
        return 'outdated';
    }
    return 'current';
}

/**
 * Get status color for UI display.
 */
export function getStatusColor(status: GraphStatus): string {
    switch (status) {
        case 'current': return '#22c55e';   // Green
        case 'outdated': return '#f97316';  // Orange
        case 'never': return '#ef4444';     // Red
    }
}
