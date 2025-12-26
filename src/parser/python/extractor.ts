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
import { FileArtifact, Entity, CallSite, Loc, EntityKind, ExportSpec } from '../types';
import { PythonImportParser } from './imports';
import { PythonCallResolver, LocalDefinition } from './resolver';

// Tree-sitter Python grammar - require at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Python = require('tree-sitter-python');

export class PythonExtractor implements ArtifactExtractor {
    private parser: Parser;
    private importParser: PythonImportParser;
    private callResolver: PythonCallResolver;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.parser = new Parser();
        this.parser.setLanguage(Python);
        this.importParser = new PythonImportParser();
        this.callResolver = new PythonCallResolver(this.workspaceRoot);
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
        const { entities } = this.extractEntities(rootNode, fileContent);

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
    private extractEntities(
        rootNode: SyntaxNode,
        fileContent: string
    ): { entities: Entity[]; localDefs: Map<string, LocalDefinition> } {
        const entities: Entity[] = [];
        const localDefs = new Map<string, LocalDefinition>();

        const processNode = (node: SyntaxNode, classContext?: string) => {
            if (node.type === 'function_definition') {
                const entity = this.extractFunctionEntity(node, fileContent, classContext);
                if (entity) {
                    entities.push(entity);

                    const kind = classContext ? 'method' : 'function';
                    const qualifiedName = classContext ? `${classContext}.${entity.name}` : entity.name;

                    localDefs.set(entity.name, {
                        name: entity.name,
                        kind,
                        qualifiedName
                    });

                    if (classContext) {
                        localDefs.set(qualifiedName, {
                            name: entity.name,
                            kind,
                            qualifiedName
                        });
                    }
                }
            } else if (node.type === 'class_definition') {
                const classEntity = this.extractClassEntity(node, fileContent);
                if (classEntity) {
                    entities.push(classEntity);

                    localDefs.set(classEntity.name, {
                        name: classEntity.name,
                        kind: 'class',
                        qualifiedName: classEntity.name
                    });

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
        return { entities, localDefs };
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
     * Extract all call sites within an entity's body.
     */
    private extractCalls(entityNode: SyntaxNode, fileContent: string): CallSite[] {
        const calls: CallSite[] = [];
        const bodyNode = entityNode.childForFieldName('body');

        if (!bodyNode) return calls;

        const processNode = (node: SyntaxNode) => {
            if (node.type === 'call') {
                const callSite = this.extractCallSite(node);
                if (callSite) {
                    calls.push(callSite);
                }
            }

            // Don't recurse into nested function/class definitions
            if (node.type !== 'function_definition' && node.type !== 'class_definition') {
                for (const child of node.children) {
                    processNode(child);
                }
            }
        };

        processNode(bodyNode);
        return calls;
    }

    /**
     * Extract a CallSite from a call node.
     */
    private extractCallSite(node: SyntaxNode): CallSite | null {
        const functionNode = node.childForFieldName('function');
        if (!functionNode) return null;

        let calleeName: string;
        let kind: 'function' | 'method' | 'new' = 'function';

        if (functionNode.type === 'identifier') {
            // Simple function call: foo()
            calleeName = functionNode.text;
        } else if (functionNode.type === 'attribute') {
            // Method call: obj.method() or module.func()
            calleeName = functionNode.text;
            kind = 'method';
        } else {
            // Complex expression: foo()(), etc.
            calleeName = functionNode.text;
        }

        // Resolve the call
        const resolved = this.callResolver.resolve(calleeName);

        return {
            callSiteId: `call@${node.startPosition.row + 1}:${node.startPosition.column}`,
            kind,
            calleeName,
            resolvedDefinition: resolved,
            loc: this.getLoc(node)
        };
    }

    /**
     * Find the AST node corresponding to an entity.
     */
    private findEntityNode(rootNode: SyntaxNode, entity: Entity): SyntaxNode | null {
        const targetLine = entity.loc.startLine - 1; // Convert to 0-based

        const search = (node: SyntaxNode): SyntaxNode | null => {
            if (
                (node.type === 'function_definition' || node.type === 'class_definition') &&
                node.startPosition.row === targetLine
            ) {
                const nameNode = node.childForFieldName('name');
                if (nameNode && nameNode.text === entity.name) {
                    return node;
                }
            }

            // Check decorated definitions
            if (node.type === 'decorated_definition') {
                for (const child of node.children) {
                    const result = search(child);
                    if (result) return result;
                }
            }

            for (const child of node.children) {
                const result = search(child);
                if (result) return result;
            }

            return null;
        };

        return search(rootNode);
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
