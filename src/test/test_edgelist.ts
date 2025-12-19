/**
 * Tests for Edge List functionality
 * 
 * Run with: npx ts-node src/test/test_edgelist.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { EdgeListStore, EdgeListData, NodeEntry, EdgeEntry } from '../graph/edgelist';
import { buildGraphsFromEdgeList } from '../graph/index';
import { prepareWebviewDataFromEdgeList } from '../graph/webview-data';

// ============================================================================
// Test Data - Mock Files
// ============================================================================

const MOCK_NODES: NodeEntry[] = [
    // File: src/parser/lexer.ts
    { id: 'src/parser/lexer.ts::Lexer', name: 'Lexer', kind: 'class', fileId: 'src/parser/lexer.ts' },
    { id: 'src/parser/lexer.ts::tokenize', name: 'tokenize', kind: 'function', fileId: 'src/parser/lexer.ts' },

    // File: src/parser/parser.ts
    { id: 'src/parser/parser.ts::Parser', name: 'Parser', kind: 'class', fileId: 'src/parser/parser.ts' },
    { id: 'src/parser/parser.ts::parse', name: 'parse', kind: 'method', fileId: 'src/parser/parser.ts' },

    // File: src/compiler/codegen.ts
    { id: 'src/compiler/codegen.ts::CodeGenerator', name: 'CodeGenerator', kind: 'class', fileId: 'src/compiler/codegen.ts' },
    { id: 'src/compiler/codegen.ts::emit', name: 'emit', kind: 'method', fileId: 'src/compiler/codegen.ts' },

    // File: src/main.ts
    { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' },
    { id: 'src/main.ts::compile', name: 'compile', kind: 'function', fileId: 'src/main.ts' },
];

const MOCK_EDGES: EdgeEntry[] = [
    // Import edges (file-level)
    { source: 'src/parser/parser.ts', target: 'src/parser/lexer.ts', kind: 'import' },
    { source: 'src/compiler/codegen.ts', target: 'src/parser/parser.ts', kind: 'import' },
    { source: 'src/main.ts', target: 'src/parser/parser.ts', kind: 'import' },
    { source: 'src/main.ts', target: 'src/compiler/codegen.ts', kind: 'import' },

    // Call edges (entity-level)
    { source: 'src/parser/parser.ts::parse', target: 'src/parser/lexer.ts::tokenize', kind: 'call' },
    { source: 'src/compiler/codegen.ts::emit', target: 'src/parser/parser.ts::parse', kind: 'call' },
    { source: 'src/main.ts::compile', target: 'src/parser/parser.ts::Parser', kind: 'call' },
    { source: 'src/main.ts::compile', target: 'src/compiler/codegen.ts::emit', kind: 'call' },
    { source: 'src/main.ts::main', target: 'src/main.ts::compile', kind: 'call' },
];

// ============================================================================
// Test Runner
// ============================================================================

async function runTests() {
    const results: { name: string; passed: boolean; error?: string }[] = [];
    const tempDir = path.join(process.cwd(), '.test-artifacts');

    // Setup
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Test 1: EdgeListStore basic operations
    results.push(await testEdgeListStoreBasics(tempDir));

    // Test 2: EdgeListStore persistence
    results.push(await testEdgeListStorePersistence(tempDir));

    // Test 3: EdgeListStore file update
    results.push(await testEdgeListStoreFileUpdate(tempDir));

    // Test 4: Build graphs from edge list
    results.push(await testBuildGraphsFromEdgeList());

    // Test 5: Prepare webview data from edge list
    results.push(await testPrepareWebviewData());

    // Test 6: Graph statistics
    results.push(await testGraphStatistics());

    // Cleanup
    try {
        fs.rmSync(tempDir, { recursive: true });
    } catch (e) {
        console.warn('Failed to cleanup temp dir:', e);
    }

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    let passed = 0;
    let failed = 0;

    for (const r of results) {
        if (r.passed) {
            console.log(`✅ ${r.name}`);
            passed++;
        } else {
            console.log(`❌ ${r.name}`);
            console.log(`   Error: ${r.error}`);
            failed++;
        }
    }

    console.log('='.repeat(60));
    console.log(`Passed: ${passed}/${results.length}, Failed: ${failed}`);
    console.log('='.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
}

// ============================================================================
// Individual Tests
// ============================================================================

async function testEdgeListStoreBasics(tempDir: string): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'EdgeListStore basic operations';
    try {
        const store = new EdgeListStore(tempDir);
        await store.load();

        // Should start empty
        if (store.getNodes().length !== 0) {
            return { name, passed: false, error: 'Expected 0 nodes initially' };
        }

        // Add nodes
        store.addNodes(MOCK_NODES);
        if (store.getNodes().length !== MOCK_NODES.length) {
            return { name, passed: false, error: `Expected ${MOCK_NODES.length} nodes` };
        }

        // Add edges
        store.addEdges(MOCK_EDGES);
        if (store.getEdges().length !== MOCK_EDGES.length) {
            return { name, passed: false, error: `Expected ${MOCK_EDGES.length} edges` };
        }

        // Should be dirty
        if (!store.isDirty()) {
            return { name, passed: false, error: 'Expected store to be dirty' };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

async function testEdgeListStorePersistence(tempDir: string): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'EdgeListStore persistence';
    try {
        // Create and populate store
        const store1 = new EdgeListStore(tempDir);
        await store1.load();
        store1.addNodes(MOCK_NODES);
        store1.addEdges(MOCK_EDGES);
        await store1.save();

        // Load in new store instance
        const store2 = new EdgeListStore(tempDir);
        await store2.load();

        if (store2.getNodes().length !== MOCK_NODES.length) {
            return { name, passed: false, error: `Expected ${MOCK_NODES.length} nodes after load, got ${store2.getNodes().length}` };
        }

        if (store2.getEdges().length !== MOCK_EDGES.length) {
            return { name, passed: false, error: `Expected ${MOCK_EDGES.length} edges after load, got ${store2.getEdges().length}` };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

async function testEdgeListStoreFileUpdate(tempDir: string): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'EdgeListStore file update';
    try {
        const store = new EdgeListStore(tempDir);
        await store.load();
        store.clear();
        store.addNodes(MOCK_NODES);
        store.addEdges(MOCK_EDGES);

        // Update a single file (simulate hot reload)
        const newNodes: NodeEntry[] = [
            { id: 'src/main.ts::main', name: 'main', kind: 'function', fileId: 'src/main.ts' },
            { id: 'src/main.ts::run', name: 'run', kind: 'function', fileId: 'src/main.ts' }, // New function
        ];
        const newEdges: EdgeEntry[] = [
            { source: 'src/main.ts', target: 'src/parser/parser.ts', kind: 'import' },
            { source: 'src/main.ts::main', target: 'src/main.ts::run', kind: 'call' }, // New edge
        ];

        store.updateFile('src/main.ts', newNodes, newEdges);

        // Check that old main.ts nodes are removed
        const mainNodes = store.getNodesByFile('src/main.ts');
        if (mainNodes.length !== 2) {
            return { name, passed: false, error: `Expected 2 nodes for main.ts, got ${mainNodes.length}` };
        }

        // Check that 'compile' is gone and 'run' exists
        const hasRun = mainNodes.some(n => n.name === 'run');
        const hasCompile = mainNodes.some(n => n.name === 'compile');
        if (!hasRun) {
            return { name, passed: false, error: 'Expected "run" function to exist' };
        }
        if (hasCompile) {
            return { name, passed: false, error: '"compile" function should have been removed' };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

async function testBuildGraphsFromEdgeList(): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'Build graphs from edge list';
    try {
        const data: EdgeListData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: MOCK_NODES,
            edges: MOCK_EDGES
        };

        const { importGraph, callGraph } = buildGraphsFromEdgeList(data);

        // Check import graph
        if (importGraph.nodes.size !== 4) { // 4 unique files
            return { name, passed: false, error: `Expected 4 file nodes, got ${importGraph.nodes.size}` };
        }

        const importEdgeCount = MOCK_EDGES.filter(e => e.kind === 'import').length;
        if (importGraph.edges.length !== importEdgeCount) {
            return { name, passed: false, error: `Expected ${importEdgeCount} import edges, got ${importGraph.edges.length}` };
        }

        // Check call graph
        if (callGraph.nodes.size !== MOCK_NODES.length) {
            return { name, passed: false, error: `Expected ${MOCK_NODES.length} entity nodes, got ${callGraph.nodes.size}` };
        }

        const callEdgeCount = MOCK_EDGES.filter(e => e.kind === 'call').length;
        if (callGraph.edges.length !== callEdgeCount) {
            return { name, passed: false, error: `Expected ${callEdgeCount} call edges, got ${callGraph.edges.length}` };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

async function testPrepareWebviewData(): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'Prepare webview data from edge list';
    try {
        const data: EdgeListData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: MOCK_NODES,
            edges: MOCK_EDGES
        };

        const webviewData = prepareWebviewDataFromEdgeList(data);

        // Check import graph visualization
        if (webviewData.importGraph.nodes.length !== 4) {
            return { name, passed: false, error: `Expected 4 import nodes, got ${webviewData.importGraph.nodes.length}` };
        }

        // Check that nodes have required vis.js properties
        const firstNode = webviewData.importGraph.nodes[0];
        if (!firstNode.id || !firstNode.label || !firstNode.group) {
            return { name, passed: false, error: 'Import node missing required properties (id, label, group)' };
        }

        // Check call graph visualization
        if (webviewData.callGraph.nodes.length !== MOCK_NODES.length) {
            return { name, passed: false, error: `Expected ${MOCK_NODES.length} call nodes, got ${webviewData.callGraph.nodes.length}` };
        }

        // Check edges
        if (webviewData.importGraph.edges.length !== 4) {
            return { name, passed: false, error: `Expected 4 import edges, got ${webviewData.importGraph.edges.length}` };
        }

        if (webviewData.callGraph.edges.length !== 5) {
            return { name, passed: false, error: `Expected 5 call edges, got ${webviewData.callGraph.edges.length}` };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

async function testGraphStatistics(): Promise<{ name: string; passed: boolean; error?: string }> {
    const name = 'Graph statistics';
    try {
        const store = new EdgeListStore(path.join(process.cwd(), '.test-artifacts'));
        await store.load();
        store.clear();
        store.addNodes(MOCK_NODES);
        store.addEdges(MOCK_EDGES);

        const stats = store.getStats();

        if (stats.nodes !== MOCK_NODES.length) {
            return { name, passed: false, error: `Expected ${MOCK_NODES.length} nodes, got ${stats.nodes}` };
        }

        if (stats.edges !== MOCK_EDGES.length) {
            return { name, passed: false, error: `Expected ${MOCK_EDGES.length} edges, got ${stats.edges}` };
        }

        if (stats.importEdges !== 4) {
            return { name, passed: false, error: `Expected 4 import edges, got ${stats.importEdges}` };
        }

        if (stats.callEdges !== 5) {
            return { name, passed: false, error: `Expected 5 call edges, got ${stats.callEdges}` };
        }

        return { name, passed: true };
    } catch (e: any) {
        return { name, passed: false, error: e.message };
    }
}

// ============================================================================
// Run
// ============================================================================

console.log('Edge List Tests');
console.log('='.repeat(60));
runTests().catch(e => {
    console.error('Test runner failed:', e);
    process.exit(1);
});
