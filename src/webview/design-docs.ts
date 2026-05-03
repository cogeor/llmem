import * as fs from 'fs';
import * as path from 'path';
import { getArchRoot, getDesignDocKey } from '../docs/arch-store';
import { asWorkspaceRoot, asAbsPath } from '../core/paths';
import { renderMarkdown } from './markdown-renderer';
import { createLogger } from '../common/logger';

const log = createLogger('design-doc-manager');

/**
 * Design document with both markdown source and rendered HTML
 */
export interface DesignDoc {
    markdown: string;
    html: string;
}

/**
 * Load all design docs for a given project root
 * Convenience function for generator and data service
 */
export async function loadDesignDocs(projectRoot: string): Promise<Record<string, DesignDoc>> {
    const manager = new DesignDocManager(projectRoot);
    return await manager.getAllDocsAsync();
}

/**
 * Manages design documents, handling data conversion and retrieval.
 */
export class DesignDocManager {
    private archRoot: string;

    constructor(projectRoot: string) {
        // .arch path mapping owned by src/docs/arch-store.ts (Loop 04).
        this.archRoot = getArchRoot(asWorkspaceRoot(projectRoot));
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

        log.debug('archRoot resolved', { archRoot: this.archRoot });
        if (!fs.existsSync(this.archRoot)) {
            log.debug('archRoot does not exist');
            return docs;
        }

        const files: string[] = [];
        try {
            this.walk(this.archRoot, (f) => files.push(f));
        } catch (e) {
            log.error('Error walking directory', {
                error: e instanceof Error ? e.message : String(e),
            });
        }
        log.debug('Found files in archRoot', { count: files.length });

        for (const filePath of files) {
            if (filePath.endsWith('.md')) {
                try {
                    const markdown = fs.readFileSync(filePath, 'utf-8');
                    const html = await renderMarkdown(markdown);

                    // Key mapping is owned by src/docs/arch-store.ts (Loop 04).
                    const key = getDesignDocKey(asAbsPath(this.archRoot), asAbsPath(filePath));
                    const relPath = path.relative(this.archRoot, filePath).replace(/\\/g, '/');
                    log.debug('Processed design doc', { relPath, key });

                    // Store both markdown and HTML
                    docs[key] = { markdown, html };
                } catch (e) {
                    log.error('Failed to convert design doc', {
                        filePath,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }
        }

        return docs;
    }

    private walk(dir: string, callback: (path: string) => void) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.walk(fullPath, callback);
            } else {
                // console.log('[DesignDocManager] Found file:', fullPath);
                callback(fullPath);
            }
        }
    }
}
