import * as fs from 'fs';
import * as path from 'path';

/**
 * Graph computation status for a folder.
 * - 'never': edges have never been computed
 * - 'outdated': edges exist but files have changed since computation
 * - 'current': edges are up-to-date with source files
 */
export type GraphStatus = 'never' | 'outdated' | 'current';

export interface ITreeNode {
    name: string;
    path: string; // Relative path
    type: 'file' | 'directory';
    size: number;
    children?: ITreeNode[];
    lineCount?: number;

    // Graph status tracking (directories only)
    importStatus?: GraphStatus;  // Status of import edges for this folder
    callStatus?: GraphStatus;    // Status of call edges for this folder
}

// Always ignored folders (regardless of .gitignore)
const ALWAYS_IGNORED = new Set([
    'node_modules',
    '.git',
    '.artifacts',
    '.vscode',
    '.DS_Store'
]);

/**
 * Parse .gitignore and return a set of patterns.
 * Simple implementation - handles basic patterns only.
 */
function parseGitignore(rootPath: string): Set<string> {
    const patterns = new Set<string>();
    const gitignorePath = path.join(rootPath, '.gitignore');

    try {
        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                // Skip comments and empty lines
                if (!trimmed || trimmed.startsWith('#')) continue;

                // Remove trailing slashes for directory patterns
                let pattern = trimmed.replace(/\/$/, '');

                // Handle negation (we don't support it, just skip)
                if (pattern.startsWith('!')) continue;

                patterns.add(pattern);
            }
        }
    } catch (e) {
        console.warn('Failed to parse .gitignore:', e);
    }

    return patterns;
}

/**
 * Check if a path should be ignored based on gitignore patterns.
 * Simple implementation - matches exact names and basic glob patterns.
 */
function shouldIgnore(name: string, relativePath: string, patterns: Set<string>): boolean {
    // Check always ignored
    if (ALWAYS_IGNORED.has(name)) return true;

    // Skip problematic file extensions that can cause issues (like Electron .asar archives, large CSVs)
    const SKIP_EXTENSIONS = [
        // Binary executables and libraries
        '.asar', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm',
        // Large data files (can cause performance issues)
        '.csv', '.json', '.xml', '.yaml', '.yml',
        // Database files
        '.db', '.sqlite', '.sqlite3',
        // Media files
        '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp',
        '.mp4', '.avi', '.mov', '.mp3', '.wav',
        // Archives
        '.zip', '.tar', '.gz', '.7z', '.rar',
        // Documents  
        '.pdf', '.doc', '.docx', '.xls', '.xlsx'
    ];
    const ext = path.extname(name).toLowerCase();
    if (SKIP_EXTENSIONS.includes(ext)) return true;

    // Check gitignore patterns
    for (const pattern of patterns) {
        // Exact name match
        if (pattern === name) return true;

        // Path match (for patterns like "dist" or "out")
        if (relativePath === pattern || relativePath.startsWith(pattern + '/')) return true;

        // Simple glob: *.ext
        if (pattern.startsWith('*.')) {
            const extPattern = pattern.slice(1); // e.g., ".log"
            if (name.endsWith(extPattern)) return true;
        }

        // Pattern ends with /* (match directory contents)
        if (pattern.endsWith('/*')) {
            const dir = pattern.slice(0, -2);
            if (relativePath.startsWith(dir + '/')) return true;
        }
    }

    return false;
}

/**
 * Recursively generates a tree structure of the workspace.
 * Respects .gitignore patterns.
 * 
 * @param rootPath Absolute path to the root directory
 * @param currentPath Absolute path to the current directory being scanned (default: rootPath)
 * @param gitignorePatterns Optional pre-parsed gitignore patterns
 * @returns Root tree node
 */
export async function generateWorkTree(
    rootPath: string,
    currentPath: string = rootPath,
    gitignorePatterns?: Set<string>
): Promise<ITreeNode> {
    // Parse .gitignore on first call
    if (!gitignorePatterns) {
        gitignorePatterns = parseGitignore(rootPath);
    }

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

        // Count lines for text files (< 1MB and no null bytes)
        if (size < 1024 * 1024) {
            try {
                const content = fs.readFileSync(currentPath, 'utf8');
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
            const entryRelPath = relativePath ? `${relativePath}/${entry}` : entry;

            // Check if should be ignored
            if (shouldIgnore(entry, entryRelPath, gitignorePatterns)) continue;

            const fullPath = path.join(currentPath, entry);
            const childNode = await generateWorkTree(rootPath, fullPath, gitignorePatterns);
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
            size: 0,
            children
        };
    }

    return { name, path: relativePath, type: 'file', size: 0 };
}
