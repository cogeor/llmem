import * as ts from 'typescript';
import * as path from 'path';
import { FileArtifact, ImportSpec, ExportSpec, Entity, CallSite, Loc, EntityKind } from '../types';
import { resolveModule } from '../ts-module-resolver';
import { ResolveContext } from './program-builder';

/**
 * Walk a parsed `ts.SourceFile` and extract imports, exports, and
 * entities (functions/classes/methods/arrows) with their call sites.
 *
 * Free-function form of the former `TypeScriptExtractor.extractFromSource`
 * private method. The only instance state it needed was the
 * `workspaceRoot` (used to relativize resolved call-definition paths and
 * the final `file.id`), which is now threaded in explicitly.
 */
export function extractFromSource(
    workspaceRoot: string,
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    ctx: ResolveContext
): FileArtifact {
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

                // Resolve path via ts.resolveModuleName (Loop 12).
                // External modules (kind === 'external') and unresolved
                // specifiers (kind === 'unresolved') yield resolvedPath
                // null; the original `source` string carries the
                // external identity downstream (artifact-converter
                // handles this in resolveImportTarget).
                const resolveResult = resolveModule(
                    source,
                    filePath,
                    ctx.options,
                    ctx.host,
                    ctx.cache,
                    ctx.workspaceRoot
                );
                const resolvedPath: string | null =
                    resolveResult.kind === 'resolved' && !resolveResult.isExternal
                        ? resolveResult.resolvedPath
                        : null;

                // Determine import kind based on specifiers
                const hasNamespaceImport = specifiers.some(s => s.name === '*');
                const importKind = hasNamespaceImport ? 'namespace' : 'es';

                // `import type` detection (erased at compile time, so a cycle
                // through only such edges is NOT a runtime import cycle):
                //  - whole-clause `import type {A}` / `import type X` =>
                //    `importClause.isTypeOnly === true`.
                //  - named clause where EVERY specifier is `type`-qualified
                //    (`import { type A, type B }`) and the list is non-empty.
                //  - MIXED (`import { type A, B }`) has a runtime binding => false.
                //  - default / namespace / plain named => false.
                const wholeClauseTypeOnly = !!node.importClause?.isTypeOnly;
                let allNamedAreType = false;
                const namedBindings = node.importClause?.namedBindings;
                if (namedBindings && ts.isNamedImports(namedBindings)) {
                    allNamedAreType =
                        namedBindings.elements.length > 0 &&
                        namedBindings.elements.every(el => el.isTypeOnly);
                }
                const typeOnly = wholeClauseTypeOnly || allNamedAreType;

                imports.push({
                    kind: importKind,
                    source,
                    resolvedPath,
                    specifiers,
                    typeOnly,
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

        // INTERFACE DECLARATIONS (export interface Foo { ... })
        else if (ts.isInterfaceDeclaration(node)) {
            const isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
            if (isExported && node.name) {
                exports.push({
                    type: 'named',
                    name: node.name.text,
                    loc: getLoc(node)
                });
            }
        }

        // TYPE ALIAS DECLARATIONS (export type Foo = ...)
        else if (ts.isTypeAliasDeclaration(node)) {
            const isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
            if (isExported && node.name) {
                exports.push({
                    type: 'named',
                    name: node.name.text,
                    loc: getLoc(node)
                });
            }
        }

        // ENTITIES (Functions, Classes, Variables that are const arrows)
        else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            let name = '';
            let kind: EntityKind = 'function';
            let isExported = false;

            if (ts.isFunctionDeclaration(node)) {
                name = node.name?.text || 'anonymous';
                kind = 'function';
                isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
                if (isExported && node.name) {
                    exports.push({
                        type: 'named',
                        name: node.name.text,
                        loc: getLoc(node)
                    });
                }
            } else if (ts.isClassDeclaration(node)) {
                name = node.name?.text || 'anonymous';
                kind = 'class';
                isExported = !!(node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword));
                if (isExported && node.name) {
                    exports.push({
                        type: 'named',
                        name: node.name.text,
                        loc: getLoc(node)
                    });
                }
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
                                const declSourceFile = decl.getSourceFile();
                                if (declSourceFile && declSourceFile.fileName) {
                                    // Use normalized relative path to workspace root
                                    const relPath = path.relative(workspaceRoot, declSourceFile.fileName).replace(/\\/g, '/');
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

    const fileId = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

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
