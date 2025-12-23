import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { ArtifactMetadata, ArtifactRecord, ArtifactTree } from './types';
import { ArtifactIndex } from './index';
import { ArtifactTreeManager } from './tree';
import { artifactFilePath, sourceToArtifactDir, summaryFilePath } from './path-mapper';
import { readFile, writeFile, deleteFile, exists } from './storage';

import { TypeScriptService, TypeScriptExtractor, ExtractorRegistry } from '../parser';
import { detectAvailableLanguages } from '../parser/languages';
import { LspExtractor } from '../parser/lsp/extractor';

let index: ArtifactIndex;
let tree: ArtifactTreeManager;
let workspaceRoot: string;
let isInitialized = false;
let registry: ExtractorRegistry;
let tsService: TypeScriptService;
let tsExtractor: TypeScriptExtractor;
let gitignorePatterns: Set<string>;

// Always ignored folders
const ALWAYS_IGNORED = new Set([
    'node_modules',
    '.git',
    '.artifacts',
    '.vscode',
    'dist',
    'out',
    '.DS_Store'
]);

/**
 * Parse .gitignore and return a set of patterns.
 */
function parseGitignore(rootPath: string): Set<string> {
    const patterns = new Set<string>();
    const gitignorePath = path.join(rootPath, '.gitignore');

    try {
        if (fsSync.existsSync(gitignorePath)) {
            const content = fsSync.readFileSync(gitignorePath, 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                let pattern = trimmed.replace(/\/$/, '');
                if (pattern.startsWith('!')) continue;
                patterns.add(pattern);
            }
        }
    } catch (e) {
        console.warn('Failed to parse .gitignore:', e);
    }

    return patterns;
}

/**
 * Check if a path should be ignored.
 */
function shouldIgnore(name: string, relativePath: string): boolean {
    if (ALWAYS_IGNORED.has(name)) return true;

    // Skip problematic file extensions that can cause issues (like Electron .asar archives)
    const SKIP_EXTENSIONS = ['.asar', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm'];
    const ext = path.extname(name).toLowerCase();
    if (SKIP_EXTENSIONS.includes(ext)) return true;

    for (const pattern of gitignorePatterns) {
        if (pattern === name) return true;
        if (relativePath === pattern || relativePath.startsWith(pattern + '/')) return true;
        if (pattern.startsWith('*.')) {
            const extPattern = pattern.slice(1);
            if (name.endsWith(extPattern)) return true;
        }
    }

    return false;
}

export async function initializeArtifactService(root: string) {
    // Already initialized for this workspace - no-op
    if (isInitialized && workspaceRoot === root) {
        console.error('[ArtifactService] Already initialized for this workspace');
        return;
    }

    // Switching workspaces - reinitialize
    if (isInitialized && workspaceRoot !== root) {
        console.error(`[ArtifactService] Switching workspace from ${workspaceRoot} to ${root}`);
        isInitialized = false;
    }

    workspaceRoot = root;
    index = new ArtifactIndex(workspaceRoot);
    tree = new ArtifactTreeManager();

    // Parse .gitignore
    gitignorePatterns = parseGitignore(root);

    // Initialize TS Service
    tsService = new TypeScriptService(workspaceRoot);
    tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), workspaceRoot);

    // Initialize Registry
    registry = new ExtractorRegistry();
    registry.register('.ts', tsExtractor);
    registry.register('.tsx', tsExtractor);

    // Dynamic Language Detection & Registration
    const availableLangs = await detectAvailableLanguages();
    for (const lang of availableLangs) {
        if (lang.id === 'python' || lang.id === 'cpp' || lang.id === 'r' || lang.id === 'dart' || lang.id === 'rust') {
            const lspExtractor = new LspExtractor(lang.lspCommand, lang.lspArgs, lang.id);
            // We should start the LSP? Or start on demand?
            // Starting process for every language might be heavy. Let's start it lazily in extractor.extract()
            // The LspExtractor implementation already does start() lazily or we can rely on it.
            // But we need to register extensions.
            for (const ext of lang.extensions) {
                registry.register(ext, lspExtractor);
            }
            console.error(`Registered LSP support for ${lang.id} (${lang.extensions.join(', ')})`);
        }
    }

    await index.load();
    tree.build(index.getAll());
    isInitialized = true;
}

export function getWorkspaceRoot(): string {
    checkInitialized();
    return workspaceRoot;
}

export function getSupportedExtensions(): string[] {
    // Return default extensions if not initialized (for hot reload before full init)
    if (!isInitialized) {
        return ['.ts', '.tsx', '.js', '.jsx'];
    }
    return registry.getSupportedExtensions();
}

function checkInitialized() {
    if (!isInitialized) {
        throw new Error('Artifact service not initialized. Call initializeArtifactService() first.');
    }
}

/**
 * Check if the artifact service is initialized.
 * Used for lazy initialization pattern.
 */
export function isArtifactServiceInitialized(): boolean {
    return isInitialized;
}

export async function createArtifact(sourcePath: string, type: string, content: string): Promise<ArtifactMetadata> {
    // DISABLED: Artifact system deprecated, using edge list
    console.error('[ArtifactService] createArtifact disabled - using edge list instead');

    // Return dummy metadata without writing any files
    return {
        id: crypto.randomUUID(),
        sourcePath: sourcePath,
        artifactPath: '',
        type: type,
        createdAt: new Date().toISOString()
    };
}

/**
 * Ensures that a single file has a corresponding mirror artifact.
 * Used by hot reload for incremental updates.
 */
export async function ensureSingleFileArtifact(filePath: string): Promise<ArtifactRecord | null> {
    // DISABLED: Legacy artifact system deprecated, using edge list instead
    console.error('[ArtifactService] ensureSingleFileArtifact disabled - using edge list');
    return null;

    /* Legacy code preserved for future lazy loading:
    checkInitialized();

    // Normalize to relative path
    const sourcePath = path.isAbsolute(filePath)
        ? path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
        : filePath.replace(/\\/g, '/');

    const fullPath = path.join(workspaceRoot, sourcePath);

    // Check if should be ignored
    const fileName = path.basename(sourcePath);
    if (shouldIgnore(fileName, sourcePath)) {
        return null;
    }

    // Check if file exists
    if (!await exists(fullPath)) {
        // File was deleted, remove artifact if exists
        const all = index.getAll();
        const existing = all.find(r => r.sourcePath === sourcePath && r.type === 'mirror');
        if (existing) {
            await deleteFile(existing.artifactPath);
            index.removeRecord(existing.id);
            await index.save();
        }
        return null;
    }

    // Generate or update artifact
    const content = await readFile(fullPath);
    if (content === null) return null;

    const extractor = registry.get(fullPath);
    if (!extractor) return null;

    const artifact = await extractor.extract(fullPath);
    if (!artifact) return null;

    const artifactContent = JSON.stringify(artifact, null, 2);

    // Check if already exists and update, or create new
    const all = index.getAll();
    let record = all.find(r => r.sourcePath === sourcePath && r.type === 'mirror');

    if (record) {
        // Update existing
        await writeFile(record.artifactPath, artifactContent);
    } else {
        // Create new
        record = await createArtifact(sourcePath, 'mirror', artifactContent);
    }

    const finalContent = await readFile(record.artifactPath);
    if (finalContent === null) return null;

    return {
        metadata: record,
        content: finalContent
    };
    */
}

/**
 * Ensures that all files in the given folder have corresponding mirror artifacts.
 * Respects .gitignore and always-ignored folders.
 * Returns the list of artifacts (content + metadata) for the folder.
 */
export async function ensureArtifacts(folderPath: string, recursive: boolean = false): Promise<ArtifactRecord[]> {
    // DISABLED: Legacy artifact system deprecated, using edge list instead
    console.error('[ArtifactService] ensureArtifacts disabled - using edge list');
    return [];

    /* Legacy code preserved for future lazy loading:
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
        const sourcePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');

        // Check if should be ignored
        if (shouldIgnore(entry.name, sourcePath)) {
            continue;
        }

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
        if (!record) {
            // Generate it
            const content = await readFile(fullPath);
            if (content !== null) {
                let artifactContent: string | null = null;

                // Find appropriate extractor
                const extractor = registry.get(fullPath);

                if (extractor) {
                    const artifact = await extractor.extract(fullPath);
                    if (artifact) {
                        artifactContent = JSON.stringify(artifact, null, 2);
                    }
                }

                if (artifactContent) {
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
    */
}

/**
 * Saves a summary for a folder.
 */
export async function saveFolderSummary(folderPath: string, summary: string): Promise<ArtifactMetadata> {
    // DISABLED: Legacy artifact system deprecated, using edge list instead
    console.error('[ArtifactService] saveFolderSummary disabled - using edge list');
    return {
        id: '',
        sourcePath: folderPath,
        artifactPath: '',
        type: 'folder_summary',
        createdAt: new Date().toISOString()
    };

    /* Legacy code preserved for future lazy loading:
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
    */
}

/**
 * Saves multiple folder summaries at once.
 */
export async function saveModuleSummaries(summaries: Record<string, string>): Promise<ArtifactMetadata[]> {
    // DISABLED: Legacy artifact system deprecated, using edge list instead
    console.error('[ArtifactService] saveModuleSummaries disabled - using edge list');
    return [];

    /* Legacy code preserved for future lazy loading:
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
    */
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
