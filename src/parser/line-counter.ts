/**
 * Line Counter
 * 
 * Counts lines of code in folders, supporting all LSP-enabled languages.
 * Used for determining whether to defer call graph computation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ALL_SUPPORTED_EXTENSIONS, IGNORED_FOLDERS } from './config';

export interface FolderLineCount {
    folder: string;           // Relative folder path
    totalLines: number;       // Total lines across all supported files
    fileCount: number;        // Number of files counted
    byExtension: Map<string, number>;  // Lines per extension
}

/**
 * Count lines of code in a folder (non-recursive).
 * Only counts files with supported extensions.
 * 
 * @param rootDir Workspace root (for relative path calculation)
 * @param folderPath Absolute path to folder
 * @returns Line count summary
 */
export function countFolderLines(rootDir: string, folderPath: string): FolderLineCount {
    const relativePath = path.relative(rootDir, folderPath).replace(/\\/g, '/') || '.';
    const result: FolderLineCount = {
        folder: relativePath,
        totalLines: 0,
        fileCount: 0,
        byExtension: new Map()
    };

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return result;
    }

    let entries: string[];
    try {
        entries = fs.readdirSync(folderPath);
    } catch (e) {
        console.warn(`[LineCounter] Cannot read folder: ${folderPath}`);
        return result;
    }

    for (const entry of entries) {
        const fullPath = path.join(folderPath, entry);

        // Skip ignored folders
        if (IGNORED_FOLDERS.has(entry)) continue;

        let stats: fs.Stats;
        try {
            stats = fs.statSync(fullPath);
        } catch (e) {
            continue;
        }

        if (!stats.isFile()) continue;

        // Check if extension is supported
        const ext = path.extname(entry).toLowerCase();
        // Handle case-sensitive R extension
        const actualExt = entry.endsWith('.R') ? '.R' : ext;

        if (!ALL_SUPPORTED_EXTENSIONS.includes(ext) && !ALL_SUPPORTED_EXTENSIONS.includes(actualExt)) {
            continue;
        }

        // Count lines
        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').length;

            result.totalLines += lines;
            result.fileCount++;

            const currentCount = result.byExtension.get(actualExt) || 0;
            result.byExtension.set(actualExt, currentCount + lines);
        } catch (e) {
            // Skip files that can't be read
        }
    }

    return result;
}

/**
 * Count lines for all immediate subdirectories of a root folder.
 * 
 * @param rootDir Workspace root
 * @returns Map of folder path to line count
 */
export function countAllFolderLines(rootDir: string): Map<string, FolderLineCount> {
    const results = new Map<string, FolderLineCount>();

    // Count lines in root folder first
    const rootCount = countFolderLines(rootDir, rootDir);
    results.set('.', rootCount);

    // Recursively count all subdirectories
    countFoldersRecursive(rootDir, rootDir, results);

    return results;
}

/**
 * Recursively count lines in all subdirectories.
 */
function countFoldersRecursive(
    rootDir: string,
    currentDir: string,
    results: Map<string, FolderLineCount>
): void {
    let entries: string[];
    try {
        entries = fs.readdirSync(currentDir);
    } catch (e) {
        return;
    }

    for (const entry of entries) {
        // Skip ignored folders
        if (IGNORED_FOLDERS.has(entry)) continue;

        const fullPath = path.join(currentDir, entry);

        let stats: fs.Stats;
        try {
            stats = fs.statSync(fullPath);
        } catch (e) {
            continue;
        }

        if (!stats.isDirectory()) continue;

        // Count this folder
        const folderCount = countFolderLines(rootDir, fullPath);
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        results.set(relativePath, folderCount);

        // Recurse into subfolder
        countFoldersRecursive(rootDir, fullPath, results);
    }
}

/**
 * Check if a folder exceeds the line threshold for lazy loading.
 * 
 * @param lineCount Result from countFolderLines
 * @param threshold Maximum allowed lines
 * @returns true if folder is too large for eager call graph computation
 */
export function isFolderTooLarge(lineCount: FolderLineCount, threshold: number): boolean {
    return lineCount.totalLines > threshold;
}
