/**
 * Parser Configuration
 *
 * Configuration constants for parsing and graph generation.
 * This is the SINGLE SOURCE OF TRUTH for supported file extensions.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
    LANGUAGE_DESCRIPTORS,
    type CallGraphCapability,
    ALL_SUPPORTED_EXTENSIONS,
    SUPPORTED_EXTENSIONS_SET,
} from '../core/language-descriptors';

// Re-export the extension surface so existing parser/application consumers keep
// importing it from `parser/config` unchanged. The canonical definitions now
// live in `src/core/language-descriptors` so the `graph` layer can read them
// without importing the `parser` layer (tests/arch/layer-matrix.test.ts).
export { ALL_SUPPORTED_EXTENSIONS, SUPPORTED_EXTENSIONS_SET };

// ============================================================================
// Line Count Thresholds
// ============================================================================

/**
 * Maximum total parsable lines in codebase before lazy loading is enabled.
 *
 * If the codebase contains fewer lines than this threshold, all edges
 * and nodes are computed eagerly.
 *
 * If the codebase exceeds this threshold, only file nodes are created
 * initially; edges are generated on-demand via toggle buttons.
 *
 * Set to 1 for testing, 10000 for production.
 */
export const LAZY_CODEBASE_LINE_THRESHOLD = 10000;

// ============================================================================
// Supported Extensions (SINGLE SOURCE OF TRUTH)
// ============================================================================

/**
 * TypeScript/JavaScript extensions (built-in TypeScript compiler support).
 *
 * These are the only extensions hand-typed in this file: TS/JS does not
 * use a tree-sitter adapter, so there is no adapter `.extensions` array
 * to derive them from.
 */
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Check if a file extension is supported for parsing
 */
export function isSupportedExtension(ext: string): boolean {
    return SUPPORTED_EXTENSIONS_SET.has(ext.toLowerCase()) ||
        SUPPORTED_EXTENSIONS_SET.has(ext); // Handle case-sensitive .R
}

/**
 * Check if a filename has a supported extension
 */
export function isSupportedFile(filename: string): boolean {
    const ext = '.' + (filename.split('.').pop() || '');
    return isSupportedExtension(ext);
}

/**
 * Get language identifier from file path (for syntax highlighting, etc.).
 *
 * Derived from the `LANGUAGES` descriptor: the file's extension is matched
 * (case-insensitively) against each language's `extensions`, then resolved
 * to its highlight id via `highlightOverrides[ext] ?? highlightId`. This
 * preserves the `.ts`/`.tsx` → 'typescript' vs `.js`/`.jsx` → 'javascript'
 * split (encoded as highlightOverrides on the typescript descriptor).
 * Unknown extensions return 'code'.
 */
export function getLanguageFromPath(filePath: string): string {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) return 'code';
    const ext = filePath.slice(dot).toLowerCase();

    for (const lang of LANGUAGE_DESCRIPTORS) {
        for (const e of lang.extensions) {
            if (e.toLowerCase() === ext) {
                return lang.highlightOverrides?.[ext] ?? lang.highlightId;
            }
        }
    }
    return 'code';
}

/**
 * Call-graph capability for a file, derived from the LANGUAGES descriptor:
 * 'semantic' (TS/JS), 'heuristic' (Python — name-matched), or 'none'
 * (C/C++/Rust/R and unknown extensions). Used by the graph builder to decide
 * which files' call entities become call-graph nodes (the call graph is no
 * longer TS-only — heuristic languages participate too, marked in the viewer).
 */
export function getCallGraphCapability(filePath: string): CallGraphCapability {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) return 'none';
    const ext = filePath.slice(dot).toLowerCase();

    for (const lang of LANGUAGE_DESCRIPTORS) {
        for (const e of lang.extensions) {
            if (e.toLowerCase() === ext) {
                return lang.callGraph;
            }
        }
    }
    return 'none';
}

// ============================================================================
// Generated / derived file denylist
// ============================================================================

/**
 * Filename patterns for machine-generated / derived files that should be
 * skipped when scanning a codebase.
 *
 * Each entry matches on a *segment boundary* (a leading dot) so it never
 * fires on substrings: `*.min.*` matches `foo.min.js` but not `terminal.ts`
 * (no spurious 'min' substring hit). Patterns are anchored against the file
 * basename only (no path/directory matching) and run case-insensitively,
 * mirroring this file's existing extension-lowercasing convention.
 *
 * NOTE: `\.d\.ts$` is opinionated and on-by-default — TypeScript declaration
 * files are derived artifacts, but a `.d.ts` is also a perfectly valid `.ts`
 * file, so this is intentionally a *distinct* denylist gate rather than an
 * extension filter. It is a single entry users can drop if they want to scan
 * their declaration files.
 *
 * This constant + {@link isGeneratedFile} are self-contained: no scan code
 * consumes them yet (a later loop wires them into the walker), so source and
 * tests share exactly one matcher.
 */
export const GENERATED_DENYLIST: readonly RegExp[] = [
    /\.min\./i,
    /\.bundle\./i,
    /\.generated\./i,
    /\.d\.ts$/i,
];

/**
 * Return `true` if `filename` looks like a machine-generated / derived file
 * per {@link GENERATED_DENYLIST}. Name-only (no I/O): matches the basename
 * case-insensitively.
 *
 * @example
 * isGeneratedFile('foo.min.js')    // true
 * isGeneratedFile('a.bundle.css')  // true
 * isGeneratedFile('x.generated.ts')// true
 * isGeneratedFile('types.d.ts')    // true
 * isGeneratedFile('extractor.ts')  // false
 * isGeneratedFile('index.js')      // false
 */
export function isGeneratedFile(filename: string): boolean {
    const base = path.basename(filename);
    return GENERATED_DENYLIST.some((pattern) => pattern.test(base));
}

// ============================================================================
// Other Configuration
// ============================================================================

/**
 * Folders to always ignore when scanning.
 *
 * Mix of JS/TS build outputs (`node_modules`, `dist`, `out`, `build`,
 * `.next`, `.nuxt`, `coverage`), Python venvs and caches (`__pycache__`,
 * `.venv`, `venv`), Rust/Go/.NET build outputs (`target`, `vendor`,
 * `bin`, `obj`), and editor/VCS dirs (`.git`, `.idea`, `.vscode`). Without
 * these, scanning a typical Python or Rust repo walks tens of thousands
 * of stdlib/dependency files and pegs CPU.
 */
export const IGNORED_FOLDERS = new Set([
    // VCS / editors
    '.git',
    '.hg',
    '.svn',
    '.idea',
    '.vscode',
    // OS cruft (a file name, not a folder; matched per-entry by name — PH-07
    // folded it here from the explorer's old ALWAYS_IGNORED set)
    '.DS_Store',
    // LLMem's own artifacts (.llmem is the centralized root; one folder name
    // ignores the whole .llmem/ tree in the explorer walk — PH-07)
    '.artifacts',
    '.arch',
    '.llmem',
    // Agent/tooling work-artifact trees (gitignored scratch dirs). These are
    // not source and must never enter the graph — a stray .delegate/ leaked
    // tool-run artifacts into the edge list (whole-graph metrics were computed
    // over gitignored junk). NOTE: this is a name-denylist stopgap; honoring
    // .gitignore wholesale is the general fix (tracked as data-hygiene work).
    '.delegate',
    // JS / TS
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    // Python
    '__pycache__',
    '.venv',
    'venv',
    '.tox',
    '.pytest_cache',
    // Rust / Go / .NET
    'target',
    'vendor',
    'bin',
    'obj',
]);

/**
 * Marker FILES that identify a directory as a virtualenv or cache dir even
 * when its NAME is not in {@link IGNORED_FOLDERS}:
 *
 * - `pyvenv.cfg` — the universal Python venv marker. Every venv carries one
 *   at its top level regardless of the directory's name, so a nonstandard
 *   venv name (e.g. `.venv_diffdock_pp`) is still recognized. Without this,
 *   crawling one stray venv pulls its entire `site-packages` into the graph
 *   (observed: 60k+ import nodes, 10+ minute scans).
 * - `CACHEDIR.TAG` — the cachedir.org convention written by pip, uv, pytest,
 *   cargo and friends into their cache directories.
 */
const IGNORE_MARKER_FILES = ['pyvenv.cfg', 'CACHEDIR.TAG'] as const;

/**
 * Return `true` when the directory entry `parentDirAbs/entryName` must be
 * skipped by a directory walk. Two layers:
 *
 * 1. Name check (free): `entryName` is in {@link IGNORED_FOLDERS}.
 * 2. Marker check (1–2 `existsSync` calls, only when the name check misses):
 *    the directory itself CONTAINS one of {@link IGNORE_MARKER_FILES}.
 *
 * This is the shared gate for EVERY walk that used to consult
 * `IGNORED_FOLDERS` directly (scan, refresh, line counter, explorer tree,
 * graph status). Callers pass the ABSOLUTE path of the parent directory being
 * listed plus the entry name; the marker files live INSIDE the entry. Calling
 * it on a file entry is safe — `existsSync` under a file path is just false.
 */
export function isIgnoredDir(parentDirAbs: string, entryName: string): boolean {
    if (IGNORED_FOLDERS.has(entryName)) return true;
    const dirAbs = path.join(parentDirAbs, entryName);
    for (const marker of IGNORE_MARKER_FILES) {
        if (fs.existsSync(path.join(dirAbs, marker))) return true;
    }
    return false;
}
