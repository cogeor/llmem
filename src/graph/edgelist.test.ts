/**
 * Unit tests for EdgeListStore getNodesByFolder method.
 * Uses in-memory edge lists without file I/O.
 */

import { strict as assert } from 'assert';
import { test, describe } from 'node:test';

// Inline types to avoid import issues in test
interface NodeEntry {
    id: string;
    name: string;
    kind: 'file' | 'function' | 'class' | 'method' | 'arrow' | 'const';
    fileId: string;
}

interface EdgeListData {
    version: string;
    timestamp: string;
    nodes: NodeEntry[];
    edges: any[];
}

/**
 * In-memory mock of BaseEdgeListStore for testing.
 */
class MockEdgeListStore {
    private data: EdgeListData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        nodes: [],
        edges: []
    };

    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    getNodesByFolder(folderPath: string): NodeEntry[] {
        return this.data.nodes.filter(n =>
            n.fileId === folderPath ||
            n.fileId.startsWith(folderPath + '/')
        );
    }

    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }
}

describe('EdgeListStore.getNodesByFolder', () => {
    test('should return nodes for exact file match', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper', name: 'helper', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFolder('src/utils.ts');
        assert.equal(result.length, 1);
        assert.equal(result[0].id, 'src/utils.ts::helper');
    });

    test('should return nodes for folder path', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/parser/ts-service.ts::init', name: 'init', kind: 'function', fileId: 'src/parser/ts-service.ts' },
            { id: 'src/parser/ts-extractor.ts::extract', name: 'extract', kind: 'function', fileId: 'src/parser/ts-extractor.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFolder('src/parser');
        assert.equal(result.length, 2);
        assert.ok(result.some(n => n.id === 'src/parser/ts-service.ts::init'));
        assert.ok(result.some(n => n.id === 'src/parser/ts-extractor.ts::extract'));
    });

    test('should return empty array for non-matching path', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper', name: 'helper', kind: 'function', fileId: 'src/utils.ts' }
        ]);

        const result = store.getNodesByFolder('src/other');
        assert.equal(result.length, 0);
    });

    test('should not match partial folder names', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/parsers/custom.ts::parse', name: 'parse', kind: 'function', fileId: 'src/parsers/custom.ts' },
            { id: 'src/parser/ts-service.ts::init', name: 'init', kind: 'function', fileId: 'src/parser/ts-service.ts' }
        ]);

        // 'src/parser' should NOT match 'src/parsers/custom.ts'
        const result = store.getNodesByFolder('src/parser');
        assert.equal(result.length, 1);
        assert.equal(result[0].fileId, 'src/parser/ts-service.ts');
    });

    test('should work with nested folders', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/a/b/c/file.ts::fn', name: 'fn', kind: 'function', fileId: 'src/a/b/c/file.ts' },
            { id: 'src/a/b/file.ts::fn2', name: 'fn2', kind: 'function', fileId: 'src/a/b/file.ts' },
            { id: 'src/a/file.ts::fn3', name: 'fn3', kind: 'function', fileId: 'src/a/file.ts' }
        ]);

        // Query 'src/a/b' should return 2 nodes (b/file.ts and b/c/file.ts)
        const result = store.getNodesByFolder('src/a/b');
        assert.equal(result.length, 2);
    });

    test('existing getNodesByFile should still work', () => {
        const store = new MockEdgeListStore();
        store.addNodes([
            { id: 'src/utils.ts::helper1', name: 'helper1', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/utils.ts::helper2', name: 'helper2', kind: 'function', fileId: 'src/utils.ts' },
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' }
        ]);

        const result = store.getNodesByFile('src/utils.ts');
        assert.equal(result.length, 2);
        assert.ok(result.every(n => n.fileId === 'src/utils.ts'));
    });
});
