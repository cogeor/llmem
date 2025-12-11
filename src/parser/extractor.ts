import Parser = require('tree-sitter');
import { FunctionInfo, ClassInfo, FileOutline } from './types';

export class Extractor {
    public extract(tree: Parser.Tree, language: string, filePath: string): FileOutline {
        const functions: FunctionInfo[] = [];
        const classes: ClassInfo[] = [];

        // Simple cursor-based traversal or query-based. 
        // Queries are more robust for tree-sitter.

        // We will use a simplified traversal for MVP to get top-level items.
        // For production, Queries are better.

        // Using queries:
        const query = this.getQuery(language);
        if (query) {
            const captures = query.captures(tree.rootNode);
            // Process captures to build objects
            // Note: This is a simplified implementation. Handling nested scopes properly requires more logic.

            // We'll iterate manually for now to have better control over node types without defining complex queries immediately.
            this.visitNode(tree.rootNode, functions, classes, language);
        } else {
            // Fallback or just manual walk
            this.visitNode(tree.rootNode, functions, classes, language);
        }

        return {
            path: filePath,
            language,
            functions,
            classes
        };
    }

    private getQuery(language: string): Parser.Query | null {
        // Return null to force manual traversal for MVP stability unless we are sure of the query syntax
        return null;
    }

    private visitNode(node: Parser.SyntaxNode, functions: FunctionInfo[], classes: ClassInfo[], language: string) {
        if (this.isFunction(node, language)) {
            functions.push(this.parseFunction(node));
            // Don't recurse into function bodies for top-level stats, 
            // OR do recurse if we want nested functions (leaving flat for now)
        } else if (this.isClass(node, language)) {
            classes.push(this.parseClass(node, language));
        } else {
            // Recurse
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) {
                    this.visitNode(child, functions, classes, language);
                }
            }
        }
    }

    private isFunction(node: Parser.SyntaxNode, lang: string): boolean {
        if (lang === 'python') {
            return node.type === 'function_definition';
        }
        // JS/TS
        return node.type === 'function_declaration' ||
            (node.type === 'lexical_declaration' && this.isArrowFunctionVariable(node));
    }

    private isArrowFunctionVariable(node: Parser.SyntaxNode): boolean {
        // const foo = () => {}
        // lexical_declaration -> variable_declarator -> arrow_function
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

    private parseFunction(node: Parser.SyntaxNode): FunctionInfo {
        let name = 'anonymous';

        if (node.type === 'function_declaration' || node.type === 'function_definition') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) name = nameNode.text;
        } else if (node.type === 'lexical_declaration') {
            // Arrow function variable name
            const declarator = node.children.find(c => c.type === 'variable_declarator');
            const nameNode = declarator?.childForFieldName('name');
            if (nameNode) name = nameNode.text;
        }

        // Params extraction handles basic cases
        const params: Array<{ name: string; type?: string }> = [];
        const parametersNode = node.childForFieldName('parameters');
        if (parametersNode) {
            for (let i = 0; i < parametersNode.childCount; i++) {
                const p = parametersNode.child(i);
                if (!p) continue;

                if (p.type === 'identifier') {
                    params.push({ name: p.text });
                } else if (p.type === 'required_parameter' || p.type === 'typed_parameter') {
                    // simple param
                    params.push({ name: p.text }); // Python/TS might differ slightly in text
                }
            }
        }

        return {
            name,
            params,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature: node.text.split('\n')[0], // Approximating signature for now
        };
    }

    private parseClass(node: Parser.SyntaxNode, language: string): ClassInfo {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : 'anonymous';
        const methods: FunctionInfo[] = [];

        // Extract methods
        // traverse class body
        const bodyIndex = node.children.findIndex(c => c.type === 'class_body' || c.type === 'block');
        if (bodyIndex !== -1) {
            const body = node.children[bodyIndex];
            for (let i = 0; i < body.childCount; i++) {
                const child = body.child(i);
                if (!child) continue;

                if (child.type === 'method_definition' || (language === 'python' && child.type === 'function_definition')) {
                    // Parse method
                    const methodNameNode = child.childForFieldName('name');
                    const methodName = methodNameNode ? methodNameNode.text : 'anonymous';
                    methods.push({
                        name: methodName,
                        params: [], // TODO: extract params for methods
                        startLine: child.startPosition.row + 1, // 1-indexed
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
}
