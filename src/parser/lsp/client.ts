import { ChildProcess, spawn } from 'child_process';
import { createMessageConnection, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';

/**
 * A generic LSP client that wraps a child process and exposes 
 * high-level methods for querying symbols and references.
 */
export class LspClient {
    private connection: MessageConnection | null = null;
    private process: ChildProcess | null = null;
    private isInitialized = false;

    constructor(private command: string, private args: string[]) { }

    public async start(): Promise<void> {
        if (this.process) return;

        this.process = spawn(this.command, this.args);

        this.connection = createMessageConnection(
            new StreamMessageReader(this.process.stdout!),
            new StreamMessageWriter(this.process.stdin!)
        );

        this.connection.listen();

        // Initialize
        await this.connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: {
                textDocument: {
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                    references: {}
                }
            }
        });

        this.connection.sendNotification('initialized');
        this.isInitialized = true;
    }

    public async stop(): Promise<void> {
        if (this.connection) {
            this.connection.dispose();
            this.connection = null;
        }
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.isInitialized = false;
    }

    public async openDocument(uri: string, languageId: string, version: number, text: string): Promise<void> {
        if (!this.connection) throw new Error('Client not started');
        await this.connection.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId,
                version,
                text
            }
        });
    }

    public async getDocumentSymbols(uri: string): Promise<any[]> {
        if (!this.connection) throw new Error('Client not started');
        return await this.connection.sendRequest('textDocument/documentSymbol', {
            textDocument: { uri }
        });
    }

    public async getReferences(uri: string, line: number, character: number): Promise<any[]> {
        if (!this.connection) throw new Error('Client not started');
        return await this.connection.sendRequest('textDocument/references', {
            textDocument: { uri },
            position: { line, character },
            context: { includeDeclaration: true }
        });
    }
}
