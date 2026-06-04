/**
 * Parser Configuration
 *
 * Configuration constants for parsing and graph generation.
 * This is the SINGLE SOURCE OF TRUTH for supported file extensions.
 */

import * as path from 'path';

import { LANGUAGES, type CallGraphCapability } from './languages';

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
 * All extensions supported for parsing and graph generation.
 *
 * Derived from the `LANGUAGES` descriptor array (the single source of
 * truth for supported languages and their extensions). Runtime support is
 * gated separately by `ParserRegistry.isSupported(filePath)`, which only
 * returns `true` for adapters whose tree-sitter package was successfully
 * `require()`d at registry-construction time.
 *
 * TypeScript/JavaScript supports both imports and call graphs.
 * Other languages (Python, C/C++, Rust, R) support import graphs only.
 */
export const ALL_SUPPORTED_EXTENSIONS: readonly string[] =
    LANGUAGES.flatMap((l) => l.extensions);

/**
 * Set version for efficient O(1) lookups
 */
export const SUPPORTED_EXTENSIONS_SET: ReadonlySet<string> = new Set(ALL_SUPPORTED_EXTENSIONS);

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

    for (const lang of LANGUAGES) {
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

    for (const lang of LANGUAGES) {
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
