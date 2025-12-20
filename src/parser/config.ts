/**
 * Parser Configuration
 * 
 * Configuration constants for parsing and graph generation.
 */

// ============================================================================
// Line Count Thresholds
// ============================================================================

/**
 * Maximum lines per folder before call graph computation is deferred.
 * 
 * If a folder contains more than this many lines of supported code,
 * only import edges will be computed eagerly. Call edges must be
 * generated on-demand using the generate-call-edges script.
 * 
 * Set to 1 for testing, 1000 for production.
 */
export const LAZY_CALL_GRAPH_LINE_THRESHOLD = 1; // TODO: Change to 1000 for production

// ============================================================================
// Supported Extensions
// ============================================================================

/**
 * TypeScript/JavaScript extensions (built-in support)
 */
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * All extensions supported for line counting.
 * Combines built-in TypeScript + LSP-supported languages.
 */
export const ALL_SUPPORTED_EXTENSIONS = [
    // TypeScript/JavaScript (built-in)
    '.ts', '.tsx', '.js', '.jsx',
    // Python (LSP)
    '.py',
    // C/C++ (LSP)
    '.cpp', '.hpp', '.c', '.h', '.cc',
    // R (LSP)
    '.R', '.r'
];

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
