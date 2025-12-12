import * as fs from 'fs';
import * as path from 'path';
import { FileArtifact } from '../../parser/types';
import { deriveFileId, normalizePath } from '../utils';

export interface ArtifactBundle {
    fileId: string;
    artifact: FileArtifact;
}

export function readArtifacts(rootDir: string): ArtifactBundle[] {
    const results: ArtifactBundle[] = [];

    function walk(currentDir: string) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (e) {
            console.error(`Failed to read directory: ${currentDir}`, e);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.artifact')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const artifact = JSON.parse(content) as FileArtifact;

                    // Always derive ID from the relative path of the artifact file itself
                    // this ensures consistency and relative paths in the graph.
                    const relativePath = path.relative(rootDir, fullPath);
                    // Remove .artifact extension
                    const originalSourcePath = relativePath.replace(/\.artifact$/, '');
                    const fileId = deriveFileId(originalSourcePath);

                    // (Optional) Overwrite artifact.file.path to match for consistency? 
                    // No, keeping original data is safer, but our internal ID is relative.
                    if (artifact.file) {
                        artifact.file.id = fileId;
                    }

                    results.push({ fileId, artifact });
                } catch (e) {
                    console.error(`Failed to parse artifact: ${fullPath}`, e);
                }
            }
        }
    }

    walk(rootDir);
    return results;
}
