import * as path from 'path';
import { getDocsRoot, getDesignDocKey } from '../docs/doc-store';
import { asWorkspaceRoot, asAbsPath, type WorkspaceRoot } from '../core/paths';
import { renderMarkdown } from './markdown-renderer';
import { createLogger } from '../common/logger';
import { WorkspaceIO } from '../workspace/workspace-io';
// Loop 08 (H1): single source of truth for the DesignDoc DTO lives in the
// browser-safe contracts module. Type-only import keeps this Node module's
// existing `export { DesignDoc }` surface intact for downstream consumers.
import type { DesignDoc } from '../contracts/webview-payloads';

const log = createLogger('design-doc-manager');

export type { DesignDoc };

/**
 * Load all design docs for a given project root.
 *
 * Loop 26: takes a `WorkspaceIO` instance so reads run through the
 * realpath-strong I/O surface. Constructs a `DesignDocManager` internally.
 */
export async function loadDesignDocs(
    projectRoot: string,
    io: WorkspaceIO,
): Promise<Record<string, DesignDoc>> {
    const manager = new DesignDocManager(asWorkspaceRoot(projectRoot), io);
    return await manager.getAllDocsAsync();
}

/**
 * Manages design documents, handling data conversion and retrieval.
 *
 * Loop 26: `WorkspaceIO` is now a constructor field. Every read in
 * `getAllDocsAsync` / `walk` flows through it (replaces fs.existsSync,
 * fs.readFileSync, fs.readdirSync — 3 sites).
 */
export class DesignDocManager {
    private workspaceRoot: WorkspaceRoot;
    private docsRoot: string;
    private docsRel: string;
    private io: WorkspaceIO;

    constructor(projectRoot: WorkspaceRoot | string, io: WorkspaceIO) {
        const branded = typeof projectRoot === 'string'
            ? asWorkspaceRoot(projectRoot)
            : projectRoot;
        this.workspaceRoot = branded;
        // .arch path mapping owned by src/docs/doc-store.ts (Loop 04).
        this.docsRoot = getDocsRoot(branded);
        this.docsRel = path.relative(branded, this.docsRoot).replace(/\\/g, '/');
        this.io = io;
    }

    /**
     * Retrieves all design documents as a map of relative path -> DesignDoc (markdown + HTML).
     */
    public getAllDocs(): Record<string, DesignDoc> {
        // Sync version not supported due to ESM dependency
        return {};
    }

    public async getAllDocsAsync(): Promise<Record<string, DesignDoc>> {
        log.debug('Starting getAllDocsAsync');
        // Loop 19: markdown rendering goes through the centralized
        // `renderMarkdown` helper, which owns the ESM dynamic-import shim
        // and the server-side DOMPurify pass.
        const docs: Record<string, DesignDoc> = {};

        log.debug('docsRoot resolved', { docsRoot: this.docsRoot });
        if (!(await this.io.exists(this.docsRel))) {
            log.debug('docsRoot does not exist');
            return docs;
        }

        const files: string[] = [];
        try {
            await this.walk(this.docsRel, (f) => files.push(f));
        } catch (e) {
            log.error('Error walking directory', {
                error: e instanceof Error ? e.message : String(e),
            });
        }
        log.debug('Found files in docsRoot', { count: files.length });

        for (const fileRel of files) {
            if (fileRel.endsWith('.md')) {
                try {
                    const markdown = await this.io.readFile(fileRel, 'utf-8');
                    const html = await renderMarkdown(markdown);

                    // Key mapping is owned by src/docs/doc-store.ts (Loop 04).
                    const absFilePath = path.join(this.workspaceRoot, fileRel);
                    const key = getDesignDocKey(asAbsPath(this.docsRoot), asAbsPath(absFilePath));
                    const relPath = path.relative(this.docsRoot, absFilePath).replace(/\\/g, '/');
                    log.debug('Processed design doc', { relPath, key });

                    // Store both markdown and HTML
                    docs[key] = { markdown, html };
                } catch (e) {
                    log.error('Failed to convert design doc', {
                        filePath: fileRel,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
        }

        return docs;
    }

    /**
     * Recursive walker via WorkspaceIO. `relDir` is workspace-relative.
     * Calls `callback(relPath)` for each file encountered.
     */
    private async walk(relDir: string, callback: (relPath: string) => void): Promise<void> {
        const entries = await this.io.readDir(relDir);
        for (const entry of entries) {
            const childRel = relDir === '' || relDir === '.'
                ? entry
                : `${relDir}/${entry}`;
            const stat = await this.io.stat(childRel);
            if (stat.isDirectory()) {
                await this.walk(childRel, callback);
            } else {
                callback(childRel);
            }
        }
    }
}
