import * as fs from 'fs';
import * as path from 'path';

export interface ITreeNode {
    name: string;
    path: string; // Relative path
    type: 'file' | 'directory';
    size: number;
    children?: ITreeNode[];
    lineCount?: number;
}

const IGNORED_FOLDERS = new Set([
    'node_modules',
    '.git',
    '.artifacts',
    '.vscode',
    'out',
    'dist',
    '.DS_Store'
]);

/**
 * Recursively generates a tree structure of the workspace.
 * @param rootPath Absolute path to the root directory
 * @param currentPath Absolute path to the current directory being scanned (default: rootPath)
 * @returns Root tree node
 */
export async function generateWorkTree(rootPath: string, currentPath: string = rootPath): Promise<ITreeNode> {
    const name = path.basename(currentPath);
    const relativePath = path.relative(rootPath, currentPath).replace(/\\/g, '/');

    // Check stats
    let stats: fs.Stats;
    try {
        stats = fs.statSync(currentPath);
    } catch (e) {
        console.warn(`Could not stat ${currentPath}:`, e);
        return { name, path: relativePath, type: 'file', size: 0 };
    }

    if (stats.isFile()) {
        const size = stats.size;
        let lineCount = 0;

        // Count lines for text files (simple heuristic: small enough or known extension)
        // We acturally want to count lines for all files roughly to give an idea of code size
        // Avoid binary files if possible. 
        if (size < 1024 * 1024) { // < 1MB
            try {
                const content = fs.readFileSync(currentPath, 'utf8');
                // Check if likely binary (null bytes)
                if (!content.includes('\0')) {
                    lineCount = content.split('\n').length;
                }
            } catch (e) {
                // Ignore read errors
            }
        }

        return {
            name,
            path: relativePath,
            type: 'file',
            size,
            lineCount
        };
    } else if (stats.isDirectory()) {
        const children: ITreeNode[] = [];
        let entries: string[] = [];
        try {
            entries = fs.readdirSync(currentPath);
        } catch (e) {
            console.warn(`Could not list dir ${currentPath}`, e);
        }

        for (const entry of entries) {
            if (IGNORED_FOLDERS.has(entry)) continue;

            const fullPath = path.join(currentPath, entry);
            const childNode = await generateWorkTree(rootPath, fullPath);
            children.push(childNode);
        }

        // Sort: directories first, then files
        children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'directory' ? -1 : 1;
        });

        return {
            name,
            path: relativePath,
            type: 'directory',
            size: 0, // Directories have specific size 0 in this context usually, or sum of children? Standard is 0 or block size.
            children
        };
    }

    return { name, path: relativePath, type: 'file', size: 0 };
}
