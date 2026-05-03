/**
 * Python Extractor
 *
 * Tree-sitter based Python code analysis for import graph extraction.
 * Extracts:
 *   - Function and class definitions (entities)
 *   - Method definitions within classes
 *   - Import statements
 *
 * Note: Call graph extraction is NOT supported for Python.
 * Only TypeScript/JavaScript support call graphs.
 *
 * Performance target: 10,000+ lines/sec
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser, { SyntaxNode } from 'tree-sitter';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, Loc, EntityKind, ExportSpec } from '../types';
import { PythonImportParser } from './imports';

export class PythonExtractor implements ArtifactExtractor {
    private parser: Parser;
    private importParser: PythonImportParser;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        // Tree-sitter Python grammar - require lazily so `parser/config.ts` can
        // import this module's adapter for extension metadata without forcing
        // tree-sitter-python to be installed at module-load time.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Python = require('tree-sitter-python');
        this.parser = new Parser();
        this.parser.setLanguage(Python);
        this.importParser = new PythonImportParser();
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        // Read file if content not provided
        const fileContent = content ?? fs.readFileSync(filePath, 'utf-8');

        // Parse with tree-sitter
        const tree = this.parser.parse(fileContent);
        const rootNode = tree.rootNode;

        // Calculate file ID (relative path)
        const fileId = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        // 1. Parse imports
        const imports = this.importParser.parseImports(rootNode);

        // 2. Extract entities (functions, classes, methods)
        // NOTE: Call extraction is disabled for Python - only TS/JS supports call graphs
        const entities = this.extractEntities(rootNode, fileContent);

        // 3. Determine exports (in Python, top-level defs are typically "public")
        const exports = this.extractExports(entities);

        return {
            schemaVersion: 'python-ts-v1',
            file: {
                id: fileId,
                path: filePath,
                language: 'python'
            },
            imports,
            exports,
            entities
        };
    }

    /**
     * Extract all function and class definitions.
     */
    private extractEntities(rootNode: SyntaxNode, fileContent: string): Entity[] {
        const entities: Entity[] = [];

        const processNode = (node: SyntaxNode, classContext?: string) => {
            if (node.type === 'function_definition') {
                const entity = this.extractFunctionEntity(node, fileContent, classContext);
                if (entity) {
                    entities.push(entity);
                }
            } else if (node.type === 'class_definition') {
                const classEntity = this.extractClassEntity(node, fileContent);
                if (classEntity) {
                    entities.push(classEntity);

                    // Process methods within the class
                    const bodyNode = node.childForFieldName('body');
                    if (bodyNode) {
                        for (const child of bodyNode.children) {
                            processNode(child, classEntity.name);
                        }
                    }
                }
            } else if (node.type === 'decorated_definition') {
                // Handle decorated functions/classes
                for (const child of node.children) {
                    if (child.type === 'function_definition' || child.type === 'class_definition') {
                        processNode(child, classContext);
                    }
                }
            } else {
                // Recurse for top-level nodes
                for (const child of node.children) {
                    if (!classContext) {
                        processNode(child);
                    }
                }
            }
        };

        processNode(rootNode);
        return entities;
    }

    /**
     * Extract a function entity from a function_definition node.
     */
    private extractFunctionEntity(
        node: SyntaxNode,
        fileContent: string,
        classContext?: string
    ): Entity | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;

        const name = nameNode.text;
        const kind: EntityKind = classContext ? 'method' : 'function';

        // Build signature
        const parametersNode = node.childForFieldName('parameters');
        const returnTypeNode = node.childForFieldName('return_type');

        let signature = `def ${name}`;
        if (parametersNode) {
            signature += parametersNode.text;
        }
        if (returnTypeNode) {
            signature += ` -> ${returnTypeNode.text}`;
        }

        // Check for async
        const isAsync = node.children.some(c => c.type === 'async');
        if (isAsync) {
            signature = 'async ' + signature;
        }

        // Determine if exported (not starting with _)
        const isExported = !name.startsWith('_');

        return {
            id: `${name}-${node.startPosition.row}`,
            kind,
            name,
            isExported,
            loc: this.getLoc(node),
            signature: signature + ': ...',
            calls: []
        };
    }

    /**
     * Extract a class entity from a class_definition node.
     */
    private extractClassEntity(node: SyntaxNode, fileContent: string): Entity | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;

        const name = nameNode.text;

        // Build signature with base classes
        let signature = `class ${name}`;
        const superclassNode = node.childForFieldName('superclasses');
        if (superclassNode) {
            signature += superclassNode.text;
        }

        const isExported = !name.startsWith('_');

        return {
            id: `${name}-${node.startPosition.row}`,
            kind: 'class',
            name,
            isExported,
            loc: this.getLoc(node),
            signature: signature + ': ...',
            calls: []
        };
    }

    /**
     * Extract exports from entities.
     * In Python, top-level public functions/classes are considered exports.
     */
    private extractExports(entities: Entity[]): ExportSpec[] {
        return entities
            .filter(e => e.isExported && (e.kind === 'function' || e.kind === 'class'))
            .map(e => ({
                type: 'named' as const,
                name: e.name,
                loc: e.loc
            }));
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
