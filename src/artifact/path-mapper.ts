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
    let relativeSource = sourcePath;
    if (path.isAbsolute(sourcePath)) {
        relativeSource = path.relative(workspaceRoot, sourcePath);
    }
    // prevented traversing up
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
        throw new Error(`Source path must be inside workspace: ${sourcePath}`);
    }

    const relativeDir = path.dirname(relativeSource);
    return path.join(getArtifactsRoot(workspaceRoot), relativeDir);
}

/**
 * Generates the full path for a specific artifact file.
 * Format: .artifacts/path/to/source/file.ext/<type>.md
 */
export function artifactFilePath(workspaceRoot: string, sourcePath: string, artifactType: string): string {
    const artifactDir = sourceToArtifactDir(workspaceRoot, sourcePath);
    // Sanitize type just in case
    const safeType = artifactType.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Naming convention:
    // Source: src/file.ts
    // Artifact: .artifacts/src/file.ts/file.ts.artifact (if we stay with directory per file)
    // OR Flat Sibling: .artifacts/src/file.ts.artifact

    // Per the plan "Sibling style": 
    // .artifacts/src/path/file.ts.artifact

    // NOTE: sourceToArtifactDir currently creates a directory matching the source file structure.
    // e.g. src/extension/config.ts -> .artifacts/src/extension/config.ts/

    // If we want SIBLING style:
    // src/extension/config.ts -> .artifacts/src/extension/config.ts.artifact

    // Let's adjust sourceToArtifactDir to return the PARENT directory of the artifact
    // BUT sourceToArtifactDir is used to calculate the destination.

    // Let's refactor slightly.

    let relativeSource = sourcePath;
    if (path.isAbsolute(sourcePath)) {
        relativeSource = path.relative(workspaceRoot, sourcePath);
    }
    const artifactsRoot = getArtifactsRoot(workspaceRoot);
    const relativeDir = path.dirname(relativeSource);
    const fileName = path.basename(relativeSource);

    // Target Dir: .artifacts/src/extension/
    const targetDir = path.join(artifactsRoot, relativeDir);

    if (artifactType === 'mirror') {
        // .artifacts/src/path/file.ts.artifact
        return path.join(targetDir, `${fileName}.artifact`);
    } else {
        // .artifacts/src/path/file.ts.<type>.md (legacy/other types)
        // OR make them siblings too: file.ts.summary.md
        return path.join(targetDir, `${fileName}.${safeType}.md`);
    }
}

/**
 * Generates the path for a folder summary artifact.
 * Format: .artifacts/path/to/folder/folderName.summary
 */
export function summaryFilePath(workspaceRoot: string, folderPath: string): string {
    const relativeFolder = path.relative(workspaceRoot, folderPath);
    const artifactsRoot = getArtifactsRoot(workspaceRoot);
    const folderName = path.basename(folderPath);

    return path.join(artifactsRoot, relativeFolder, `${folderName}.summary`);
}
