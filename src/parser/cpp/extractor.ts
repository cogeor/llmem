/**
 * C/C++ Extractor
 *
 * Tree-sitter based C/C++ code analysis for import graph extraction.
 * Extracts:
 *   - #include directives (system and local headers)
 *   - Function and class definitions (entities only, no call extraction)
 *
 * Note: Call graph extraction is NOT supported for C/C++.
 * Only TypeScript/JavaScript support call graphs.
 *
 * Performance target: 10,000+ lines/sec
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser, { SyntaxNode } from 'tree-sitter';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, ImportSpec, ExportSpec, Loc, EntityKind } from '../types';

// Tree-sitter C++ grammar - require at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Cpp = require('tree-sitter-cpp');

export class CppExtractor implements ArtifactExtractor {
    private parser: Parser;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.parser = new Parser();
        this.parser.setLanguage(Cpp);
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        // Read file if content not provided
        const fileContent = content ?? fs.readFileSync(filePath, 'utf-8');

        // Parse with tree-sitter
        const tree = this.parser.parse(fileContent);
        const rootNode = tree.rootNode;

        // Calculate file ID (relative path)
        const fileId = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        // 1. Parse imports (#include directives)
        const imports = this.parseIncludes(rootNode);

        // 2. Extract entities (functions, classes) - NO calls for C++
        const entities = this.extractEntities(rootNode, fileContent);

        // 3. Determine exports (functions/classes in header files are considered exports)
        const exports = this.extractExports(entities, filePath);

        return {
            schemaVersion: 'cpp-ts-v1',
            file: {
                id: fileId,
                path: filePath,
                language: 'cpp'
            },
            imports,
            exports,
            entities
        };
    }

    /**
     * Parse #include directives.
     */
    private parseIncludes(rootNode: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];

        this.walkNode(rootNode, (node) => {
            if (node.type === 'preproc_include') {
                const spec = this.parseIncludeDirective(node);
                if (spec) {
                    imports.push(spec);
                }
            }
        });

        return imports;
    }

    /**
     * Parse a single #include directive.
     * Handles both:
     *   - #include <system/header.h>
     *   - #include "local/header.h"
     */
    private parseIncludeDirective(node: SyntaxNode): ImportSpec | null {
        // Find the path child (string_literal or system_lib_string)
        let source = '';
        let kind: 'system' | 'local' = 'local';

        for (const child of node.children) {
            if (child.type === 'string_literal') {
                // #include "local.h"
                source = child.text.slice(1, -1); // Remove quotes
                kind = 'local';
            } else if (child.type === 'system_lib_string') {
                // #include <system.h>
                source = child.text.slice(1, -1); // Remove angle brackets
                kind = 'system';
            }
        }

        if (!source) {
            return null;
        }

        return {
            kind: 'es',  // We use 'es' as a generic import kind
            source,
            resolvedPath: null, // Could be resolved based on include paths
            specifiers: [{ name: source }],
            loc: this.getLoc(node)
        };
    }

    /**
     * Extract function and class definitions (NO call extraction for C++).
     */
    private extractEntities(rootNode: SyntaxNode, fileContent: string): Entity[] {
        const entities: Entity[] = [];

        this.walkNode(rootNode, (node) => {
            if (node.type === 'function_definition') {
                const entity = this.extractFunctionEntity(node, fileContent);
                if (entity) {
                    entities.push(entity);
                }
            } else if (node.type === 'class_specifier') {
                const entity = this.extractClassEntity(node, fileContent);
                if (entity) {
                    entities.push(entity);
                }
            }
        });

        return entities;
    }

    /**
     * Extract a function entity.
     */
    private extractFunctionEntity(node: SyntaxNode, fileContent: string): Entity | null {
        // Find the declarator which contains the function name
        const declarator = node.childForFieldName('declarator');
        if (!declarator) return null;

        // Get function name
        const name = this.extractDeclaratorName(declarator);
        if (!name) return null;

        // Build signature from the first line
        const lines = fileContent.split('\n');
        const startLine = node.startPosition.row;
        let signature = lines[startLine]?.trim() || `function ${name}`;

        // Clean up signature (remove body start)
        const braceIndex = signature.indexOf('{');
        if (braceIndex > 0) {
            signature = signature.substring(0, braceIndex).trim();
        }

        return {
            id: `${name}-${startLine}`,
            kind: 'function',
            name,
            isExported: true, // Simplified: assume all are exported
            loc: this.getLoc(node),
            signature,
            calls: [] // NO call extraction for C++
        };
    }

    /**
     * Extract a class entity.
     */
    private extractClassEntity(node: SyntaxNode, fileContent: string): Entity | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;

        const name = nameNode.text;

        // Build signature
        let signature = `class ${name}`;

        return {
            id: `${name}-${node.startPosition.row}`,
            kind: 'class',
            name,
            isExported: true,
            loc: this.getLoc(node),
            signature,
            calls: [] // NO call extraction for C++
        };
    }

    /**
     * Extract the name from a declarator node.
     */
    private extractDeclaratorName(node: SyntaxNode): string | null {
        if (node.type === 'identifier') {
            return node.text;
        }

        // Look for identifier in children
        for (const child of node.children) {
            if (child.type === 'identifier') {
                return child.text;
            }
            // Recurse for nested declarators
            if (child.type === 'function_declarator' ||
                child.type === 'pointer_declarator' ||
                child.type === 'reference_declarator') {
                const name = this.extractDeclaratorName(child);
                if (name) return name;
            }
        }

        return null;
    }

    /**
     * Extract exports from entities.
     * In C++, header file functions/classes are considered exports.
     */
    private extractExports(entities: Entity[], filePath: string): ExportSpec[] {
        // For header files, all top-level definitions are exports
        const isHeader = filePath.endsWith('.h') ||
            filePath.endsWith('.hpp') ||
            filePath.endsWith('.hxx');

        if (!isHeader) {
            return [];
        }

        return entities
            .filter(e => e.kind === 'function' || e.kind === 'class')
            .map(e => ({
                type: 'named' as const,
                name: e.name,
                loc: e.loc
            }));
    }

    private walkNode(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
        callback(node);
        for (const child of node.children) {
            this.walkNode(child, callback);
        }
    }

    private getLoc(node: SyntaxNode): Loc {
        return {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            startByte: node.startIndex,
            endByte: node.endIndex
        };
    }
}
