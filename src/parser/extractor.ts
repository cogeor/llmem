import * as path from 'path';
import * as fs from 'fs';
import Parser = require('tree-sitter');
import { FileArtifact, Entity, ImportSpec, ExportSpec, CallSite, EntityKind, Loc } from './types';

const QUERY_FILES = {
    imports: 'imports.scm',
    exports: 'exports.scm',
    entities: 'entities.scm',
    callsites: 'callsites.scm'
};

export class Extractor {
    private queries: Map<string, Parser.Query> = new Map();
    private querySources: Map<string, string> = new Map();
    private initialized = false;

    constructor() {
        this.loadQuerySources();
    }

    private loadQuerySources() {
        const queryDir = path.join(__dirname, 'queries');
        if (!fs.existsSync(queryDir)) {
            console.error(`[Extractor] Query directory not found: ${queryDir}`);
            return;
        }

        for (const [key, filename] of Object.entries(QUERY_FILES)) {
            const fullPath = path.join(queryDir, filename);
            if (fs.existsSync(fullPath)) {
                this.querySources.set(key, fs.readFileSync(fullPath, 'utf8'));
            } else {
                console.error(`[Extractor] Query file missing: ${fullPath}`);
            }
        }
        this.initialized = true;
    }

    private getQuery(language: any, key: string): Parser.Query | null {
        // We do not cache Query objects because they are bound to a specific Language instance.
        // If we reuse Extractor across different language instances (unlikely but safer), we should recreate.
        // Optimization: Cache by language instance if needed. For now, recreate.
        const source = this.querySources.get(key);
        if (!source) {
            return null;
        }
        try {
            return new Parser.Query(language, source);
        } catch (e) {
            console.error('[Extractor] Failed to compile query ' + key, e);
            return null;
        }
    }

    public extract(tree: Parser.Tree, languageName: string, filePath: string): FileArtifact {
        let language: any;
        try {
            if (languageName === 'typescript') language = require('tree-sitter-typescript').typescript;
            else if (languageName === 'tsx') language = require('tree-sitter-typescript').tsx;
            else if (languageName === 'javascript') language = require('tree-sitter-javascript');
            else if (languageName === 'python') language = require('tree-sitter-python');
        } catch (e) {
            console.error(`[Extractor] Failed to load language module for ${languageName}`, e);
        }

        if (!language) {
            return this.createEmptyArtifact(filePath, languageName);
        }

        const imports = this.extractImports(tree, language);
        const exports = this.extractExports(tree, language);
        const entities = this.extractEntities(tree, language);

        this.attachCallSites(tree, imports, entities, language);

        const fileId = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

        return {
            schemaVersion: "ts-graph-v1",
            file: {
                id: fileId,
                path: filePath,
                language: languageName
            },
            imports,
            exports,
            entities
        };
    }

    private extractImports(tree: Parser.Tree, language: any): ImportSpec[] {
        const query = this.getQuery(language, 'imports');
        if (!query) return [];

        const matches = query.matches(tree.rootNode);
        const imports: ImportSpec[] = [];

        for (const match of matches) {
            const sourceNode = match.captures.find(c => c.name === 'import.source')?.node;
            if (!sourceNode) continue;

            const source = sourceNode.text.replace(/['"]/g, '');
            const stmtNode = match.captures.find(c => c.name === 'import.stmt')?.node ?? sourceNode;

            const specifiers: { name: string; alias?: string }[] = [];

            const def = match.captures.find(c => c.name === 'import.default')?.node;
            if (def) specifiers.push({ name: 'default', alias: def.text });

            const ns = match.captures.find(c => c.name === 'import.namespace')?.node;
            if (ns) specifiers.push({ name: '*', alias: ns.text });

            if (stmtNode) {
                this.extractSpecifiersFromStmt(stmtNode, specifiers);
            }

            imports.push({
                kind: 'es',
                source,
                resolvedPath: null,
                specifiers,
                loc: this.nodeLoc(stmtNode)
            });
        }
        return imports;
    }

    private extractSpecifiersFromStmt(node: Parser.SyntaxNode, list: { name: string; alias?: string }[]) {
        const clause = node.childForFieldName('clause');
        if (!clause) return;

        for (let i = 0; i < clause.childCount; i++) {
            const child = clause.child(i);
            if (!child) continue;

            if (child.type === 'identifier') {
                if (!list.some(x => x.name === 'default')) {
                    list.push({ name: 'default', alias: child.text });
                }
            }
            if (child.type === 'namespace_import') {
                const inner = child.children.find(c => c.type === 'identifier');
                if (inner && !list.some(x => x.name === '*')) {
                    list.push({ name: '*', alias: inner.text });
                }
            }
            if (child.type === 'named_imports') {
                for (let j = 0; j < child.childCount; j++) {
                    const imp = child.child(j);
                    if (imp && imp.type === 'import_specifier') {
                        const nameNode = imp.childForFieldName('name');
                        const aliasNode = imp.childForFieldName('alias');
                        if (nameNode) {
                            list.push({
                                name: nameNode.text,
                                alias: aliasNode ? aliasNode.text : undefined
                            });
                        }
                    }
                }
            }
        }
    }

    private extractExports(tree: Parser.Tree, language: any): ExportSpec[] {
        const query = this.getQuery(language, 'exports');
        if (!query) return [];
        const matches = query.matches(tree.rootNode);
        const exports: ExportSpec[] = [];

        for (const match of matches) {
            const stmt = match.captures.find(c => c.name.endsWith('.stmt') || c.name === 'export.default')?.node;
            if (!stmt) continue;

            const loc = this.nodeLoc(stmt);

            const nameNode = match.captures.find(c => c.name === 'export.name' || c.name === 'export.default_name')?.node;
            if (nameNode) {
                const type = match.captures.some(c => c.name === 'export.default' || c.name === 'export.default_name') ? 'default' : 'named';
                exports.push({ type, name: nameNode.text, loc });
                continue;
            }

            const localNode = match.captures.find(c => c.name === 'export.local')?.node;
            const exportedNode = match.captures.find(c => c.name === 'export.exported')?.node;
            if (localNode) {
                const name = exportedNode ? exportedNode.text : localNode.text;
                const localName = localNode.text;
                exports.push({ type: 'named', name, localName, loc });
                continue;
            }

            const reSource = match.captures.find(c => c.name === 'reexport.source')?.node;
            if (reSource) {
                const source = reSource.text.replace(/['"]/g, '');
                if (match.captures.some(c => c.name === 'export.star')) {
                    exports.push({ type: 'all', name: '*', source, loc });
                } else {
                    const clause = stmt.children.find(c => c.type === 'export_clause');
                    if (clause) {
                        for (let k = 0; k < clause.childCount; k++) {
                            const child = clause.child(k);
                            if (child && child.type === 'export_specifier') {
                                const n = child.childForFieldName('name');
                                const a = child.childForFieldName('alias');
                                if (n) {
                                    exports.push({
                                        type: 'reexport',
                                        name: a ? a.text : n.text,
                                        localName: n.text,
                                        source,
                                        loc
                                    });
                                }
                            }
                        }
                    }
                }
                continue;
            }

            if (match.captures.some(c => c.name === 'export.default_expr')) {
                exports.push({ type: 'default', name: 'default', loc });
            }
        }
        return exports;
    }

    private extractEntities(tree: Parser.Tree, language: any): Entity[] {
        const query = this.getQuery(language, 'entities');
        if (!query) return [];
        const matches = query.matches(tree.rootNode);
        const entities: Entity[] = [];

        for (const match of matches) {
            const nameNode = match.captures.find(c => c.name === 'entity.name' || c.name === 'entity.member_name' || c.name === 'entity.ctor_name')?.node;

            let kind: EntityKind = 'function';
            if (match.captures.some(c => c.name === 'entity.class')) kind = 'class';
            else if (match.captures.some(c => c.name === 'entity.method')) kind = 'method';
            else if (match.captures.some(c => c.name === 'entity.arrow' || c.name === 'entity.var_arrow')) kind = 'arrow';
            else if (match.captures.some(c => c.name === 'entity.ctor')) kind = 'ctor';
            else if (match.captures.some(c => c.name === 'entity.getter')) kind = 'getter';
            else if (match.captures.some(c => c.name === 'entity.setter')) kind = 'setter';

            let entityNode = nameNode?.parent;
            if (kind === 'arrow') {
                const val = match.captures.find(c => c.name === 'entity.arrow' || c.name === 'entity.var_arrow')?.node;
                entityNode = val?.parent;
            } else if (match.captures.some(c => c.name === 'entity.function')) {
                entityNode = match.captures.find(c => c.name === 'entity.function')?.node;
            } else if (match.captures.some(c => c.name === 'entity.class')) {
                entityNode = match.captures.find(c => c.name === 'entity.class')?.node;
            }

            if (!entityNode || !nameNode) continue;

            const id = '' + entityNode.startIndex;

            const signature = this.signatureTextFromNode(tree.rootNode.text, entityNode);

            entities.push({
                id: id,
                kind,
                name: nameNode.text,
                isExported: false,
                loc: this.nodeLoc(entityNode),
                signature,
                calls: []
            });

            (entities[entities.length - 1] as any)._node = entityNode;
        }
        return entities;
    }

    private attachCallSites(tree: Parser.Tree, imports: ImportSpec[], entities: Entity[], language: any) {
        const query = this.getQuery(language, 'callsites');
        if (!query) return;

        for (const entity of entities) {
            const node = (entity as any)._node as Parser.SyntaxNode;
            if (!node) continue;
            delete (entity as any)._node;

            const calls = this.collectCallsInScope(node, query);
            entity.calls = calls.reduce((acc, c) => {
                const callee = c.childForFieldName('function') ?? c.childForFieldName('constructor');
                if (callee) {
                    let name = callee.text;
                    name = name.replace(/\s+/g, '');

                    acc.push({
                        callSiteId: 'call@' + c.startIndex,
                        kind: c.type === 'new_expression' ? 'new' : 'function',
                        calleeName: name,
                        loc: this.nodeLoc(c)
                    });
                }
                return acc;
            }, [] as CallSite[]);
        }
    }

    private collectCallsInScope(root: Parser.SyntaxNode, query: Parser.Query): Parser.SyntaxNode[] {
        const captures = query.captures(root);

        const validCalls: Parser.SyntaxNode[] = [];
        for (const cap of captures) {
            let p = cap.node.parent;
            let nested = false;
            while (p && p.id !== root.id) {
                if (this.isCallable(p)) {
                    nested = true;
                    break;
                }
                p = p.parent;
            }
            if (!nested) {
                validCalls.push(cap.node);
            }
        }
        return validCalls;
    }

    private isCallable(node: Parser.SyntaxNode): boolean {
        return ['function_declaration', 'function_definition', 'arrow_function', 'method_definition', 'class_declaration'].includes(node.type);
    }

    private signatureTextFromNode(source: string, node: Parser.SyntaxNode): string {
        const text = node.text;
        const firstBrace = text.indexOf('{');
        const arrow = text.indexOf('=>');
        let end = text.length;
        if (firstBrace !== -1) end = Math.min(end, firstBrace);
        if (arrow !== -1) end = Math.min(end, arrow);
        return text.substring(0, end).trim() + ' ...';
    }

    private nodeLoc(node: Parser.SyntaxNode): Loc {
        return {
            startByte: node.startIndex,
            endByte: node.endIndex,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column
        };
    }

    private createEmptyArtifact(filePath: string, language: string): FileArtifact {
        return {
            schemaVersion: "ts-graph-v1",
            file: { id: path.basename(filePath), path: filePath, language },
            imports: [],
            exports: [],
            entities: []
        };
    }
}
