/**
 * Rust Extractor
 *
 * Tree-sitter based Rust code analysis for import graph extraction.
 * Extracts:
 *   - use statements (crate imports)
 *   - mod declarations
 *   - Function and struct definitions (entities only, no call extraction)
 *
 * Note: Call graph extraction is NOT supported for Rust.
 * Only TypeScript/JavaScript support call graphs.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser, { SyntaxNode } from 'tree-sitter';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, ImportSpec, ExportSpec, Loc, EntityKind } from '../types';

// Tree-sitter Rust grammar - require at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Rust = require('tree-sitter-rust');

export class RustExtractor implements ArtifactExtractor {
    private parser: Parser;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.parser = new Parser();
        this.parser.setLanguage(Rust);
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        // Read file if content not provided
        const fileContent = content ?? fs.readFileSync(filePath, 'utf-8');

        // Parse with tree-sitter
        const tree = this.parser.parse(fileContent);
        const rootNode = tree.rootNode;

        // Calculate file ID (relative path)
        const fileId = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        // 1. Parse imports (use statements)
        const imports = this.parseUseStatements(rootNode);

        // 2. Extract entities (functions, structs, impls) - NO calls for Rust
        const entities = this.extractEntities(rootNode, fileContent);

        // 3. Determine exports (pub items)
        const exports = this.extractExports(entities);

        return {
            schemaVersion: 'rust-ts-v1',
            file: {
                id: fileId,
                path: filePath,
                language: 'rust'
            },
            imports,
            exports,
            entities
        };
    }

    /**
     * Parse use statements.
     */
    private parseUseStatements(rootNode: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];

        this.walkNode(rootNode, (node) => {
            if (node.type === 'use_declaration') {
                const spec = this.parseUseDeclaration(node);
                if (spec) {
                    imports.push(spec);
                }
            }
        });

        return imports;
    }

    /**
     * Parse a single use declaration.
     * Handles:
     *   - use std::io;
     *   - use std::io::{Read, Write};
     *   - use crate::module::Type;
     */
    private parseUseDeclaration(node: SyntaxNode): ImportSpec | null {
        // Get the use path
        let source = '';
        const specifiers: Array<{ name: string; alias?: string }> = [];

        // Find scoped_identifier or use_list
        for (const child of node.children) {
            if (child.type === 'scoped_identifier' || child.type === 'identifier') {
                source = child.text;
                const parts = source.split('::');
                specifiers.push({ name: parts[parts.length - 1] });
            } else if (child.type === 'use_list') {
                // Handle: use std::io::{Read, Write};
                const parentPath = this.findUsePath(node);
                source = parentPath;

                for (const item of child.children) {
                    if (item.type === 'identifier') {
                        specifiers.push({ name: item.text });
                    } else if (item.type === 'scoped_identifier') {
                        specifiers.push({ name: item.text });
                    } else if (item.type === 'use_as_clause') {
                        const name = item.children.find(c => c.type === 'identifier')?.text;
                        const alias = item.children.find(c => c.type === 'identifier' && c !== item.children[0])?.text;
                        if (name) {
                            specifiers.push({ name, alias });
                        }
                    }
                }
            } else if (child.type === 'use_wildcard') {
                // use std::io::*;
                source = this.findUsePath(node);
                specifiers.push({ name: '*' });
            }
        }

        if (!source) {
            return null;
        }

        return {
            kind: 'es',
            source,
            resolvedPath: null,
            specifiers: specifiers.length > 0 ? specifiers : [{ name: source }],
            loc: this.getLoc(node)
        };
    }

    /**
     * Find the path portion of a use statement.
     */
    private findUsePath(node: SyntaxNode): string {
        for (const child of node.children) {
            if (child.type === 'scoped_identifier') {
                return child.text;
            } else if (child.type === 'identifier') {
                return child.text;
            }
        }
        return '';
    }

    /**
     * Extract function and struct definitions (NO call extraction for Rust).
     */
    private extractEntities(rootNode: SyntaxNode, fileContent: string): Entity[] {
        const entities: Entity[] = [];

        this.walkNode(rootNode, (node) => {
            if (node.type === 'function_item') {
                const entity = this.extractFunctionEntity(node, fileContent);
                if (entity) {
                    entities.push(entity);
                }
            } else if (node.type === 'struct_item') {
                const entity = this.extractStructEntity(node, fileContent);
                if (entity) {
                    entities.push(entity);
                }
            } else if (node.type === 'impl_item') {
                // Extract methods from impl blocks
                const implEntities = this.extractImplMethods(node, fileContent);
                entities.push(...implEntities);
            }
        });

        return entities;
    }

    /**
     * Extract a function entity.
     */
    private extractFunctionEntity(node: SyntaxNode, fileContent: string): Entity | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;

        const name = nameNode.text;

        // Check if public
        const isExported = node.children.some(c => c.type === 'visibility_modifier');

        // Build signature
        const lines = fileContent.split('\n');
        const startLine = node.startPosition.row;
        let signature = lines[startLine]?.trim() || `fn ${name}`;

        // Clean up signature
        const braceIndex = signature.indexOf('{');
        if (braceIndex > 0) {
            signature = signature.substring(0, braceIndex).trim();
        }

        return {
            id: `${name}-${startLine}`,
            kind: 'function',
            name,
            isExported,
            loc: this.getLoc(node),
            signature,
            calls: [] // NO call extraction for Rust
        };
    }

    /**
     * Extract a struct entity.
     */
    private extractStructEntity(node: SyntaxNode, fileContent: string): Entity | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;

        const name = nameNode.text;
        const isExported = node.children.some(c => c.type === 'visibility_modifier');

        return {
            id: `${name}-${node.startPosition.row}`,
            kind: 'class', // Use 'class' for structs (closest match)
            name,
            isExported,
            loc: this.getLoc(node),
            signature: `struct ${name}`,
            calls: [] // NO call extraction for Rust
        };
    }

    /**
     * Extract methods from an impl block.
     */
    private extractImplMethods(node: SyntaxNode, fileContent: string): Entity[] {
        const entities: Entity[] = [];

        // Find the type being implemented
        const typeNode = node.childForFieldName('type');
        const typeName = typeNode?.text || 'UnknownType';

        // Find function_items inside the impl block
        this.walkNode(node, (child) => {
            if (child.type === 'function_item' && child.parent?.type === 'declaration_list') {
                const nameNode = child.childForFieldName('name');
                if (nameNode) {
                    const name = nameNode.text;
                    const isExported = child.children.some(c => c.type === 'visibility_modifier');

                    const lines = fileContent.split('\n');
                    const startLine = child.startPosition.row;
                    let signature = lines[startLine]?.trim() || `fn ${name}`;
                    const braceIndex = signature.indexOf('{');
                    if (braceIndex > 0) {
                        signature = signature.substring(0, braceIndex).trim();
                    }

                    entities.push({
                        id: `${typeName}.${name}-${startLine}`,
                        kind: 'method',
                        name: `${typeName}.${name}`,
                        isExported,
                        loc: this.getLoc(child),
                        signature,
                        calls: [] // NO call extraction for Rust
                    });
                }
            }
        });

        return entities;
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
