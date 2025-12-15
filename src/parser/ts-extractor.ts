import * as ts from 'typescript';
import * as path from 'path';
import { FileArtifact, ImportSpec, ExportSpec, Entity, CallSite, Loc, EntityKind } from './types';
import { ArtifactExtractor } from './interfaces';

export class TypeScriptExtractor implements ArtifactExtractor {
    private workspaceRoot: string;

    constructor(
        private programProvider: () => ts.Program | undefined,
        workspaceRoot?: string
    ) {
        // Use provided workspace root, or fall back to cwd
        this.workspaceRoot = workspaceRoot || process.cwd();
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        let program = this.programProvider();
        let sourceFile: ts.SourceFile | undefined;
        let checker: ts.TypeChecker | undefined;

        if (program) {
            sourceFile = program.getSourceFile(filePath);
            checker = program.getTypeChecker();
        }

        if (!sourceFile) {
            // File not in main program (e.g. new file, or file outside root).
            // Create a temporary program for single-file analysis.
            // This is slower but ensures we get results.
            const tempProgram = ts.createProgram([filePath], {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                allowJs: true
            });
            sourceFile = tempProgram.getSourceFile(filePath);
            checker = tempProgram.getTypeChecker();
        }

        if (!sourceFile || !checker) {
            return null;
        }

        return this.extractFromSource(sourceFile, checker);
    }

    private extractFromSource(sourceFile: ts.SourceFile, checker: ts.TypeChecker): FileArtifact {
        const filePath = sourceFile.fileName;
        const imports: ImportSpec[] = [];
        const exports: ExportSpec[] = [];
        const entities: Entity[] = [];

        // Helper to get location
        const getLoc = (node: ts.Node): Loc => {
            const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
            const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
            return {
                startByte: node.getStart(),
                endByte: node.getEnd(),
                startLine: start.line + 1,
                endLine: end.line + 1,
                startColumn: start.character,
                endColumn: end.character
            };
        };

        const visit = (node: ts.Node) => {
            // IMPORTS
            if (ts.isImportDeclaration(node)) {
                if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    const source = node.moduleSpecifier.text;
                    const specifiers: { name: string; alias?: string }[] = [];

                    if (node.importClause) {
                        if (node.importClause.name) {
                            specifiers.push({ name: 'default', alias: node.importClause.name.text });
                        }

                        if (node.importClause.namedBindings) {
                            if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                                specifiers.push({ name: '*', alias: node.importClause.namedBindings.name.text });
                            } else if (ts.isNamedImports(node.importClause.namedBindings)) {
                                node.importClause.namedBindings.elements.forEach(el => {
                                    specifiers.push({
                                        name: el.propertyName ? el.propertyName.text : el.name.text,
                                        alias: el.propertyName ? el.name.text : undefined
                                    });
                                });
                            }
                        }
                    }

                    // Resolve path
                    let resolvedPath: string | null = null;
                    const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
                    if (symbol && symbol.valueDeclaration) {
                        const decl = symbol.valueDeclaration as ts.SourceFile;
                        // If it resolves to a file, get path. 
                        // Note: declaration might be a ambient module decl in .d.ts
                        if (decl.fileName) {
                            // Make relative to workspace root to match fileIds
                            resolvedPath = path.relative(this.workspaceRoot, decl.fileName).replace(/\\/g, '/');
                        }
                    }

                    if (!resolvedPath) {
                        // Fallback: try basic module resolution if checker didn't give it
                        // (Checker usually works if program is correct)
                    }

                    imports.push({
                        kind: 'es',
                        source,
                        resolvedPath,
                        specifiers,
                        loc: getLoc(node)
                    });
                }
            }

            // EXPORTS
            else if (ts.isExportDeclaration(node)) {
                // re-export: export { foo } from './bar'
                const source = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;

                if (node.exportClause) {
                    if (ts.isNamedExports(node.exportClause)) {
                        node.exportClause.elements.forEach(el => {
                            exports.push({
                                type: source ? 'reexport' : 'named',
                                name: el.propertyName ? el.propertyName.text : el.name.text, // original name
                                localName: el.propertyName ? el.name.text : el.name.text,   // exported as
                                source,
                                loc: getLoc(el)
                            });
                        });
                    } else if (ts.isNamespaceExport(node.exportClause)) {
                        exports.push({
                            type: 'all', // export * as ns
                            name: '*',
                            source, // requires source
                            localName: node.exportClause.name.text,
                            loc: getLoc(node)
                        });
                    }
                } else {
                    // export * from '...'
                    if (source) {
                        exports.push({
                            type: 'all',
                            name: '*',
                            source,
                            loc: getLoc(node)
                        });
                    }
                }
            }
            else if (ts.isExportAssignment(node)) {
                exports.push({
                    type: 'default',
                    name: 'default',
                    loc: getLoc(node)
                });
            }

            // ENTITIES (Functions, Classes, Variables that are const arrows)
            else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                let name = '';
                let kind: EntityKind = 'function';
                let entityNode = node;
                let isExported = false;

                if (ts.isFunctionDeclaration(node)) {
                    name = node.name?.text || 'anonymous';
                    kind = 'function';
                    isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
                } else if (ts.isClassDeclaration(node)) {
                    name = node.name?.text || 'anonymous';
                    kind = 'class';
                    isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
                } else if (ts.isMethodDeclaration(node)) {
                    name = node.name?.getText(sourceFile) || 'anonymous';
                    kind = 'method';
                } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
                    // Try to find parent variable declaration
                    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
                        name = node.parent.name.text;
                        kind = 'arrow';
                        const varStmt = node.parent.parent.parent;
                        if (ts.isVariableStatement(varStmt)) {
                            isExported = !!(varStmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
                        }
                    } else {
                        // Anonymous or callback
                        return; // Skip anonymous for now unless we want them?
                    }
                }

                // Signature extraction
                const signature = node.getText(sourceFile).split('{')[0].trim() + ' ...';

                // Find calls within this entity
                const calls: CallSite[] = [];
                const findCalls = (n: ts.Node) => {
                    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
                        let calleeName = '';
                        let expressionToResolve: ts.Node = n.expression;
                        if (ts.isIdentifier(n.expression)) {
                            calleeName = n.expression.text;
                        } else if (ts.isPropertyAccessExpression(n.expression)) {
                            calleeName = n.expression.name.text; // method name
                            expressionToResolve = n.expression.name; // resolve the property name specifically
                        }

                        // We also want to resolve WHERE this points to if possible
                        let resolvedDefinition: { file: string; name: string } | undefined;
                        if (checker) {
                            let symbol = checker.getSymbolAtLocation(expressionToResolve);
                            if (symbol) {
                                // If it's an alias (e.g. import), get the aliased symbol
                                if (symbol.flags & ts.SymbolFlags.Alias) {
                                    symbol = checker.getAliasedSymbol(symbol);
                                }

                                if (symbol.valueDeclaration) {
                                    const decl = symbol.valueDeclaration;
                                    const sourceFile = decl.getSourceFile();
                                    if (sourceFile && sourceFile.fileName) {
                                        // Use normalized relative path to workspace root
                                        const relPath = path.relative(this.workspaceRoot, sourceFile.fileName).replace(/\\/g, '/');
                                        resolvedDefinition = {
                                            file: relPath,
                                            name: symbol.name
                                        };
                                    }
                                }
                            }
                        }

                        // For now, simple name extraction as per previous parity
                        if (calleeName) {
                            calls.push({
                                callSiteId: 'call@' + n.getStart(),
                                kind: ts.isNewExpression(n) ? 'new' : ts.isCallExpression(n.expression) && ts.isPropertyAccessExpression(n.expression) ? 'method' : 'function',
                                calleeName,
                                resolvedDefinition,
                                loc: getLoc(n)
                            });
                        }
                    }
                    ts.forEachChild(n, findCalls);
                };

                // Scan the body of the function/method
                if ('body' in node && node.body) {
                    ts.forEachChild(node.body, findCalls);
                }

                entities.push({
                    id: '' + node.getStart(),
                    kind,
                    name,
                    isExported,
                    loc: getLoc(node),
                    signature,
                    calls
                });
            }

            // Also check for variable statements that export things (named exports)
            if (ts.isVariableStatement(node)) {
                if (node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                    node.declarationList.declarations.forEach(d => {
                        if (ts.isIdentifier(d.name)) {
                            exports.push({
                                type: 'named',
                                name: d.name.text,
                                loc: getLoc(d)
                            });

                            // If it was an arrow function, we handled it above in entity extraction?
                            // We should check to avoid duplication or missing it.
                            // The arrow function logic checks strict parent structure.
                        }
                    });
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        const fileId = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        return {
            schemaVersion: "ts-graph-v1",
            file: {
                id: fileId,
                path: filePath,
                language: 'typescript'
            },
            imports,
            exports,
            entities
        };
    }
}
