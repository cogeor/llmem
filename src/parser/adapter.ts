/**
 * Language Adapter Pattern
 *
 * Standardized interface for integrating new programming languages into LLMem.
 * Each language implements a LanguageAdapter to provide parser creation and metadata.
 */

import { ArtifactExtractor } from './interfaces';

/**
 * Language adapter interface
 *
 * Every language must implement this interface to integrate with LLMem's
 * parser registry and graph generation system.
 */
export interface LanguageAdapter {
    /**
     * Unique language identifier (lowercase)
     * Examples: 'python', 'rust', 'cpp', 'go'
     */
    readonly id: string;

    /**
     * Human-readable language name
     * Examples: 'Python', 'Rust', 'C++', 'Go'
     */
    readonly displayName: string;

    /**
     * File extensions supported by this language (lowercase, with dot)
     * Examples: ['.py'], ['.rs'], ['.cpp', '.h']
     */
    readonly extensions: readonly string[];

    /**
     * Create a parser (extractor) instance for this language
     *
     * @param workspaceRoot Absolute path to workspace root directory
     * @returns ArtifactExtractor implementation for this language
     */
    createExtractor(workspaceRoot: string): ArtifactExtractor;

    /**
     * Optional: NPM package name for tree-sitter grammar
     * Used for documentation and dependency tracking
     * Examples: 'tree-sitter-python', 'tree-sitter-rust'
     */
    readonly npmPackage?: string;

    /**
     * Optional: Whether language supports async/await syntax
     * Used for parsing optimization and documentation
     */
    readonly supportsAsync?: boolean;

    /**
     * Optional: Whether language has class-based OOP
     * Used for entity extraction and graph visualization
     */
    readonly supportsClasses?: boolean;
}

/**
 * Base adapter for tree-sitter based parsers
 *
 * Provides common functionality for languages that use tree-sitter grammars.
 * Subclasses only need to implement createExtractorInstance().
 *
 * Example:
 * ```typescript
 * export class PythonAdapter extends TreeSitterAdapter {
 *     readonly id = 'python';
 *     readonly displayName = 'Python';
 *     readonly extensions = ['.py'] as const;
 *     readonly npmPackage = 'tree-sitter-python';
 *
 *     protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
 *         return new PythonExtractor(workspaceRoot);
 *     }
 * }
 * ```
 */
export abstract class TreeSitterAdapter implements LanguageAdapter {
    abstract readonly id: string;
    abstract readonly displayName: string;
    abstract readonly extensions: readonly string[];
    abstract readonly npmPackage: string;

    readonly supportsAsync?: boolean;
    readonly supportsClasses?: boolean;

    /**
     * Create extractor instance (subclass implements this)
     *
     * @param workspaceRoot Absolute path to workspace root
     * @returns Language-specific extractor
     */
    protected abstract createExtractorInstance(workspaceRoot: string): ArtifactExtractor;

    /**
     * Create extractor (public API, delegates to subclass)
     */
    public createExtractor(workspaceRoot: string): ArtifactExtractor {
        return this.createExtractorInstance(workspaceRoot);
    }
}
