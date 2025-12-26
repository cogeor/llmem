/**
 * Python Language Adapter
 *
 * Integrates Python parser with LLMem's parser registry.
 * Uses tree-sitter-python for fast AST parsing.
 */

import { TreeSitterAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { PythonExtractor } from './extractor';

/**
 * Python language adapter
 *
 * Provides Python parsing via tree-sitter grammar.
 * Supports: functions, classes, methods, imports, async/await, decorators
 */
export class PythonAdapter extends TreeSitterAdapter {
    readonly id = 'python';
    readonly displayName = 'Python';
    readonly extensions = ['.py'] as const;
    readonly npmPackage = 'tree-sitter-python';
    readonly supportsAsync = true;
    readonly supportsClasses = true;

    protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
        return new PythonExtractor(workspaceRoot);
    }
}
