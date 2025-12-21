/**
 * Parser Configuration
 * 
 * Configuration constants for parsing and graph generation.
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
