
import * as assert from 'assert';
import { LspExtractor } from '../parser/lsp/extractor';
import { FileArtifact } from '../parser/types';
import { LspClient } from '../parser/lsp/client';

// Mock Client
class MockLspClient extends LspClient {
    constructor() {
        super('echo', []);
    }
    async start() { }
    async stop() { }
    async openDocument() { }

    async getDocumentSymbols(uri: string): Promise<any[]> {
        // Return structured mock data resembling real LSP output
        return [
            {
                name: 'MyClass',
                kind: 5, // Class
                range: { start: { line: 0, character: 0 }, end: { line: 2, character: 12 } },
                children: [
                    {
                        name: 'myMethod',
                        kind: 6, // Method
                        range: { start: { line: 1, character: 4 }, end: { line: 1, character: 23 } },
                        detail: 'void myMethod()'
                    }
                ]
            },
            {
                name: 'globalFunction',
                kind: 12, // Function
                range: { start: { line: 8, character: 0 }, end: { line: 9, character: 18 } }
            }
        ];
    }
}

// Subclass Extractor to inject mock client
class TestableLspExtractor extends LspExtractor {
    constructor() {
        super('echo', [], 'python');
        (this as any).client = new MockLspClient();
    }
}

async function runTest() {
    console.log('Running LSP Parity Test...');

    // Mock file content for signature extraction
    const mockContent = `class MyClass:
    def myMethod(self):
        pass

# Some comments

# ...

def globalFunction():
    print("hello")
`;

    const extractor = new TestableLspExtractor();
    const artifact = await extractor.extract('/tmp/test.py', mockContent);

    if (!artifact) {
        console.error('FAILED: Artifact is null');
        process.exit(1);
    }

    // Verify Schema
    assert.strictEqual(artifact.schemaVersion, 'lsp-graph-v1');
    assert.strictEqual(artifact.file.language, 'python');

    // Verify Entities
    assert.strictEqual(artifact.entities.length, 3); // Class, Method, Function

    const cls = artifact.entities.find(e => e.name === 'MyClass');
    assert.ok(cls, 'Class entity not found');
    assert.strictEqual(cls.kind, 'class');
    // Signature Check: Should extract first line
    assert.strictEqual(cls.signature, 'class MyClass:');

    const method = artifact.entities.find(e => e.name === 'myMethod');
    assert.ok(method, 'Method entity not found');
    assert.strictEqual(method.kind, 'method');
    // Signature Check
    assert.strictEqual(method.signature?.trim(), 'def myMethod(self):');

    const func = artifact.entities.find(e => e.name === 'globalFunction');
    assert.ok(func, 'Function entity not found');
    assert.strictEqual(func.kind, 'function');
    assert.strictEqual(func.signature, 'def globalFunction():');

    console.log('PASSED: LSP Extractor produces correct artifact structure.');
}

runTest().catch(e => {
    console.error('Test Failed:', e);
    process.exit(1);
});
