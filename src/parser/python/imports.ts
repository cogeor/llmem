/**
 * Python Import Parser
 *
 * Parses Python import statements from tree-sitter AST nodes.
 * Handles:
 *   - import X
 *   - import X as Y
 *   - from X import Y
 *   - from X import Y as Z
 *   - from . import X (relative imports)
 *   - from ..package import X
 */

import type { SyntaxNode } from 'tree-sitter';
import { ImportSpec, Loc } from '../types';

export interface ImportBinding {
    /** The name used in code (alias if present, otherwise original name) */
    localName: string;
    /** The original imported name */
    importedName: string;
    /** The module path (e.g., "os", "pathlib", ".utils") */
    modulePath: string;
    /** Whether this is a relative import */
    isRelative: boolean;
    /** Number of dots for relative imports (1 = ".", 2 = "..", etc.) */
    relativeDots: number;
}

export class PythonImportParser {
    private importBindings: Map<string, ImportBinding> = new Map();

    /**
     * Parse all import statements from a tree-sitter root node.
     * Returns ImportSpec[] for the FileArtifact and populates internal binding map.
     */
    public parseImports(rootNode: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];
        this.importBindings.clear();

        this.walkNode(rootNode, (node) => {
            if (node.type === 'import_statement') {
                const parsed = this.parseImportStatement(node);
                if (parsed.length > 0) {
                    imports.push(...parsed);
                }
            } else if (node.type === 'import_from_statement') {
                const parsed = this.parseImportFromStatement(node);
                if (parsed) {
                    imports.push(parsed);
                }
            }
        });

        return imports;
    }

    /**
     * Get the import binding map for call resolution.
     * Key is the local name used in code.
     */
    public getBindings(): Map<string, ImportBinding> {
        return this.importBindings;
    }

    /**
     * Parse: import X, import X as Y, import X, Y, Z
     */
    private parseImportStatement(node: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];

        // import_statement children are dotted_name or aliased_import nodes
        for (const child of node.children) {
            if (child.type === 'dotted_name') {
                const moduleName = child.text;
                const localName = moduleName.split('.')[0]; // "import os.path" → local is "os"

                this.importBindings.set(localName, {
                    localName,
                    importedName: moduleName,
                    modulePath: moduleName,
                    isRelative: false,
                    relativeDots: 0
                });

                imports.push({
                    kind: 'es',
                    source: moduleName,
                    resolvedPath: null,
                    specifiers: [{ name: moduleName }],
                    loc: this.getLoc(node)
                });
            } else if (child.type === 'aliased_import') {
                const nameNode = child.childForFieldName('name');
                const aliasNode = child.childForFieldName('alias');

                if (nameNode) {
                    const moduleName = nameNode.text;
                    const alias = aliasNode?.text;
                    const localName = alias || moduleName.split('.')[0];

                    this.importBindings.set(localName, {
                        localName,
                        importedName: moduleName,
                        modulePath: moduleName,
                        isRelative: false,
                        relativeDots: 0
                    });

                    imports.push({
                        kind: 'es',
                        source: moduleName,
                        resolvedPath: null,
                        specifiers: [{ name: moduleName, alias }],
                        loc: this.getLoc(node)
                    });
                }
            }
        }

        return imports;
    }

    /**
     * Parse: from X import Y, from X import Y as Z, from . import X
     */
    private parseImportFromStatement(node: SyntaxNode): ImportSpec | null {
        // Find the module name (dotted_name or relative_import)
        let modulePath = '';
        let isRelative = false;
        let relativeDots = 0;

        const moduleNode = node.childForFieldName('module_name');
        if (moduleNode) {
            if (moduleNode.type === 'dotted_name') {
                modulePath = moduleNode.text;
            } else if (moduleNode.type === 'relative_import') {
                isRelative = true;
                // Count dots and get module name
                for (const child of moduleNode.children) {
                    if (child.type === 'import_prefix') {
                        relativeDots = child.text.length;
                    } else if (child.type === 'dotted_name') {
                        modulePath = child.text;
                    }
                }
                modulePath = '.'.repeat(relativeDots) + modulePath;
            }
        } else {
            // Handle case where module is directly in children
            for (const child of node.children) {
                if (child.type === 'dotted_name') {
                    modulePath = child.text;
                    break;
                } else if (child.type === 'relative_import' || child.text?.startsWith('.')) {
                    isRelative = true;
                    const text = child.text || '';
                    const match = text.match(/^(\.+)(.*)/);
                    if (match) {
                        relativeDots = match[1].length;
                        modulePath = text;
                    }
                }
            }
        }

        // Check for relative import dots at beginning
        if (!modulePath) {
            // Look for dots at beginning of statement (from . import x)
            let foundDots = 0;
            for (const child of node.children) {
                if (child.text === '.') {
                    foundDots++;
                } else if (child.type === 'dotted_name') {
                    modulePath = '.'.repeat(foundDots) + child.text;
                    isRelative = foundDots > 0;
                    relativeDots = foundDots;
                    break;
                } else if (child.text === 'import') {
                    if (foundDots > 0) {
                        modulePath = '.'.repeat(foundDots);
                        isRelative = true;
                        relativeDots = foundDots;
                    }
                    break;
                }
            }
        }

        if (!modulePath) {
            return null;
        }

        // Parse imported names
        const specifiers: Array<{ name: string; alias?: string }> = [];

        for (const child of node.children) {
            if (child.type === 'dotted_name' && child !== moduleNode) {
                // Simple import: from X import Y
                const name = child.text;
                specifiers.push({ name });

                this.importBindings.set(name, {
                    localName: name,
                    importedName: name,
                    modulePath,
                    isRelative,
                    relativeDots
                });
            } else if (child.type === 'aliased_import') {
                // Aliased import: from X import Y as Z
                const nameNode = child.childForFieldName('name');
                const aliasNode = child.childForFieldName('alias');

                if (nameNode) {
                    const name = nameNode.text;
                    const alias = aliasNode?.text;
                    const localName = alias || name;

                    specifiers.push({ name, alias });

                    this.importBindings.set(localName, {
                        localName,
                        importedName: name,
                        modulePath,
                        isRelative,
                        relativeDots
                    });
                }
            } else if (child.type === 'wildcard_import') {
                // from X import *
                specifiers.push({ name: '*' });
            }
        }

        if (specifiers.length === 0) {
            return null;
        }

        return {
            kind: 'es',
            source: modulePath,
            resolvedPath: null,
            specifiers,
            loc: this.getLoc(node)
        };
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
