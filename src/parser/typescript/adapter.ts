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
     * One TypeScriptService per workspace root. `ts.createProgram(N files)`
     * is O(N) and scan loops call createExtractor() per file — without this
     * cache, scanning N files is O(N²). Keyed by realpath-equivalent string
     * so repeated calls with the same root reuse the same Program.
     */
    private readonly servicesByRoot = new Map<string, TypeScriptService>();

    public createExtractor(workspaceRoot: string): ArtifactExtractor {
        let tsService = this.servicesByRoot.get(workspaceRoot);
        if (!tsService) {
            tsService = new TypeScriptService(workspaceRoot);
            this.servicesByRoot.set(workspaceRoot, tsService);
        }
        return new TypeScriptExtractor(() => tsService!.getProgram(), workspaceRoot);
    }
}
