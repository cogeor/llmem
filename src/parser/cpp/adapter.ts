/**
 * C/C++ Language Adapter
 *
 * Integrates C/C++ parser with LLMem's parser registry.
 * Uses tree-sitter-cpp for fast AST parsing.
 * 
 * Note: Only import extraction is supported (via #include).
 * Call graph is NOT available for C/C++ (TypeScript/JavaScript only).
 */

import { TreeSitterAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { CppExtractor } from './extractor';

/**
 * C/C++ language adapter
 *
 * Provides C/C++ parsing via tree-sitter grammar.
 * Supports: functions, classes, #include directives
 * Does NOT support: call graph extraction
 */
export class CppAdapter extends TreeSitterAdapter {
    readonly id = 'cpp';
    readonly displayName = 'C/C++';
    readonly extensions = ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx'] as const;
    readonly npmPackage = 'tree-sitter-cpp';
    readonly supportsAsync = false;
    readonly supportsClasses = true;

    protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
        return new CppExtractor(workspaceRoot);
    }
}
