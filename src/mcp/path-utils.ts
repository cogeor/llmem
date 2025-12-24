/**
 * Path Validation Utilities for MCP Server
 *
 * Ensures all file operations stay within the workspace boundary.
 * Prevents directory traversal attacks and validates workspace roots.
 *
 * Key Principle: NEVER trust paths from external sources.
 * Always validate against the workspace root provided by the client.
 */

import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Validate that a path stays within the workspace root
 *
 * This function:
 * 1. Resolves both the workspace root and target path to absolute paths
 * 2. Normalizes path separators for the current platform
 * 3. Ensures the target path starts with the workspace root
 * 4. Prevents directory traversal attacks (../)
 *
 * @param workspaceRoot - Absolute path to the workspace root
 * @param relativePath - Path relative to the workspace root
 * @returns Validated absolute path
 * @throws Error if the path escapes the workspace boundary
 *
 * @example
 * ```ts
 * // Valid path
 * validateWorkspacePath('/home/user/project', 'src/file.ts')
 * // Returns: '/home/user/project/src/file.ts'
 *
 * // Invalid path (directory traversal)
 * validateWorkspacePath('/home/user/project', '../../../etc/passwd')
 * // Throws: Error
 * ```
 */
export function validateWorkspacePath(
    workspaceRoot: string,
    relativePath: string
): string {
    // 1. Normalize and resolve paths
    const root = path.resolve(workspaceRoot);
    const targetPath = path.resolve(root, relativePath);

    // 2. Enforce workspace boundary
    // Use path.sep to ensure correct separator for the platform
    const rootWithSep = root + path.sep;

    if (!targetPath.startsWith(rootWithSep) && targetPath !== root) {
        throw new Error(
            `Path validation failed: '${relativePath}' escapes workspace root. ` +
            `Refusing to access files outside workspace.`
        );
    }

    return targetPath;
}

/**
 * Validate that a workspace root is a valid directory
 *
 * @param workspaceRoot - Path to validate as workspace root
 * @throws Error if the path is not a valid directory
 */
export function validateWorkspaceRoot(workspaceRoot: string): void {
    if (!workspaceRoot) {
        throw new Error('Workspace root is required but was not provided.');
    }

    const resolvedRoot = path.resolve(workspaceRoot);

    if (!fs.existsSync(resolvedRoot)) {
        throw new Error(
            `Workspace root does not exist: ${resolvedRoot}. ` +
            `Please ensure the workspace directory exists.`
        );
    }

    const stat = fs.statSync(resolvedRoot);
    if (!stat.isDirectory()) {
        throw new Error(
            `Workspace root is not a directory: ${resolvedRoot}. ` +
            `Please provide a valid directory path.`
        );
    }
}

/**
 * Ensure a directory exists within the workspace
 * Creates parent directories recursively if needed
 *
 * @param workspaceRoot - Workspace root path
 * @param relativePath - Path relative to workspace root
 * @returns Validated absolute directory path
 * @throws Error if the path escapes workspace boundary
 */
export function ensureDirectoryInWorkspace(
    workspaceRoot: string,
    relativePath: string
): string {
    const targetPath = validateWorkspacePath(workspaceRoot, relativePath);

    if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
    }

    return targetPath;
}

/**
 * Safely read a file within the workspace
 *
 * @param workspaceRoot - Workspace root path
 * @param relativePath - Path relative to workspace root
 * @param encoding - File encoding (default: 'utf-8')
 * @returns File contents
 * @throws Error if file doesn't exist or path is invalid
 */
export function readFileInWorkspace(
    workspaceRoot: string,
    relativePath: string,
    encoding: BufferEncoding = 'utf-8'
): string {
    const filePath = validateWorkspacePath(workspaceRoot, relativePath);

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${relativePath}`);
    }

    return fs.readFileSync(filePath, encoding);
}

/**
 * Safely write a file within the workspace
 * Creates parent directories if needed
 *
 * @param workspaceRoot - Workspace root path
 * @param relativePath - Path relative to workspace root
 * @param content - File content to write
 * @param encoding - File encoding (default: 'utf-8')
 * @throws Error if path is invalid
 */
export function writeFileInWorkspace(
    workspaceRoot: string,
    relativePath: string,
    content: string,
    encoding: BufferEncoding = 'utf-8'
): void {
    const filePath = validateWorkspacePath(workspaceRoot, relativePath);

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, encoding);
}

/**
 * Check if a file exists within the workspace
 *
 * @param workspaceRoot - Workspace root path
 * @param relativePath - Path relative to workspace root
 * @returns true if file exists, false otherwise
 * @throws Error if path is invalid (escapes workspace)
 */
export function fileExistsInWorkspace(
    workspaceRoot: string,
    relativePath: string
): boolean {
    const filePath = validateWorkspacePath(workspaceRoot, relativePath);
    return fs.existsSync(filePath);
}
