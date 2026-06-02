/**
 * Parser Configuration
 *
 * Configuration constants for parsing and graph generation.
 * This is the SINGLE SOURCE OF TRUTH for supported file extensions.
 */

import { LANGUAGES } from './languages';

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
    // LLMem's own artifacts
    '.artifacts',
    '.arch',
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
