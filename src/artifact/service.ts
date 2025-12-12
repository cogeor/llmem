import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ArtifactMetadata, ArtifactRecord, ArtifactTree } from './types';
import { ArtifactIndex } from './index';
import { ArtifactTreeManager } from './tree';
import { artifactFilePath, sourceToArtifactDir, summaryFilePath } from './path-mapper';
import { readFile, writeFile, deleteFile, exists } from './storage';
import { OutlineGenerator } from '../parser';

let index: ArtifactIndex;
let tree: ArtifactTreeManager;
let workspaceRoot: string;
let isInitialized = false;
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

export function getWorkspaceRoot(): string {
    checkInitialized();
    return workspaceRoot;
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

/**
 * Ensures that all files in the given folder have corresponding mirror artifacts.
 * Returns the list of artifacts (content + metadata) for the folder.
 */
export async function ensureArtifacts(folderPath: string, recursive: boolean = false): Promise<ArtifactRecord[]> {
    checkInitialized();

    const absFolderPath = path.isAbsolute(folderPath) ? folderPath : path.join(workspaceRoot, folderPath);
    if (!await exists(absFolderPath)) {
        throw new Error(`Folder not found: ${absFolderPath}`);
    }

    const records: ArtifactRecord[] = [];

    // Read directory
    const entries = await fs.readdir(absFolderPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(absFolderPath, entry.name);
        // Calculate relative path for ID/storage
        const sourcePath = path.relative(workspaceRoot, fullPath);

        if (entry.isDirectory()) {
            if (recursive) {
                const subRecords = await ensureArtifacts(sourcePath, true);
                records.push(...subRecords);
            }
            continue;
        }

        // Only process code files? Let's rely on parser to decide or skip unknown.
        // We prioritize "mirror" artifacts for source files
        const all = index.getAll();
        let record = all.find(r => r.sourcePath === sourcePath && r.type === 'mirror');

        // Check if we need to generate it (if missing)
        // TODO: In future, check lastModified vs source file to update stale artifacts
        if (!record) {
            // Generate it
            const content = await readFile(fullPath);
            if (content !== null) {
                const outline = await outlineGenerator.generateFileOutline(fullPath, content);
                if (outline) {
                    // Create artifact with JUST signatures as per plan
                    const artifactContent = JSON.stringify({
                        path: sourcePath,
                        imports: outline.imports.map(i => `from '${i.source}' import { ${i.specifiers.map(s => s.name).join(', ')} }`),
                        exports: outline.exports.map(e => `export ${e.type} ${e.name}`),
                        types: outline.types.map(t => `${t.kind} ${t.name}`),
                        signatures: outline.functions.map(f => f.signature).concat(
                            outline.classes.flatMap(c =>
                                [`class ${c.name}`].concat(c.methods.map(m => `  ${m.signature}`))
                            )
                        )
                    }, null, 2);

                    const metadata = await createArtifact(sourcePath, 'mirror', artifactContent);
                    record = metadata;
                }
            }
        }

        if (record) {
            const content = await readFile(record.artifactPath);
            if (content !== null) {
                records.push({
                    metadata: record,
                    content
                });
            }
        }
    }

    return records;
}

/**
 * Saves a summary for a folder.
 */
export async function saveFolderSummary(folderPath: string, summary: string): Promise<ArtifactMetadata> {
    checkInitialized();

    const absFolderPath = path.isAbsolute(folderPath) ? folderPath : path.join(workspaceRoot, folderPath);
    const filePath = summaryFilePath(workspaceRoot, absFolderPath);

    const metadata: ArtifactMetadata = {
        id: crypto.randomUUID(),
        sourcePath: absFolderPath,
        artifactPath: filePath,
        type: 'folder_summary',
        createdAt: new Date().toISOString()
    };

    await writeFile(filePath, summary);
    index.addRecord(metadata);
    await index.save();

    return metadata;
}

/**
 * Saves multiple folder summaries at once.
 */
export async function saveModuleSummaries(summaries: Record<string, string>): Promise<ArtifactMetadata[]> {
    checkInitialized();

    const results: ArtifactMetadata[] = [];

    for (const [folderPath, content] of Object.entries(summaries)) {
        try {
            const metadata = await saveFolderSummary(folderPath, content);
            results.push(metadata);
        } catch (error) {
            console.error(`Failed to save summary for ${folderPath}:`, error);
        }
    }

    return results;
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
