import Parser = require('tree-sitter');
import { FunctionInfo, ClassInfo, FileOutline, ImportInfo, ExportInfo, TypeInfo } from './types';

export class Extractor {
    public extract(tree: Parser.Tree, language: string, filePath: string): FileOutline {
        const functions: FunctionInfo[] = [];
        const classes: ClassInfo[] = [];
        const imports: ImportInfo[] = [];
        const exports: ExportInfo[] = [];
        const types: TypeInfo[] = [];

        this.visitNode(tree.rootNode, functions, classes, imports, exports, types, language);

        return {
            path: filePath,
            language,
            functions,
            classes,
            imports,
            exports,
            types
        };
    }

    private visitNode(
        node: Parser.SyntaxNode,
        functions: FunctionInfo[],
        classes: ClassInfo[],
        imports: ImportInfo[],
        exports: ExportInfo[],
        types: TypeInfo[],
        language: string
    ) {
        if (this.isFunction(node, language)) {
            functions.push(this.parseFunction(node));
        } else if (this.isClass(node, language)) {
            classes.push(this.parseClass(node, language));
        } else if (this.isImport(node, language)) {
            const imp = this.parseImport(node, language);
            if (imp) imports.push(imp);
        } else if (this.isExport(node, language)) {
            const exp = this.parseExport(node, language);
            if (exp) exports.push(...exp); // Can implement multiple exports in one statement
        } else if (this.isType(node, language)) {
            types.push(this.parseType(node, language));
        } else {
            // Recurse
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) {
                    this.visitNode(child, functions, classes, imports, exports, types, language);
                }
            }
        }
    }

    // --- CHECKERS ---

    private isFunction(node: Parser.SyntaxNode, lang: string): boolean {
        if (lang === 'python') return node.type === 'function_definition';
        return node.type === 'function_declaration' ||
            (node.type === 'lexical_declaration' && this.isArrowFunctionVariable(node));
    }

    private isArrowFunctionVariable(node: Parser.SyntaxNode): boolean {
        if (node.childCount > 0) {
            const declarator = node.children.find(c => c.type === 'variable_declarator');
            if (declarator && declarator.children.some(c => c.type === 'arrow_function')) {
                return true;
            }
        }
        return false;
    }

    private isClass(node: Parser.SyntaxNode, lang: string): boolean {
        return node.type === 'class_declaration' || node.type === 'class_definition';
    }

    private isImport(node: Parser.SyntaxNode, lang: string): boolean {
        if (lang === 'python') return node.type === 'import_statement' || node.type === 'import_from_statement';
        return node.type === 'import_declaration';
    }

    private isExport(node: Parser.SyntaxNode, lang: string): boolean {
        return node.type === 'export_statement' || node.type === 'export_declaration';
    }

    private isType(node: Parser.SyntaxNode, lang: string): boolean {
        // TS specific for now
        return node.type === 'interface_declaration' || node.type === 'type_alias_declaration' || node.type === 'enum_declaration';
    }

    // --- PARSERS ---

    private parseFunction(node: Parser.SyntaxNode): FunctionInfo {
        let name = 'anonymous';

        if (node.type === 'function_declaration' || node.type === 'function_definition') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) name = nameNode.text;
        } else if (node.type === 'lexical_declaration') {
            const declarator = node.children.find(c => c.type === 'variable_declarator');
            const nameNode = declarator?.childForFieldName('name');
            if (nameNode) name = nameNode.text;
        }

        const params: Array<{ name: string; type?: string }> = [];
        const parametersNode = node.childForFieldName('parameters');
        if (parametersNode) {
            for (let i = 0; i < parametersNode.childCount; i++) {
                const p = parametersNode.child(i);
                if (p && (p.type === 'identifier' || p.type === 'required_parameter' || p.type === 'typed_parameter')) {
                    params.push({ name: p.text });
                }
            }
        }

        return {
            name,
            params,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature: node.text.split('\n')[0],
        };
    }

    private parseClass(node: Parser.SyntaxNode, language: string): ClassInfo {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'anonymous';
        const methods: FunctionInfo[] = [];

        const bodyIndex = node.children.findIndex(c => c.type === 'class_body' || c.type === 'block');
        if (bodyIndex !== -1) {
            const body = node.children[bodyIndex];
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (!child) continue;
                // TS: method_definition, Python: function_definition
                if (child.type === 'method_definition' || (language === 'python' && child.type === 'function_definition')) {
                    const methodNameNode = child.childForFieldName('name');
                    methods.push({
                        name: methodNameNode ? methodNameNode.text : 'anonymous',
                        params: [], // Simplified
                        startLine: child.startPosition.row + 1,
                        endLine: child.endPosition.row + 1,
                        signature: child.text.split('\n')[0]
                    });
                }
            }
        }

        return {
            name,
            methods,
            properties: [],
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
        };
    }

    private parseImport(node: Parser.SyntaxNode, language: string): ImportInfo | null {
        // Simple logic for TS import_declaration
        if (node.type === 'import_declaration') {
            const sourceNode = node.childForFieldName('source');
            if (!sourceNode) return null;
            // sourceNode text includes quotes, e.g. "'vscode'"
            const source = sourceNode.text.replace(/['"]/g, '');

            const specifiers: Array<{ name: string }> = [];
            const clause = node.childForFieldName('clause'); // import_clause
            // Need to dig into clause -> named_imports -> import_specifier
            if (clause) {
                // Iterate clause children
                // Flatten logic for brevity: just regex text for named imports would be flaky
                // Traverse:
                // 1. named_imports e.g. { A, B }
                // 2. identifier e.g. import X from ...
                const namedImports = clause.children.find(c => c.type === 'named_imports');
                if (namedImports) {
                    for (let i = 0; i < namedImports.childCount; i++) {
                        const child = namedImports.child(i);
                        if (child?.type === 'import_specifier') {
                            // name or name as alias
                            const nameNode = child.childForFieldName('name');
                            if (nameNode) specifiers.push({ name: nameNode.text });
                        }
                    }
                }
            }

            return {
                source,
                specifiers,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1
            };
        }
        return null;
    }

    private parseExport(node: Parser.SyntaxNode, language: string): ExportInfo[] | null {
        // TS export_declaration
        // format: export const x = 1; OR export { x };
        const exports: ExportInfo[] = [];

        // 1. Exporting a declaration (const, class, function)
        // Checks if child[1] is declaration
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;

            // export const X = ...
            if (child.type === 'lexical_declaration') {
                const declarator = child.children.find(c => c.type === 'variable_declarator');
                const nameNode = declarator?.childForFieldName('name');
                if (nameNode) {
                    exports.push({ type: 'named', name: nameNode.text, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
                }
            }
            // export function F() {}
            else if (child.type === 'function_declaration') {
                const nameNode = child.childForFieldName('name');
                if (nameNode) {
                    exports.push({ type: 'named', name: nameNode.text, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
                }
            }
            // export class C {}
            else if (child.type === 'class_declaration') {
                const nameNode = child.childForFieldName('name');
                if (nameNode) {
                    exports.push({ type: 'named', name: nameNode.text, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
                }
            }
            // export { X, Y }
            else if (child.type === 'export_clause') {
                for (let k = 0; k < child.childCount; k++) {
                    const spec = child.child(k);
                    if (spec?.type === 'export_specifier') {
                        const nameNode = spec.childForFieldName('name');
                        if (nameNode) {
                            exports.push({ type: 'named', name: nameNode.text, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
                        }
                    }
                }
            }
        }

        return exports.length ? exports : null;
    }

    private parseType(node: Parser.SyntaxNode, language: string): TypeInfo {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'anonymous';
        let kind: TypeInfo['kind'] = 'type';
        if (node.type === 'interface_declaration') kind = 'interface';
        if (node.type === 'enum_declaration') kind = 'enum';

        return {
            name,
            kind,
            definition: node.text.replace(/\s+/g, ' ').substring(0, 100) + '...', // Truncate long definitions
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1
        };
    }
}
