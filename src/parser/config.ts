/**
 * Parser Configuration
 *
 * Configuration constants for parsing and graph generation.
 * This is the SINGLE SOURCE OF TRUTH for supported file extensions.
 */

import { PythonAdapter } from './python/adapter';
import { CppAdapter } from './cpp/adapter';
import { RustAdapter } from './rust/adapter';
import { RAdapter } from './r/adapter';

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
 * Derived from each tree-sitter adapter's `.extensions` array (single
 * source of truth at the type level) plus `TYPESCRIPT_EXTENSIONS` for
 * the compiler-API path. Runtime support is gated separately by
 * `ParserRegistry.isSupported(filePath)`, which only returns `true` for
 * adapters whose tree-sitter package was successfully `require()`d at
 * registry-construction time.
 *
 * TypeScript/JavaScript supports both imports and call graphs.
 * Other languages (Python, C/C++, Rust, R) support import graphs only.
 */
export const ALL_SUPPORTED_EXTENSIONS: readonly string[] = [
    ...TYPESCRIPT_EXTENSIONS,
    ...new PythonAdapter().extensions,
    ...new CppAdapter().extensions,
    ...new RustAdapter().extensions,
    ...new RAdapter().extensions,
];

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
 * Get language identifier from file path (for syntax highlighting, etc.)
 */
export function getLanguageFromPath(filePath: string): string {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.dart')) return 'dart';
    if (filePath.endsWith('.rs')) return 'rust';
    if (filePath.endsWith('.cpp') || filePath.endsWith('.cc') || filePath.endsWith('.c') ||
        filePath.endsWith('.hpp') || filePath.endsWith('.h')) return 'cpp';
    if (filePath.endsWith('.R') || filePath.endsWith('.r')) return 'r';
    return 'code';
}

// ============================================================================
// Other Configuration
// ============================================================================

/**
 * Folders to always ignore when scanning
 */
export const IGNORED_FOLDERS = new Set([
    'node_modules',
    '.git',
    '.artifacts',
    '.arch',
    '.vscode',
    'dist',
    'out',
    'build'
]);
