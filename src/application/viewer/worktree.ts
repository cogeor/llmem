import * as path from 'path';
import { ParserRegistry } from '../../parser/registry';
import { isIgnoredDir } from '../../parser/config';
import { createLogger } from '../../common/logger';
import { WorkspaceIO } from '../../workspace/workspace-io';

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

    // PH-04: a statically-known source extension whose tree-sitter grammar is
    // NOT installed at runtime. Such files must render a muted "install hint"
    // marker instead of a live toggle (the toggle would be a silent no-op).
    needsGrammar?: boolean;
    // PH-04: NPM grammar package to install to make this file parsable.
    installHint?: string;
    // PH-04: call-graph capability for this file's language (carried into the
    // vis payload; python-callgraph's badge consumes it later).
    callGraph?: 'semantic' | 'heuristic' | 'none';
}

// PH-07: the scanner (parser/config isIgnoredDir over IGNORED_FOLDERS +
// venv/cache marker files) is the single source of truth for folder ignores.
// The explorer previously kept a divergent ALWAYS_IGNORED set that omitted
// venvs/target/dist/build/.arch, so the tree rendered large vendored trees
// the scanner skipped. shouldIgnore now routes through isIgnoredDir per entry
// (called before stat, so the folded-in .DS_Store file name is matched too).

/**
 * Parse .gitignore and return a set of patterns.
 *
 * APPROXIMATE matcher (PH-08b) — this is a deliberately small, dependency-free
 * subset of real gitignore semantics, NOT a spec-compliant implementation. It
 * is only used to prune the explorer tree, layered on top of the authoritative
 * IGNORED_FOLDERS always-ignore set (shouldIgnore), so a missed pattern just
 * means a file is shown that git would ignore — never the reverse on the
 * always-ignored dirs.
 *
 * UNSUPPORTED (silently dropped or ignored here):
 *   - Negation (`!foo`) — skipped entirely (a re-included path stays ignored).
 *   - `**` recursive globs, character classes (`[abc]`), `?`, brace expansion.
 *   - Anchored patterns (leading `/`) and mid-path globs (`a/*​/b`).
 * SUPPORTED in shouldIgnore: exact name, exact/prefix relative path, `*.ext`,
 * and `dir/*`. For full fidelity, route shouldIgnore through the vetted `ignore`
 * npm package (weighed against the minimal-dependency goal — see PH-08b notes).
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
 * Check if a path should be ignored.
 *
 * Two layers: (1) the authoritative scanner ignore gate (shared with the
 * scanner — PH-07): IGNORED_FOLDERS names plus the pyvenv.cfg / CACHEDIR.TAG
 * marker-file check via isIgnoredDir, and (2) an APPROXIMATE .gitignore match. The
 * gitignore layer supports ONLY: exact name (`pattern === name`), exact/prefix
 * relative-path match, `*.ext`, and `dir/*`. It does NOT support negation (`!`),
 * `**`, character classes, `?`, braces, or anchored (`/`-leading) patterns — see
 * parseGitignore for the full caveat. A pattern outside this subset is a no-op
 * (the entry is shown), which is safe for tree pruning; switch to the `ignore`
 * npm package if exact gitignore fidelity is needed.
 */
function shouldIgnore(name: string, relativePath: string, patterns: Set<string>, parentDirAbs: string): boolean {
    // Check always ignored (shared scanner ignore gate: names + venv/cache
    // marker files — PH-07)
    if (isIgnoredDir(parentDirAbs, name)) return true;

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

        // PH-08: do NOT read every file's bytes during the walk just to count
        // lines — that made tree generation read the entire repo up front and
        // was O(repo-bytes) slow on large trees. A grep of all `lineCount`
        // consumers (renderer, worktreeService, viewer-data, the lazy-threshold
        // gate `isFolderTooLarge`) shows NO consumer reads `ITreeNode.lineCount`
        // for any logic — the lazy call-graph threshold runs off the scan
        // path's `countFolderLines`, not this field. `FileNode.lineCount` only
        // survives as a display-payload field. So we keep the field populated
        // (payload shape unchanged) but via a cheap SIZE-BASED ESTIMATE
        // (avg ~40 bytes/line) instead of a content read. Any caller that needs
        // an EXACT count should compute it lazily at the point of need via the
        // shared `parser/line-counter.ts::countFileLines`.
        const AVG_BYTES_PER_LINE = 40;
        const lineCount = size === 0 ? 0 : Math.max(1, Math.round(size / AVG_BYTES_PER_LINE));

        const support = ParserRegistry.getInstance().getSupport(name);

        return {
            name,
            path: relativePath,
            type: 'file',
            size,
            lineCount,
            isSupported: support.parsable,
            needsGrammar: support.needsGrammar,
            installHint: support.installHint,
            callGraph: support.callGraph
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

        // Absolute path of THIS directory (the parent of every entry below),
        // for the isIgnoredDir marker-file check inside shouldIgnore.
        const dirAbs = io.resolve(probeRel);

        for (const entry of entries) {
            const entryRelPath = relativePath ? `${relativePath}/${entry}` : entry;

            // Check if should be ignored
            if (shouldIgnore(entry, entryRelPath, gitignorePatterns, dirAbs)) continue;

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
