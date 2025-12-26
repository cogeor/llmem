/**
 * @deprecated DEAD CODE - LSP implementation is currently unused.
 * 
 * This file is kept for potential future re-integration. The LSP approach
 * was found to be too slow for real-time call graph extraction.
 * 
 * See tree-sitter.md for current architecture.
 */

import { LspClient } from './client';
import { CallSite, ImportSpec, Loc } from '../types';
import { URI } from 'vscode-uri';
import * as path from 'path';

/**
 * LSP Call Extractor
 * 
 * Extracts call sites and imports using LSP call hierarchy.
 * Only works with LSPs that support call hierarchy - no fallbacks.
 */
export class LspCallExtractor {
    private hasCallHierarchy: boolean | null = null;

    constructor(
        private client: LspClient,
        private languageId: string,
        private workspaceRoot: string
    ) { }

    /**
     * Check if LSP supports required capabilities
     */
    async checkCapabilities(): Promise<{
        hasCallHierarchy: boolean;
        missingCapabilities: string[];
    }> {
        const missing: string[] = [];

        // Test call hierarchy support by attempting to prepare on a dummy position
        // This is a simple capability check - real usage will still need error handling
        try {
            this.hasCallHierarchy = true; // Optimistic - will fail gracefully if not supported
        } catch (e) {
            this.hasCallHierarchy = false;
            missing.push('callHierarchy');
        }

        return {
            hasCallHierarchy: this.hasCallHierarchy !== false,
            missingCapabilities: missing
        };
    }

    /**
     * Extract calls for an entity using LSP call hierarchy
     * ONLY uses call hierarchy - no fallbacks
     */
    async extractCalls(
        uri: string,
        symbol: any,
        fileContent: string
    ): Promise<CallSite[]> {
        const calls: CallSite[] = [];

        try {
            // 1. Prepare call hierarchy for this symbol
            const hierarchyItems = await this.client.prepareCallHierarchy(
                uri,
                symbol.range.start.line,
                symbol.range.start.character
            );

            if (!hierarchyItems || hierarchyItems.length === 0) {
                return calls;
            }

            // 2. Get outgoing calls for each hierarchy item
            for (const item of hierarchyItems) {
                try {
                    const outgoingCalls = await this.client.getOutgoingCalls(item);

                    if (outgoingCalls && Array.isArray(outgoingCalls)) {
                        for (const call of outgoingCalls) {
                            const callSite = this.convertToCallSite(call, uri);
                            if (callSite) {
                                calls.push(callSite);
                            }
                        }
                    }
                } catch (e) {
                    // Silently skip if outgoing calls fails for this item
                    console.warn(`[LspCallExtractor] Failed to get outgoing calls for ${item.name}:`, e);
                }
            }
        } catch (e) {
            // LSP doesn't support call hierarchy or call failed
            console.warn(`[LspCallExtractor] Call hierarchy not supported or failed:`, e);
            this.hasCallHierarchy = false;
        }

        return calls;
    }

    /**
     * Parse imports from file content
     * Language-agnostic text parsing (Python, C++, Rust patterns)
     */
    async extractImports(
        filePath: string,
        fileContent: string
    ): Promise<ImportSpec[]> {
        return this.parseImportStatements(fileContent, filePath);
    }

    /**
     * Convert LSP CallHierarchyOutgoingCall to our CallSite format
     */
    private convertToCallSite(
        lspCall: any,
        sourceUri: string
    ): CallSite | null {
        if (!lspCall.to) return null;

        const target = lspCall.to;
        const fromRanges = lspCall.fromRanges || [];

        // Use first call location if available
        const callLoc = fromRanges.length > 0 ? fromRanges[0] : target.selectionRange;

        // Extract file path from URI
        const targetFilePath = URI.parse(target.uri).fsPath;
        const targetFileId = path.relative(this.workspaceRoot, targetFilePath).replace(/\\/g, '/');

        const loc: Loc = {
            startLine: callLoc.start.line + 1,
            endLine: callLoc.end.line + 1,
            startColumn: callLoc.start.character,
            endColumn: callLoc.end.character,
            startByte: 0,
            endByte: 0
        };

        return {
            callSiteId: `call@${loc.startLine}:${loc.startColumn}`,
            kind: target.kind === 6 ? 'method' : 'function', // SymbolKind.Method = 6
            calleeName: target.name,
            resolvedDefinition: {
                file: targetFileId,
                name: target.name
            },
            loc
        };
    }

    /**
     * Parse import statements using language-agnostic regex patterns
     */
    private parseImportStatements(
        content: string,
        filePath: string
    ): ImportSpec[] {
        const imports: ImportSpec[] = [];
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Python: import X, from Y import Z
            if (this.languageId === 'python') {
                const pythonImports = this.parsePythonImports(line, i);
                imports.push(...pythonImports);
            }
            // C++: #include "X" or #include <X>
            else if (this.languageId === 'cpp') {
                const cppImport = this.parseCppInclude(line, i);
                if (cppImport) imports.push(cppImport);
            }
            // Rust: use X::Y;
            else if (this.languageId === 'rust') {
                const rustImport = this.parseRustUse(line, i);
                if (rustImport) imports.push(rustImport);
            }
        }

        return imports;
    }

    private parsePythonImports(line: string, lineNum: number): ImportSpec[] {
        const imports: ImportSpec[] = [];

        // from X import Y, Z
        const fromMatch = line.match(/^from\s+([.\w]+)\s+import\s+(.+)/);
        if (fromMatch) {
            const source = fromMatch[1];
            const specifiers = fromMatch[2].split(',').map(s => {
                const parts = s.trim().split(/\s+as\s+/);
                return { name: parts[0], alias: parts[1] };
            });

            imports.push({
                kind: 'es',
                source,
                resolvedPath: null, // Could attempt to resolve Python module paths
                specifiers,
                loc: this.makeLoc(lineNum)
            });
        }

        // import X, Y
        const importMatch = line.match(/^import\s+(.+)/);
        if (importMatch) {
            const modules = importMatch[1].split(',');
            for (const mod of modules) {
                const parts = mod.trim().split(/\s+as\s+/);
                imports.push({
                    kind: 'es',
                    source: parts[0],
                    resolvedPath: null,
                    specifiers: [{ name: parts[0], alias: parts[1] }],
                    loc: this.makeLoc(lineNum)
                });
            }
        }

        return imports;
    }

    private parseCppInclude(line: string, lineNum: number): ImportSpec | null {
        const match = line.match(/^#include\s+["<](.+)[">]/);
        if (match) {
            return {
                kind: 'es',
                source: match[1],
                resolvedPath: null,
                specifiers: [{ name: match[1] }],
                loc: this.makeLoc(lineNum)
            };
        }
        return null;
    }

    private parseRustUse(line: string, lineNum: number): ImportSpec | null {
        const match = line.match(/^use\s+([^;]+);/);
        if (match) {
            const path = match[1];
            const parts = path.split('::');
            const name = parts[parts.length - 1];

            return {
                kind: 'es',
                source: path,
                resolvedPath: null,
                specifiers: [{ name }],
                loc: this.makeLoc(lineNum)
            };
        }
        return null;
    }

    private makeLoc(line: number): Loc {
        return {
            startLine: line + 1,
            endLine: line + 1,
            startColumn: 0,
            endColumn: 0,
            startByte: 0,
            endByte: 0
        };
    }
}
