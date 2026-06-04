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

    /**
     * Drop the cached `TypeScriptService` (and its built `ts.Program`) for
     * `workspaceRoot`, so the next `createExtractor` constructs a fresh service
     * that re-reads the current files. Called by the on-demand refresh after a
     * manifest diff detects edits — without this, a long-lived process keeps
     * serving the first-scan Program and never sees post-scan edits.
     */
    public invalidateCache(workspaceRoot: string): void {
        this.servicesByRoot.delete(workspaceRoot);
    }
}
