/**
 * Python Extractor
 *
 * Tree-sitter based Python code analysis for import/call graph extraction.
 * Extracts:
 *   - Function and class definitions (entities)
 *   - Method definitions within classes
 *   - Import statements
 *   - Call sites within function/method bodies
 *
 * Performance target: 10,000+ lines/sec
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, Loc, EntityKind, ExportSpec, CallSite } from '../types';
import { PythonImportParser } from './imports';

// Type-only references to the tree-sitter native core. Written as inline
// `import(...)` type queries (never `import type` statements) so that ts-node /
// tsc can never emit a runtime `require('tree-sitter')` for them: importing this
// module must not load the native addon. The core is require()d lazily inside
// the constructor instead.
type Parser = import('tree-sitter');
type SyntaxNode = import('tree-sitter').SyntaxNode;

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
        // Tree-sitter core (native addon) - require lazily too so that
        // importing this module (e.g. via `parser/config.ts`) never loads
        // the native binding; it is only loaded when an extractor is
        // actually constructed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Parser = require('tree-sitter');
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

        // PC-06: collect SAME-FILE class names in a cheap pre-pass so that
        // function-body call extraction can tag `Thing()` (where `class Thing`
        // exists in this file) as kind:'new'. Must be known before/while bodies
        // are walked — hence a dedicated pass over class_definition names.
        const classNames = this.collectClassNames(rootNode);

        const processNode = (node: SyntaxNode, classContext?: string) => {
            if (node.type === 'function_definition') {
                const entity = this.extractFunctionEntity(node, fileContent, classContext, classNames);
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
     * Collect the names of all class definitions in this file (any nesting
     * level). Used by PC-06 to tag same-file class instantiations as
     * kind:'new'. Cheap single walk; descends through every node so nested
     * classes are also captured.
     */
    private collectClassNames(rootNode: SyntaxNode): Set<string> {
        const names = new Set<string>();
        const visit = (node: SyntaxNode) => {
            if (node.type === 'class_definition') {
                const nameNode = node.childForFieldName('name');
                if (nameNode) {
                    names.add(nameNode.text);
                }
            }
            for (const child of node.children) {
                visit(child);
            }
        };
        visit(rootNode);
        return names;
    }

    /**
     * Extract a function entity from a function_definition node.
     */
    private extractFunctionEntity(
        node: SyntaxNode,
        fileContent: string,
        classContext?: string,
        classNames?: Set<string>
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

        // Extract call sites from the function body. Calls inside nested
        // function/class definitions are NOT attributed to this entity — they
        // get their own pass (see extractCalls' scope boundary).
        const bodyNode = node.childForFieldName('body');
        const calls = bodyNode ? this.extractCalls(bodyNode, classContext, classNames) : [];

        return {
            id: `${name}-${node.startPosition.row}`,
            kind,
            name,
            isExported,
            loc: this.getLoc(node),
            signature: signature + ': ...',
            calls
        };
    }

    /**
     * Extract call sites from a function/method body subtree.
     *
     * One pass over the body collecting tree-sitter `call` nodes, emitting a
     * CallSite for each. The walk STOPS at nested function_definition /
     * class_definition (mirroring the classContext gate in extractEntities) so
     * a nested def's calls are not attributed to the enclosing entity.
     *
     * calleeName is always the FINAL identifier (never a dotted path):
     *   - `function` field is an `identifier`        -> that identifier's text  (kind 'function')
     *   - `function` field is an `attribute`         -> the attribute's final
     *     name (right-hand `attribute` field), e.g. self.parse -> 'parse',
     *     mod.func -> 'func', obj.method -> 'method'                (kind 'method')
     *   - any other callee shape (e.g. getattr(...)() ) -> skipped
     *
     * resolvedDefinition is left UNDEFINED: the language-agnostic resolver in
     * artifact-converter.ts falls through to its import/local tiers, and any
     * unresolved (dangling) edge is dropped at graph-build (index.ts).
     *
     * @param classContext - present when walking a method body; threaded through
     *   for parity with extractEntities (call resolution is name-based, so this
     *   is not used to alter calleeName, but kept for signature symmetry).
     * @param classNames - PC-06: set of same-file class names. An `identifier`
     *   callee that matches one is tagged kind:'new' (class instantiation).
     */
    public extractCalls(bodyNode: SyntaxNode, _classContext?: string, classNames?: Set<string>): CallSite[] {
        const calls: CallSite[] = [];

        const visit = (node: SyntaxNode) => {
            // Scope boundary: do NOT descend into nested defs — those entities
            // get their own extractCalls pass.
            if (node.type === 'function_definition' || node.type === 'class_definition') {
                return;
            }

            if (node.type === 'call') {
                const callSite = this.callSiteFromCallNode(node, classNames);
                if (callSite) {
                    calls.push(callSite);
                }
                // Continue descending into the call node's arguments so that
                // calls nested in argument lists (e.g. f(g())) are captured.
            }

            for (const child of node.children) {
                visit(child);
            }
        };

        visit(bodyNode);
        return calls;
    }

    /**
     * Build a CallSite from a tree-sitter `call` node, or null if the callee
     * shape is not a plain identifier or attribute access.
     *
     * @param classNames - PC-06: same-file class names; an identifier callee in
     *   this set is a class instantiation (kind:'new').
     */
    private callSiteFromCallNode(callNode: SyntaxNode, classNames?: Set<string>): CallSite | null {
        const fnNode = callNode.childForFieldName('function');
        if (!fnNode) return null;

        let calleeName: string | undefined;
        let kind: CallSite['kind'] | undefined;

        if (fnNode.type === 'identifier') {
            // e.g. b(), Thing()
            calleeName = fnNode.text;
            // PC-06: a bare identifier that names a same-file class is an
            // instantiation -> kind:'new'. Otherwise a plain function call.
            // The edge target is unchanged either way (still calleeName).
            kind = PythonExtractor.isSameFileClassInstantiation(calleeName, classNames)
                ? 'new'
                : 'function';
        } else if (fnNode.type === 'attribute') {
            // e.g. self.parse(), mod.func(), obj.method().
            // The FINAL identifier is the attribute's `attribute` field (the
            // right-hand identifier), NOT the whole dotted attribute.text.
            const attrNode = fnNode.childForFieldName('attribute');
            if (attrNode) {
                calleeName = attrNode.text;
                kind = 'method';
            }
        }

        if (!calleeName || !kind) {
            // Other callee shapes (e.g. getattr(o,'x')() — a call whose
            // function is itself a call). Skip: emit no spurious CallSite.
            return null;
        }

        return {
            callSiteId: `${calleeName}@${callNode.startIndex}`,
            kind,
            calleeName,
            loc: this.getLoc(callNode)
        };
    }

    /**
     * PC-06 decision helper (pure): is `calleeName` a bare identifier naming a
     * class defined in the SAME file? Extracted so it can be unit-tested
     * without the tree-sitter grammar. Returns false when the set is absent.
     */
    public static isSameFileClassInstantiation(
        calleeName: string,
        classNames?: Set<string>
    ): boolean {
        return !!classNames && classNames.has(calleeName);
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
