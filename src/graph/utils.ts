import * as path from 'path';

/**
 * Normalizes a file path to a canonical repo-relative format (forward slashes).
 * e.g., "src\foo\bar.ts" -> "src/foo/bar.ts"
 */
export function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

/**
 * Derives a consistent FileID from a repo-relative path.
 */
export function deriveFileId(repoRelativePath: string): string {
    return normalizePath(repoRelativePath);
}

/**
 * Generates a global entity ID.
 */
export function deriveEntityId(fileId: string, localEntityId: string): string {
    return `${fileId}#${localEntityId}`;
}

/**
 * Generates a derived ID for call sites to ensure uniqueness.
 */
export function deriveCallSiteKey(fileId: string, callerEntityId: string, originalCallSiteId: string, index: number): string {
    return `${fileId}#${callerEntityId}#${originalCallSiteId}#${index}`;
}
