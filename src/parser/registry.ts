/**
 * Parser Registry
 *
 * Central registry for language parsers using the adapter pattern.
 * Maps file extensions to language adapters and creates parsers on demand.
 */

import * as path from 'path';
import { LanguageAdapter } from './adapter';
import { ArtifactExtractor } from './interfaces';
import { createLogger } from '../common/logger';

const log = createLogger('parser-registry');

/**
 * Singleton registry for language parsers
 *
 * Manages all supported languages and routes files to appropriate parsers.
 * Languages are registered via adapters, making it easy to add new languages.
 */
export class ParserRegistry {
    private static instance: ParserRegistry;

    /** Map of language ID → adapter */
    private adapters = new Map<string, LanguageAdapter>();

    /** Map of file extension (lowercase) → adapter */
    private extensionMap = new Map<string, LanguageAdapter>();

    /**
     * Private constructor - use getInstance()
     * Auto-registers all built-in language adapters
     */
    private constructor() {
        const active: string[] = [];
        const missing: string[] = [];

        // TypeScript/JavaScript (always available - uses compiler API)
        // This is the ONLY language with call graph support
        try {
            const { TypeScriptAdapter } = require('./typescript/adapter');
            const adapter: LanguageAdapter = new TypeScriptAdapter();
            this.registerAdapter(adapter);
            active.push(adapter.displayName);
        } catch (error) {
            log.error('Failed to load TypeScript adapter', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        // Helper: try to load an optional tree-sitter grammar.
        // Missing modules (MODULE_NOT_FOUND / ERR_MODULE_NOT_FOUND) are silently
        // recorded in `missing`. Any other error - i.e. the grammar IS installed
        // but failed to import - is surfaced as a warning so it doesn't get
        // hidden by the "not installed" path.
        const tryRegisterOptional = (pkg: string, load: () => LanguageAdapter): void => {
            try {
                const adapter = load();
                this.registerAdapter(adapter);
                active.push(adapter.displayName);
            } catch (error) {
                const err = error as NodeJS.ErrnoException;
                if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
                    missing.push(pkg);
                } else {
                    log.warn(`Failed to load ${pkg}: ${err?.message ?? String(error)}`);
                }
            }
        };

        // Python (tree-sitter based - imports only, no call graph)
        tryRegisterOptional('tree-sitter-python', () => {
            require('tree-sitter-python');
            const { PythonAdapter } = require('./python/adapter');
            return new PythonAdapter();
        });

        // C/C++ (tree-sitter based - imports only via #include)
        tryRegisterOptional('tree-sitter-cpp', () => {
            require('tree-sitter-cpp');
            const { CppAdapter } = require('./cpp/adapter');
            return new CppAdapter();
        });

        // Rust (tree-sitter based - imports only via use statements)
        tryRegisterOptional('tree-sitter-rust', () => {
            require('tree-sitter-rust');
            const { RustAdapter } = require('./rust/adapter');
            return new RustAdapter();
        });

        // R (tree-sitter based - imports only via library/require/source)
        tryRegisterOptional('@davisvaughan/tree-sitter-r', () => {
            require('@davisvaughan/tree-sitter-r');
            const { RAdapter } = require('./r/adapter');
            return new RAdapter();
        });

        let summary = `Languages active: ${active.join(', ')}.`;
        if (missing.length > 0) {
            summary += ` Optional: install ${missing.join(', ')} to enable more.`;
        }
        log.info(summary);
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ParserRegistry {
        if (!ParserRegistry.instance) {
            ParserRegistry.instance = new ParserRegistry();
        }
        return ParserRegistry.instance;
    }

    /**
     * Register a language adapter
     *
     * @param adapter Language adapter to register
     * @throws Error if language ID or extension is already registered
     */
    public registerAdapter(adapter: LanguageAdapter): void {
        // Check for duplicate language ID
        if (this.adapters.has(adapter.id)) {
            throw new Error(`Language adapter already registered: ${adapter.id}`);
        }

        // Register adapter by ID
        this.adapters.set(adapter.id, adapter);

        // Map all extensions to this adapter
        for (const ext of adapter.extensions) {
            const normalizedExt = ext.toLowerCase();

            if (this.extensionMap.has(normalizedExt)) {
                const existing = this.extensionMap.get(normalizedExt)!;
                throw new Error(
                    `Extension ${ext} already registered by ${existing.id}, ` +
                    `cannot register for ${adapter.id}`
                );
            }

            this.extensionMap.set(normalizedExt, adapter);
        }

        log.info(`Registered ${adapter.displayName} (${adapter.id})`, {
            extensions: adapter.extensions.join(', '),
        });
    }

    /**
     * Get parser for a file
     *
     * @param filePath Path to file (absolute or relative)
     * @param workspaceRoot Workspace root directory
     * @returns Parser instance or null if file type not supported
     */
    public getParser(filePath: string, workspaceRoot: string): ArtifactExtractor | null {
        const ext = path.extname(filePath).toLowerCase();
        const adapter = this.extensionMap.get(ext);

        if (!adapter) {
            return null;
        }

        return adapter.createExtractor(workspaceRoot);
    }

    /**
     * Get language ID for a file
     *
     * @param filePath Path to file
     * @returns Language ID (e.g., 'python', 'typescript') or null if not supported
     */
    public getLanguageId(filePath: string): string | null {
        const ext = path.extname(filePath).toLowerCase();
        const adapter = this.extensionMap.get(ext);
        return adapter ? adapter.id : null;
    }

    /**
     * Get language adapter by ID
     *
     * @param languageId Language identifier
     * @returns Language adapter or undefined if not found
     */
    public getAdapter(languageId: string): LanguageAdapter | undefined {
        return this.adapters.get(languageId);
    }

    /**
     * Check if file type is supported
     *
     * @param filePath Path to file
     * @returns True if a parser is available for this file type
     */
    public isSupported(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return this.extensionMap.has(ext);
    }

    /**
     * Get all registered adapters
     *
     * @returns Array of all language adapters
     */
    public getAllAdapters(): LanguageAdapter[] {
        return Array.from(this.adapters.values());
    }

    /**
     * Get all supported extensions
     *
     * @returns Array of file extensions (lowercase, with dot)
     */
    public getSupportedExtensions(): string[] {
        return Array.from(this.extensionMap.keys());
    }

    /**
     * Get language statistics for debugging
     */
    public getStats(): {
        languageCount: number;
        extensionCount: number;
        languages: Array<{
            id: string;
            displayName: string;
            extensions: readonly string[];
            npmPackage?: string;
        }>;
    } {
        return {
            languageCount: this.adapters.size,
            extensionCount: this.extensionMap.size,
            languages: this.getAllAdapters().map(a => ({
                id: a.id,
                displayName: a.displayName,
                extensions: a.extensions,
                npmPackage: a.npmPackage,
            })),
        };
    }
}
