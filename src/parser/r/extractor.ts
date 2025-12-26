/**
 * R Extractor
 *
 * Tree-sitter based R code analysis for import graph extraction.
 * Extracts:
 *   - library() calls (package imports)
 *   - require() calls
 *   - source() calls (file includes)
 *   - Function definitions (entities only, no call extraction)
 *
 * Note: Call graph extraction is NOT supported for R.
 * Only TypeScript/JavaScript support call graphs.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser, { SyntaxNode } from 'tree-sitter';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, ImportSpec, ExportSpec, Loc } from '../types';

// Tree-sitter R grammar - require at runtime
// Note: Using scoped package until tree-sitter-r is claimed
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require('@davisvaughan/tree-sitter-r');

export class RExtractor implements ArtifactExtractor {
    private parser: Parser;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.parser = new Parser();
        this.parser.setLanguage(R);
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        // Read file if content not provided
        const fileContent = content ?? fs.readFileSync(filePath, 'utf-8');

        // Parse with tree-sitter
        const tree = this.parser.parse(fileContent);
        const rootNode = tree.rootNode;

        // Calculate file ID (relative path)
        const fileId = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        // 1. Parse imports (library, require, source calls)
        const imports = this.parseImports(rootNode);

        // 2. Extract entities (function definitions) - NO calls for R
        const entities = this.extractEntities(rootNode, fileContent);

        // 3. Determine exports (top-level functions)
        const exports = this.extractExports(entities);

        return {
            schemaVersion: 'r-ts-v1',
            file: {
                id: fileId,
                path: filePath,
                language: 'r'
            },
            imports,
            exports,
            entities
        };
    }

    /**
     * Parse library(), require(), and source() calls.
     */
    private parseImports(rootNode: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];

        this.walkNode(rootNode, (node) => {
            if (node.type === 'call') {
                const spec = this.parseImportCall(node);
                if (spec) {
                    imports.push(spec);
                }
            }
        });

        return imports;
    }

    /**
     * Parse a single import call (library, require, source).
     */
    private parseImportCall(node: SyntaxNode): ImportSpec | null {
        // Get function name
        const funcNode = node.childForFieldName('function');
        if (!funcNode) return null;

        const funcName = funcNode.text;

        // Only handle library(), require(), and source()
        if (!['library', 'require', 'source'].includes(funcName)) {
            return null;
        }

        // Get arguments
        const argsNode = node.childForFieldName('arguments');
        if (!argsNode) return null;

        // Find the first argument (package/file name)
        let source = '';
        for (const child of argsNode.children) {
            if (child.type === 'argument') {
                const valueNode = child.childForFieldName('value');
                if (valueNode) {
                    source = this.extractStringValue(valueNode);
                    break;
                }
            } else if (child.type === 'identifier') {
                // library(dplyr) without quotes
                source = child.text;
                break;
            } else if (child.type === 'string') {
                source = this.extractStringValue(child);
                break;
            }
        }

        if (!source) {
            return null;
        }

        return {
            kind: 'es',
            source,
            resolvedPath: null,
            specifiers: [{ name: source }],
            loc: this.getLoc(node)
        };
    }

    /**
     * Extract string value from a string node.
     */
    private extractStringValue(node: SyntaxNode): string {
        const text = node.text;
        // Remove quotes (single or double)
        if ((text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("'") && text.endsWith("'"))) {
            return text.slice(1, -1);
        }
        return text;
    }

    /**
     * Extract function definitions (NO call extraction for R).
     */
    private extractEntities(rootNode: SyntaxNode, fileContent: string): Entity[] {
        const entities: Entity[] = [];

        this.walkNode(rootNode, (node) => {
            // R function definitions: name <- function(args) { ... }
            // or: name = function(args) { ... }
            if (node.type === 'left_assignment' || node.type === 'equals_assignment') {
                const entity = this.extractFunctionEntity(node, fileContent);
                if (entity) {
                    entities.push(entity);
                }
            }
        });

        return entities;
    }

    /**
     * Extract a function entity from an assignment.
     */
    private extractFunctionEntity(node: SyntaxNode, fileContent: string): Entity | null {
        // Get the left side (function name)
        const nameNode = node.childForFieldName('name') || node.children[0];
        if (!nameNode || nameNode.type !== 'identifier') return null;

        // Get the right side (should be a function)
        const valueNode = node.childForFieldName('value') || node.children[2];
        if (!valueNode || valueNode.type !== 'function_definition') return null;

        const name = nameNode.text;

        // Build signature
        const lines = fileContent.split('\n');
        const startLine = node.startPosition.row;
        let signature = lines[startLine]?.trim() || `${name} <- function()`;

        // Clean up signature (remove body)
        const braceIndex = signature.indexOf('{');
        if (braceIndex > 0) {
            signature = signature.substring(0, braceIndex).trim();
        }

        return {
            id: `${name}-${startLine}`,
            kind: 'function',
            name,
            isExported: !name.startsWith('.'), // In R, names starting with . are "private"
            loc: this.getLoc(node),
            signature,
            calls: [] // NO call extraction for R
        };
    }

    /**
     * Extract exports from entities.
     */
    private extractExports(entities: Entity[]): ExportSpec[] {
        return entities
            .filter(e => e.isExported)
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
