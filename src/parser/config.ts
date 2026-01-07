/**
 * Parser Configuration
 * 
 * Configuration constants for parsing and graph generation.
 * This is the SINGLE SOURCE OF TRUTH for supported file extensions.
 */

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
export const LAZY_CODEBASE_LINE_THRESHOLD = 1; // TODO: Change to 10000 for production

// ============================================================================
// Supported Extensions (SINGLE SOURCE OF TRUTH)
// ============================================================================

/**
 * TypeScript/JavaScript extensions (built-in TypeScript compiler support)
 */
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * All extensions supported for parsing and graph generation.
 * TypeScript/JavaScript uses compiler API (with call graph support).
 * Other languages use tree-sitter (import graph only, no calls).
 */
export const ALL_SUPPORTED_EXTENSIONS = [
    // TypeScript/JavaScript (TS compiler API - supports imports + calls)
    '.ts', '.tsx', '.js', '.jsx',
    // Python (tree-sitter - imports only)
    '.py',
    // C/C++ (tree-sitter - imports via #include only)
    '.cpp', '.hpp', '.c', '.h', '.cc', '.cxx', '.hxx',
    // Rust (tree-sitter - imports via use only)
    '.rs',
    // R (tree-sitter - imports via library/require/source only)
    '.R', '.r',
    // Future support (Java, Go)
    '.java', '.go'
];

/**
 * Set version for efficient O(1) lookups
 */
export const SUPPORTED_EXTENSIONS_SET = new Set(ALL_SUPPORTED_EXTENSIONS);

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
    if (filePath.endsWith('.java')) return 'java';
    if (filePath.endsWith('.go')) return 'go';
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
