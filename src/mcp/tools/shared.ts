/**
 * Shared helpers for MCP tool handlers.
 *
 * Currently houses `assertWorkspaceRootMatch`, used by every tool that
 * accepts an explicit workspaceRoot argument to verify the caller is
 * pointing at the same workspace the server was initialized with.
 */

import * as path from 'path';
import { getStoredWorkspaceRoot } from '../server';

/**
 * Assert that the caller-supplied workspaceRoot matches the server-stored root.
 * Throws a formatted error if they differ after resolution.
 */
export function assertWorkspaceRootMatch(callerRoot: string): void {
    let stored: string;
    try {
        stored = getStoredWorkspaceRoot();
    } catch {
        // Server not yet initialized — fall through; validateWorkspaceRoot will catch invalid roots
        return;
    }
    const resolved = path.resolve(callerRoot);
    const storedResolved = path.resolve(stored);
    if (process.platform === 'win32') {
        if (resolved.toLowerCase() !== storedResolved.toLowerCase()) {
            throw new Error(
                `workspaceRoot mismatch: caller supplied '${callerRoot}' but server root is '${stored}'.`
            );
        }
    } else {
        if (resolved !== storedResolved) {
            throw new Error(
                `workspaceRoot mismatch: caller supplied '${callerRoot}' but server root is '${stored}'.`
            );
        }
    }
}
