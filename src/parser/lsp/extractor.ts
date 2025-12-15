import * as path from 'path';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact, Entity, Loc } from '../types';
import { LspClient } from './client';
import { URI } from 'vscode-uri';

export class LspExtractor implements ArtifactExtractor {
    private client: LspClient;
    private languageId: string;

    constructor(command: string, args: string[], languageId: string) {
        this.client = new LspClient(command, args);
        this.languageId = languageId;
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
                id: filePath, // Should be relative usually, but extractor receives absolute
                path: filePath,
                language: this.languageId
            },
            imports: [], // LSP doesn't genericall give imports easily without exploring AST usually
            exports: [], // Can deduce from symbols if they are "exported" (some LSPs provide tags)
            entities: []
        };

        const processSymbol = (sym: any) => {
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
                isExported: false, // Hard to tell from generic LSP
                loc,
                signature,
                calls: [] // Generic LSP doesn't give call graph inside a function easily without "outgoing calls" support
            };

            artifact.entities.push(entity);

            if (sym.children) {
                sym.children.forEach(processSymbol);
            }
        };

        if (Array.isArray(symbols)) {
            symbols.forEach(processSymbol);
        }

        return artifact;
    }
}
