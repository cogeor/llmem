/**
 * Rust Language Adapter
 *
 * Integrates Rust parser with LLMem's parser registry.
 * Uses tree-sitter-rust for fast AST parsing.
 * 
 * Note: Only import extraction is supported (via use statements).
 * Call graph is NOT available for Rust (TypeScript/JavaScript only).
 */

import { TreeSitterAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { RustExtractor } from './extractor';

/**
 * Rust language adapter
 *
 * Provides Rust parsing via tree-sitter grammar.
 * Supports: functions, structs, impl methods, use statements
 * Does NOT support: call graph extraction
 */
export class RustAdapter extends TreeSitterAdapter {
    readonly id = 'rust';
    readonly displayName = 'Rust';
    readonly extensions = ['.rs'] as const;
    readonly npmPackage = 'tree-sitter-rust';
    readonly supportsAsync = true;
    readonly supportsClasses = true; // structs + impls

    protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
        return new RustExtractor(workspaceRoot);
    }
}
