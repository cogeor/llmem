import * as fs from 'fs';
import * as path from 'path';

/**
 * Manages design documents, handling data conversion and retrieval.
 */
export class DesignDocManager {
    private archRoot: string;

    constructor(projectRoot: string) {
        // Assume .arch is at the project root
        this.archRoot = path.join(projectRoot, '.arch');
    }

    /**
     * Retrieves all design documents as a map of relative path -> HTML content.
     */
    public getAllDocs(): Record<string, string> {
        // Sync version not supported due to ESM dependency
        return {};
    }

    public async getAllDocsAsync(): Promise<Record<string, string>> {
        console.log('[DesignDocManager] Starting getAllDocsAsync');
        // Dynamic import for ESM module support in CommonJS
        // TSC compiles import() to require() when module is commonjs, which fails for ESM-only packages like marked.
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        let marked: any;
        try {
            const module = await dynamicImport('marked');
            marked = module.marked;
            console.log('[DesignDocManager] marked imported successfully');
        } catch (e) {
            console.error('[DesignDocManager] Failed to import marked:', e);
            return {};
        }

        const docs: Record<string, string> = {};

        console.log(`[DesignDocManager] archRoot: ${this.archRoot}`);
        if (!fs.existsSync(this.archRoot)) {
            console.log('[DesignDocManager] archRoot does not exist');
            return docs;
        }

        const files: string[] = [];
        try {
            this.walk(this.archRoot, (f) => files.push(f));
        } catch (e) {
            console.error('[DesignDocManager] Error walking directory:', e);
        }
        console.log(`[DesignDocManager] Found ${files.length} files in archRoot`);

        for (const filePath of files) {
            if (filePath.endsWith('.md')) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const html = await marked.parse(content);

                    // Key mapping:
                    // .arch/src/parser.md -> src/parser
                    // User said: "design file for src/parser folder will be in .arch/src/parser.md"
                    // The UI likely expects keys to match code paths.

                    const relPath = path.relative(this.archRoot, filePath).replace(/\\/g, '/');
                    // Frontend expects .html keys
                    const key = relPath.replace(/\.md$/, '.html');

                    console.log(`[DesignDocManager] Processed: ${relPath} -> ${key}`);

                    docs[key] = html;
                } catch (e) {
                    console.error(`Failed to convert design doc: ${filePath}`, e);
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
                callback(fullPath);
            }
        }
    }
}
