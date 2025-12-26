/**
 * R Language Adapter
 *
 * Integrates R parser with LLMem's parser registry.
 * Uses tree-sitter-r for fast AST parsing.
 * 
 * Note: Only import extraction is supported (via library/require/source).
 * Call graph is NOT available for R (TypeScript/JavaScript only).
 */

import { TreeSitterAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { RExtractor } from './extractor';

/**
 * R language adapter
 *
 * Provides R parsing via tree-sitter grammar.
 * Supports: functions, library(), require(), source()
 * Does NOT support: call graph extraction
 */
export class RAdapter extends TreeSitterAdapter {
    readonly id = 'r';
    readonly displayName = 'R';
    readonly extensions = ['.r', '.R'] as const;
    readonly npmPackage = '@davisvaughan/tree-sitter-r';
    readonly supportsAsync = false;
    readonly supportsClasses = false;

    protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
        return new RExtractor(workspaceRoot);
    }
}
