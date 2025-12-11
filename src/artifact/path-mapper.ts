import * as path from 'path';
import * as os from 'os';

const ARTIFACTS_DIR = '.artifacts';

/**
 * Returns the absolute path to the artifacts root directory for the workspace.
 * Assumes the CWD is the workspace root or we can derive it.
 * For this extension, we usually run from workspace root.
 */
export function getArtifactsRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, ARTIFACTS_DIR);
}

/**
 * Maps a source file path to its corresponding directory in the hidden artifacts tree.
 * Structure: .artifacts/path/to/source/file.ext/
 */
export function sourceToArtifactDir(workspaceRoot: string, sourcePath: string): string {
    const relativeSource = path.relative(workspaceRoot, sourcePath);
    // prevented traversing up
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
        throw new Error(`Source path must be inside workspace: ${sourcePath}`);
    }

    return path.join(getArtifactsRoot(workspaceRoot), relativeSource);
}

/**
 * Generates the full path for a specific artifact file.
 * Format: .artifacts/path/to/source/file.ext/<type>.md
 */
export function artifactFilePath(workspaceRoot: string, sourcePath: string, artifactType: string): string {
    const artifactDir = sourceToArtifactDir(workspaceRoot, sourcePath);
    // Sanitize type just in case
    const safeType = artifactType.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Mirror artifacts have a special extension
    const extension = artifactType === 'mirror' ? 'artifact' : 'md';
    return path.join(artifactDir, `${safeType}.${extension}`);
}
