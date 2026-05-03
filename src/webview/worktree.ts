import * as path from 'path';
import { isSupportedFile } from '../parser/config';
import { createLogger } from '../common/logger';
import { WorkspaceIO } from '../workspace/workspace-io';

const log = createLogger('webview-worktree');

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

    // Loop 12: Whether this file's extension is parsable (supported by the
    // parser registry). Computed Node-side from isSupportedFile so the
    // browser-side worktree component does not import parser/config. Only
    // meaningful for files; directories leave it undefined. Optional so
    // older serialized tree blobs still parse — the browser defaults to
    // false (file is rendered, just not toggleable for watching).
    isSupported?: boolean;
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
 *
 * Loop 26: reads `.gitignore` through the realpath-strong WorkspaceIO
 * surface (replaces `fs.existsSync` + `fs.readFileSync`).
 */
async function parseGitignore(io: WorkspaceIO): Promise<Set<string>> {
    const patterns = new Set<string>();

    try {
        if (!(await io.exists('.gitignore'))) {
            return patterns;
        }
        const content = await io.readFile('.gitignore', 'utf8');
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
    } catch (e) {
        log.warn('Failed to parse .gitignore', {
            error: e instanceof Error ? e.message : String(e),
        });
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
 * Loop 26: signature is now `(io, currentRel?, gitignorePatterns?)`.
 * The legacy `(rootPath, currentPath)` absolute-path form is dropped —
 * every caller passed `rootPath === currentPath === workspaceRoot`. The
 * relative-path signature is what `WorkspaceIO` wants.
 *
 * @param io Realpath-strong I/O surface anchored on the workspace root
 * @param currentRel Workspace-relative POSIX path of the current node
 *                   (default: '' which represents the workspace root)
 * @param gitignorePatterns Optional pre-parsed gitignore patterns
 * @returns Root tree node
 */
export async function generateWorkTree(
    io: WorkspaceIO,
    currentRel: string = '',
    gitignorePatterns?: Set<string>
): Promise<ITreeNode> {
    // Parse .gitignore on first call
    if (!gitignorePatterns) {
        gitignorePatterns = await parseGitignore(io);
    }

    // Normalize: '' → '.' for the io surface; keep '' in the resulting
    // node.path to preserve the legacy serialized shape.
    const probeRel = currentRel === '' ? '.' : currentRel;
    const relativePath = currentRel;
    const name = currentRel === ''
        ? path.basename(io.getRealRoot())
        : path.posix.basename(currentRel);

    // Check stats
    let stats: import('fs').Stats;
    try {
        stats = await io.stat(probeRel);
    } catch (e) {
        log.warn('Could not stat path', {
            currentRel,
            error: e instanceof Error ? e.message : String(e),
        });
        return { name, path: relativePath, type: 'file', size: 0 };
    }

    if (stats.isFile()) {
        const size = stats.size;
        let lineCount = 0;

        // Count lines for text files (< 1MB and no null bytes)
        if (size < 1024 * 1024) {
            try {
                const content = await io.readFile(probeRel, 'utf8');
                if (!content.includes('\0')) {
                    lineCount = content.split('\n').length;
                }
            } catch (e) {
                // Ignore read errors (binary files, decode failures, etc.)
            }
        }

        return {
            name,
            path: relativePath,
            type: 'file',
            size,
            lineCount,
            isSupported: isSupportedFile(name)
        };
    } else if (stats.isDirectory()) {
        const children: ITreeNode[] = [];
        let entries: string[] = [];
        try {
            entries = await io.readDir(probeRel);
        } catch (e) {
            log.warn('Could not list dir', {
                currentRel,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        for (const entry of entries) {
            const entryRelPath = relativePath ? `${relativePath}/${entry}` : entry;

            // Check if should be ignored
            if (shouldIgnore(entry, entryRelPath, gitignorePatterns)) continue;

            // Per-child try/catch so a single bad entry (e.g. a symlink
            // pointing outside the workspace, surfaced as PathEscapeError
            // through io.stat) does not abort the entire walk.
            try {
                const childNode = await generateWorkTree(io, entryRelPath, gitignorePatterns);
                children.push(childNode);
            } catch (e) {
                log.warn('Skipping unreadable entry', {
                    entryRelPath,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
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
