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
import { isSupportedFile } from './config';
import { LANGUAGES, CallGraphCapability } from './languages';

const log = createLogger('parser-registry');

/**
 * Reconciled support facts for a single file, combining the RUNTIME registry
 * (is a parser actually registered?) with the STATIC language descriptors
 * (is this a known source extension, which grammar package enables it, and
 * what call-graph capability does it have?).
 *
 * Computed Node-side and baked into the worktree payload so the browser UI can
 * render a true 3-state affordance (live toggle / needs-grammar marker / plain)
 * without ever importing the registry.
 */
export interface FileSupport {
    /** A parser is actually registered for this extension at runtime. */
    parsable: boolean;
    /** Call-graph capability declared for this language ('none' if unknown). */
    callGraph: CallGraphCapability;
    /**
     * Statically a known source extension but no runtime parser — the
     * tree-sitter grammar is missing and must be installed to analyze.
     */
    needsGrammar: boolean;
    /** NPM grammar package to install (from the language descriptor). */
    installHint?: string;
}

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

        // Register every language from the single-source-of-truth descriptor.
        //
        // Languages without a grammarPackage (TypeScript/JavaScript, which uses
        // the compiler API) register eagerly — a load() failure there is a hard
        // error worth surfacing. Languages WITH a grammarPackage go through the
        // optional path: a missing module (MODULE_NOT_FOUND / ERR_MODULE_NOT_FOUND)
        // is silently recorded in `missing`; any other error — i.e. the grammar
        // IS installed but failed to import — is surfaced as a warning so it does
        // not get hidden by the "not installed" path.
        for (const descriptor of LANGUAGES) {
            if (!descriptor.grammarPackage) {
                try {
                    const adapter = descriptor.load();
                    this.registerAdapter(adapter);
                    active.push(adapter.displayName);
                } catch (error) {
                    log.error(`Failed to load ${descriptor.displayName} adapter`, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                continue;
            }

            try {
                const adapter = descriptor.load();
                this.registerAdapter(adapter);
                active.push(adapter.displayName);
            } catch (error) {
                const err = error as NodeJS.ErrnoException;
                if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
                    missing.push(descriptor.grammarPackage);
                } else {
                    log.warn(`Failed to load ${descriptor.grammarPackage}: ${err?.message ?? String(error)}`);
                }
            }
        }

        let summary = `Languages active: ${active.join(', ')}.`;
        if (missing.length > 0) {
            summary += ` Optional: install ${missing.join(', ')} to enable more.`;
        }
        log.info(summary);

        // If any tree-sitter grammar registered (so a grammar package IS
        // present), probe the native core. A grammar without a working core
        // means every parse will throw at extractor-construction time, so warn
        // with an actionable hint rather than failing silently per-file later.
        // Probing is cheap and only runs when a grammar is actually present.
        const grammarActive = active.length > 1; // >1 means more than just TS/JS
        if (grammarActive) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('tree-sitter');
            } catch (error) {
                const err = error as NodeJS.ErrnoException;
                log.warn(
                    `tree-sitter grammar(s) are installed but the native core ` +
                    `failed to load (${err?.message ?? String(error)}). ` +
                    `Install build tools or a prebuilt binary for your Node ` +
                    `version and reinstall to enable these languages.`
                );
            }
        }
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
     * Reconcile static vs runtime support for a file.
     *
     * Fixes the "toggle-noop": a known source extension whose grammar is not
     * installed must NOT advertise a live watch toggle (it would silently do
     * nothing). `getSupport` returns `parsable: false, needsGrammar: true` for
     * such files so the UI can render a muted install hint instead.
     *
     * @param filePath File name or path (a bare basename works too)
     */
    public getSupport(filePath: string): FileSupport {
        const ext = path.extname(filePath).toLowerCase();
        const parsable = this.extensionMap.has(ext);
        const needsGrammar = !parsable && isSupportedFile(filePath);

        // Look up the language descriptor whose extensions include this ext.
        const descriptor = LANGUAGES.find(lang =>
            lang.extensions.some(e => e.toLowerCase() === ext)
        );

        return {
            parsable,
            callGraph: descriptor ? descriptor.callGraph : 'none',
            needsGrammar,
            installHint: descriptor?.grammarPackage,
        };
    }

    /**
     * Invalidate any per-workspace parser caches across all adapters.
     *
     * Adapters that cache workspace-scoped state (the TypeScript adapter holds
     * one `ts.Program` per root for scan performance) implement
     * `invalidateCache`; adapters without a cache omit it and are skipped. The
     * on-demand refresh (LS-06) calls this when its manifest diff detects new /
     * changed / deleted files, so the subsequent re-scan re-reads the current
     * source instead of a stale cached Program.
     *
     * @param workspaceRoot Absolute path to workspace root directory
     */
    public invalidateCaches(workspaceRoot: string): void {
        for (const adapter of this.adapters.values()) {
            adapter.invalidateCache?.(workspaceRoot);
        }
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
