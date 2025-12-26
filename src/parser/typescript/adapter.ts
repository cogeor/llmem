/**
 * TypeScript/JavaScript Language Adapter
 *
 * Integrates TypeScript parser with LLMem's parser registry.
 * Uses TypeScript Compiler API for semantic analysis.
 */

import { LanguageAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { TypeScriptService } from '../ts-service';
import { TypeScriptExtractor } from '../ts-extractor';

/**
 * TypeScript/JavaScript language adapter
 *
 * Uses TypeScript Compiler API (not tree-sitter) for full semantic analysis.
 * Supports: TypeScript, JavaScript, JSX, TSX
 */
export class TypeScriptAdapter implements LanguageAdapter {
    readonly id = 'typescript';
    readonly displayName = 'TypeScript/JavaScript';
    readonly extensions = ['.ts', '.tsx', '.js', '.jsx'] as const;
    readonly supportsAsync = true;
    readonly supportsClasses = true;

    // TypeScript uses compiler API, not tree-sitter
    readonly npmPackage = undefined;

    /**
     * Create TypeScript extractor
     *
     * Note: TypeScript extractor requires a TypeScript service instance
     * that compiles the entire project. This is shared across all files.
     */
    public createExtractor(workspaceRoot: string): ArtifactExtractor {
        const tsService = new TypeScriptService(workspaceRoot);
        return new TypeScriptExtractor(() => tsService.getProgram(), workspaceRoot);
    }
}
