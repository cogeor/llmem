/**
 * Parser Registry
 *
 * Central registry for language parsers using the adapter pattern.
 * Maps file extensions to language adapters and creates parsers on demand.
 */

import * as path from 'path';
import { LanguageAdapter } from './adapter';
import { ArtifactExtractor } from './interfaces';

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
        console.error('[ParserRegistry] Initializing language parsers...');

        // TypeScript/JavaScript (always available - uses compiler API)
        // This is the ONLY language with call graph support
        try {
            const { TypeScriptAdapter } = require('./typescript/adapter');
            this.registerAdapter(new TypeScriptAdapter());
        } catch (error) {
            console.error('[ParserRegistry] Failed to load TypeScript adapter:', error);
        }

        // Python (tree-sitter based - imports only, no call graph)
        try {
            require('tree-sitter-python');
            const { PythonAdapter } = require('./python/adapter');
            this.registerAdapter(new PythonAdapter());
        } catch (error) {
            console.error('[ParserRegistry] Python parser not available (tree-sitter-python not installed)');
        }

        // C/C++ (tree-sitter based - imports only via #include)
        try {
            require('tree-sitter-cpp');
            const { CppAdapter } = require('./cpp/adapter');
            this.registerAdapter(new CppAdapter());
        } catch (error) {
            console.error('[ParserRegistry] C/C++ parser not available (tree-sitter-cpp not installed)');
        }

        // Rust (tree-sitter based - imports only via use statements)
        try {
            require('tree-sitter-rust');
            const { RustAdapter } = require('./rust/adapter');
            this.registerAdapter(new RustAdapter());
        } catch (error) {
            console.error('[ParserRegistry] Rust parser not available (tree-sitter-rust not installed)');
        }

        // R (tree-sitter based - imports only via library/require/source)
        try {
            require('@davisvaughan/tree-sitter-r');
            const { RAdapter } = require('./r/adapter');
            this.registerAdapter(new RAdapter());
        } catch (error) {
            console.error('[ParserRegistry] R parser not available (@davisvaughan/tree-sitter-r not installed)');
        }

        console.error('[ParserRegistry] Initialization complete');
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

        console.error(`[ParserRegistry] Registered ${adapter.displayName} (${adapter.id}) for extensions: ${adapter.extensions.join(', ')}`);
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
