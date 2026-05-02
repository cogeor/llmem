/**
 * Structured error hierarchy for LLMem.
 *
 * All LLMem errors descend from LLMemError, which carries a stable string
 * `code` field for programmatic discrimination. Subclasses set the `name`
 * to their class name for friendlier stack traces.
 *
 * Loop 04 uses PathEscapeError from src/workspace/safe-fs.ts. The other
 * subclasses are declared here for upcoming loops (Loop 09/10's workspace-
 * root resolution will use WorkspaceNotFoundError).
 */

export class LLMemError extends Error {
    public readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = 'LLMemError';
        this.code = code;
    }
}

export class PathEscapeError extends LLMemError {
    public readonly candidate: string;
    public readonly root: string;
    constructor(root: string, candidate: string) {
        super('PATH_ESCAPE', `Path '${candidate}' resolves outside workspace root '${root}'.`);
        this.name = 'PathEscapeError';
        this.candidate = candidate;
        this.root = root;
    }
}

export class WorkspaceNotFoundError extends LLMemError {
    constructor(root: string) {
        super('WORKSPACE_NOT_FOUND', `Workspace root not found or not a directory: ${root}.`);
        this.name = 'WorkspaceNotFoundError';
    }
}
