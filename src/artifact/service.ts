import * as crypto from 'crypto';
import * as path from 'path';
import { ArtifactMetadata, ArtifactRecord, ArtifactTree } from './types';
import { ArtifactIndex } from './index';
import { ArtifactTreeManager } from './tree';
import { artifactFilePath, sourceToArtifactDir } from './path-mapper';
import { readFile, writeFile, deleteFile, exists } from './storage';

let index: ArtifactIndex;
let tree: ArtifactTreeManager;
let workspaceRoot: string;
let isInitialized = false;

import { OutlineGenerator } from '../parser';

let outlineGenerator: OutlineGenerator;

export async function initializeArtifactService(root: string) {
    workspaceRoot = root;
    index = new ArtifactIndex(workspaceRoot);
    tree = new ArtifactTreeManager();
    outlineGenerator = new OutlineGenerator();
    await index.load();
    tree.build(index.getAll());
    isInitialized = true;
}

function checkInitialized() {
    if (!isInitialized) {
        throw new Error('Artifact service not initialized. Call initializeArtifactService() first.');
    }
}

export async function createArtifact(sourcePath: string, type: string, content: string): Promise<ArtifactMetadata> {
    checkInitialized();

    // Generate paths
    const filePath = artifactFilePath(workspaceRoot, sourcePath, type);

    // Create metadata
    const metadata: ArtifactMetadata = {
        id: crypto.randomUUID(),
        sourcePath: sourcePath,
        artifactPath: filePath,
        type: type,
        createdAt: new Date().toISOString()
    };

    // Write file
    await writeFile(filePath, content);

    // Update index
    index.addRecord(metadata);
    await index.save();

    // Update tree
    tree.build(index.getAll());

    return metadata;
}

export async function getArtifact(pathOrId: string): Promise<ArtifactRecord | null> {
    checkInitialized();

    // 1. Try to find existing record
    const all = index.getAll();
    let record = all.find(r => r.id === pathOrId || r.artifactPath === pathOrId);

    // If looking up by source path (common case for "get info for file X")
    if (!record) {
        // Find by source path
        // We prioritize "mirror" artifacts for source files
        const matches = all.filter(r => r.sourcePath === pathOrId);
        // If we have a mirror, return that. Else return the most recent one.
        record = matches.find(r => r.type === 'mirror');
        if (!record && matches.length > 0) {
            matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            record = matches[0];
        }
    }

    // 2. If no record found, check if it is a valid source file and generate mirror
    if (!record) {
        // Assume pathOrId is a source path if it exists on disk
        // We need to resolve it to absolute path if it is relative
        let absCurrentPath = pathOrId;
        if (!path.isAbsolute(pathOrId)) {
            absCurrentPath = path.join(workspaceRoot, pathOrId);
        }

        if (await exists(absCurrentPath)) {
            // It's a source file! Generate mirror.
            const sourceContent = await readFile(absCurrentPath);
            if (sourceContent !== null) {
                const outline = await outlineGenerator.generateFileOutline(absCurrentPath, sourceContent);
                if (outline) {
                    // Create the mirror artifact
                    const artifactContent = JSON.stringify({
                        sourcePath: pathOrId, // Keep relative/as requested or normalize? Let's use mapped one.
                        lastModified: Date.now(), // TODO: getting real stats would be better
                        structure: outline,
                        enrichment: {}
                    }, null, 2);

                    const metadata = await createArtifact(pathOrId, 'mirror', artifactContent);
                    return {
                        metadata,
                        content: artifactContent,
                        data: JSON.parse(artifactContent)
                    };
                }
            }
        }
    }

    if (!record) {
        return null;
    }

    const content = await readFile(record.artifactPath);
    if (content === null) {
        return null; // Inconsistency
    }

    // Attempt to parse if it's a mirror
    let data;
    if (record.type === 'mirror') {
        try {
            data = JSON.parse(content);
        } catch (e) {
            // ignore JSON parse error
        }
    }

    return {
        metadata: record,
        content: content,
        data
    };
}

export async function listArtifacts(filter?: { sourcePath?: string; type?: string }): Promise<ArtifactMetadata[]> {
    checkInitialized();
    if (filter) {
        return index.query(filter);
    }
    return index.getAll();
}

/**
 * Deletes an artifact by ID or path.
 */
export async function deleteArtifact(pathOrId: string): Promise<boolean> {
    checkInitialized();

    const all = index.getAll();
    const record = all.find(r => r.id === pathOrId) || all.find(r => r.artifactPath === pathOrId);

    if (!record) {
        return false;
    }

    // Delete file
    await deleteFile(record.artifactPath);

    // Update index
    index.removeRecord(record.id);
    await index.save();

    // Update tree
    tree.build(index.getAll());

    return true;
}

export function getArtifactTree(): ArtifactTree {
    checkInitialized();
    return tree.getTree();
}
