/**
 * @deprecated DEAD CODE - LSP implementation is currently unused.
 * 
 * This file is kept for potential future re-integration. The LSP approach
 * was found to be too slow for real-time call graph extraction.
 * 
 * Current implementation uses:
 * - TypeScript Compiler API for TS/JS (full imports + calls)
 * - Tree-sitter for Python, C++, Rust, R (imports only)
 * 
 * See tree-sitter.md for current architecture.
 */

import * as path from 'path';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, Loc } from '../types';
import { LspClient } from './client';
import { LspCallExtractor } from './lsp-call-extractor';
import { URI } from 'vscode-uri';

export class LspExtractor implements ArtifactExtractor {
    private client: LspClient;
    private languageId: string;
    private callExtractor: LspCallExtractor | null = null;
    private workspaceRoot: string;

    constructor(command: string, args: string[], languageId: string, workspaceRoot?: string) {
        this.client = new LspClient(command, args);
        this.languageId = languageId;
        this.workspaceRoot = workspaceRoot || process.cwd();
    }

    public async start() {
        await this.client.start();
    }

    public async stop() {
        await this.client.stop();
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        await this.start(); // Ensure started

        // Read content if not provided
        let fileContent = content;
        if (!fileContent) {
            // In a real scenario, we might read from disk, but LSP usually handles "didOpen"
            // For now assume we pass it or read it.
            // Note: fs read is async.
            const fs = await import('fs/promises');
            try {
                fileContent = await fs.readFile(filePath, 'utf-8');
            } catch (e) {
                return null;
            }
        }

        const uri = URI.file(filePath).toString();

        // Open doc
        await this.client.openDocument(uri, this.languageId, 1, fileContent!);

        // Get symbols
        const symbols = await this.client.getDocumentSymbols(uri);

        // Convert symbols to FileArtifact
        // This is the CRITICAL part where we need parity with ts-extractor
        const artifact: FileArtifact = {
            schemaVersion: "lsp-graph-v1",
            file: {
                id: filePath,
                path: filePath,
                language: this.languageId
            },
            imports: [],
            exports: [],
            entities: []
        };

        // Initialize call extractor if not done
        if (!this.callExtractor) {
            this.callExtractor = new LspCallExtractor(
                this.client,
                this.languageId,
                this.workspaceRoot
            );

            // Check capabilities
            const caps = await this.callExtractor.checkCapabilities();
            if (!caps.hasCallHierarchy) {
                console.warn(`[LspExtractor] LSP for ${this.languageId} does not support call hierarchy`);
                console.warn(`[LspExtractor] Missing capabilities: ${caps.missingCapabilities.join(', ')}`);
                console.warn(`[LspExtractor] Call graphs will not be available for ${this.languageId} files`);
                this.callExtractor = null;
            }
        }

        // Extract imports
        if (this.callExtractor) {
            artifact.imports = await this.callExtractor.extractImports(filePath, fileContent);
        }

        const processSymbol = async (sym: any) => {
            // SymbolKind: Function = 12, Class = 5, Method = 6
            // We map generic LSP kinds to our EntityKind
            let kind: any = 'function';
            if (sym.kind === 5) kind = 'class';
            else if (sym.kind === 6) kind = 'method';
            else if (sym.kind === 12) kind = 'function';
            else return; // Skip others for now

            // Location
            const range = sym.range || sym.location.range;
            const loc: Loc = {
                startLine: range.start.line + 1,
                endLine: range.end.line + 1,
                startColumn: range.start.character,
                endColumn: range.end.character,
                startByte: 0, // We'd need to calculate byte offsets from line/col if strictly needed
                endByte: 0
            };

            // Signature extraction
            // Most LSPs provide 'detail' which is often the signature
            let signature = sym.detail || sym.name;
            // Better: Extract the actual text from fileContent using the range !
            if (fileContent) {
                // We can slice the lines.
                // Simple version: just take the first line of the definition
                const lines = fileContent.split('\n');
                if (lines[range.start.line]) {
                    signature = lines[range.start.line].trim();
                    if (!signature.includes(sym.name)) {
                        // If the line doesn't contain the name (e.g. decorator), maybe look around
                    }
                }
            }

            const entity: Entity = {
                id: `${sym.name}-${range.start.line}`,
                kind,
                name: sym.name,
                isExported: false,
                loc,
                signature,
                calls: []  // Will be populated below if call extractor available
            };

            // Extract calls for this entity if call extractor is available
            if (this.callExtractor) {
                try {
                    entity.calls = await this.callExtractor.extractCalls(uri, sym, fileContent);
                } catch (e) {
                    console.warn(`[LspExtractor] Failed to extract calls for ${sym.name}:`, e);
                    entity.calls = [];
                }
            }

            artifact.entities.push(entity);

            if (sym.children) {
                for (const child of sym.children) {
                    await processSymbol(child);
                }
            }
        };

        if (Array.isArray(symbols)) {
            for (const sym of symbols) {
                await processSymbol(sym);
            }
        }

        return artifact;
    }
}
