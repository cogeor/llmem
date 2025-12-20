/**
 * Graph Status Computation
 * 
 * Determines the status of import/call graphs for each folder.
 * Status is based on comparing edge list timestamps with file modification times.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ImportEdgeListStore, CallEdgeListStore, EdgeListData } from '../graph/edgelist';
import { IGNORED_FOLDERS, ALL_SUPPORTED_EXTENSIONS } from '../parser/config';
import { GraphStatus } from './worktree';

export interface FolderGraphStatus {
    folderPath: string;          // Relative folder path
    importStatus: GraphStatus;   // Import graph status
    callStatus: GraphStatus;     // Call graph status
    hasImportEdges: boolean;     // Whether folder has any import edges
    hasCallEdges: boolean;       // Whether folder has any call edges
    fileCount: number;           // Number of supported source files
    lastModified: number;        // Most recent file modification timestamp
}

/**
 * Compute graph status for all folders in a worktree.
 * 
 * @param projectRoot Workspace root
 * @param artifactRoot Artifact directory
 * @returns Map of folder path to status
 */
export async function computeAllFolderStatuses(
    projectRoot: string,
    artifactRoot: string
): Promise<Map<string, FolderGraphStatus>> {
    const results = new Map<string, FolderGraphStatus>();

    // Load edge lists
    const importStore = new ImportEdgeListStore(artifactRoot);
    const callStore = new CallEdgeListStore(artifactRoot);

    const importPath = path.join(artifactRoot, 'import-edgelist.json');
    const callPath = path.join(artifactRoot, 'call-edgelist.json');

    const hasImportStore = fs.existsSync(importPath);
    const hasCallStore = fs.existsSync(callPath);

    if (hasImportStore) await importStore.load();
    if (hasCallStore) await callStore.load();

    // Get edge list timestamps
    const importTimestamp = hasImportStore ? getFileTimestamp(importPath) : 0;
    const callTimestamp = hasCallStore ? getFileTimestamp(callPath) : 0;

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

    // Scan all folders and compute status based on files inside
    await scanFoldersRecursive(
        projectRoot,
        projectRoot,
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
 */
async function scanFoldersRecursive(
    projectRoot: string,
    currentPath: string,
    results: Map<string, FolderGraphStatus>,
    filesWithImportEdges: Set<string>,
    filesWithCallEdges: Set<string>,
    importTimestamp: number,
    callTimestamp: number
): Promise<void> {
    const relativePath = path.relative(projectRoot, currentPath).replace(/\\/g, '/') || '.';

    // Skip ignored folders
    const folderName = path.basename(currentPath);
    if (IGNORED_FOLDERS.has(folderName)) return;

    // Get files in this folder and check their status
    const {
        fileCount,
        lastModified,
        filesInFolder
    } = getFolderInfoWithFiles(currentPath);

    // Check how many files have edges computed
    let filesWithImport = 0;
    let filesWithCall = 0;

    for (const file of filesInFolder) {
        const fileRelPath = path.join(relativePath, file).replace(/\\/g, '/');
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
        entries = fs.readdirSync(currentPath);
    } catch (e) {
        return;
    }

    for (const entry of entries) {
        if (IGNORED_FOLDERS.has(entry)) continue;

        const entryPath = path.join(currentPath, entry);
        let stats: fs.Stats;
        try {
            stats = fs.statSync(entryPath);
        } catch (e) {
            continue;
        }

        if (stats.isDirectory()) {
            await scanFoldersRecursive(
                projectRoot,
                entryPath,
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
 */
function getFileTimestamp(filePath: string): number {
    try {
        const stats = fs.statSync(filePath);
        return stats.mtimeMs;
    } catch (e) {
        return 0;
    }
}

/**
 * Get folder info with files list.
 */
function getFolderInfoWithFiles(folderPath: string): { fileCount: number; lastModified: number; filesInFolder: string[] } {
    let fileCount = 0;
    let lastModified = 0;
    const filesInFolder: string[] = [];

    let entries: string[];
    try {
        entries = fs.readdirSync(folderPath);
    } catch (e) {
        return { fileCount, lastModified, filesInFolder };
    }

    for (const entry of entries) {
        const entryPath = path.join(folderPath, entry);

        let stats: fs.Stats;
        try {
            stats = fs.statSync(entryPath);
        } catch (e) {
            continue;
        }

        if (!stats.isFile()) continue;

        // Check if supported extension
        const ext = path.extname(entry).toLowerCase();
        const actualExt = entry.endsWith('.R') ? '.R' : ext;

        if (!ALL_SUPPORTED_EXTENSIONS.includes(ext) && !ALL_SUPPORTED_EXTENSIONS.includes(actualExt)) {
            continue;
        }

        fileCount++;
        filesInFolder.push(entry);
        if (stats.mtimeMs > lastModified) {
            lastModified = stats.mtimeMs;
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
