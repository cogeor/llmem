/**
 * Graph System Integration Tests
 *
 * Tests the full graph building pipeline:
 * - TypeScript extraction → edge lists → graph building → webview data
 *
 * Uses real TypeScript files in a temp workspace.
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ImportEdgeListStore, CallEdgeListStore } from './edgelist';
import { buildGraphsFromSplitEdgeLists } from './index';
import { prepareWebviewDataFromSplitEdgeLists } from './webview-data';
import { artifactToEdgeList } from './artifact-converter';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestWorkspace {
    root: string;
    artifactDir: string;
    cleanup: () => void;
}

/**
 * Create a temporary workspace with sample TypeScript files
 */
function createTestWorkspace(): TestWorkspace {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-graph-test-'));
    const artifactDir = path.join(root, '.artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });

    // Create src directory
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create utils.ts - utility module
    fs.writeFileSync(path.join(srcDir, 'utils.ts'), `
/**
 * Utility functions
 */

export function formatName(first: string, last: string): string {
    return \`\${first} \${last}\`;
}

export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export const PI = 3.14159;
`.trim());

    // Create math.ts - math module that imports utils
    fs.writeFileSync(path.join(srcDir, 'math.ts'), `
/**
 * Math utilities
 */

import { PI } from './utils';

export function circleArea(radius: number): number {
    return PI * radius * radius;
}

export function square(n: number): number {
    return n * n;
}

export class Calculator {
    private value: number = 0;

    add(n: number): this {
        this.value += n;
        return this;
    }

    multiply(n: number): this {
        this.value *= n;
        return this;
    }

    getResult(): number {
        return this.value;
    }
}
`.trim());

    // Create main.ts - imports both modules
    fs.writeFileSync(path.join(srcDir, 'main.ts'), `
/**
 * Main entry point
 */

import { formatName, capitalize } from './utils';
import { circleArea, Calculator } from './math';

export function greet(first: string, last: string): string {
    const name = formatName(first, last);
    return \`Hello, \${capitalize(name)}!\`;
}

export function computeCircle(radius: number): { area: number } {
    return { area: circleArea(radius) };
}

export function calculate(): number {
    const calc = new Calculator();
    return calc.add(5).multiply(3).getResult();
}
`.trim());

    // Create tsconfig.json
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            outDir: './dist'
        },
        include: ['src/**/*']
    }, null, 2));

    return {
        root,
        artifactDir,
        cleanup: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

// ============================================================================
// Edge List Store Tests
// ============================================================================

describe('EdgeListStore Integration', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('ImportEdgeListStore persists and loads data', async () => {
        const store = new ImportEdgeListStore(workspace.artifactDir);

        // Add some nodes and edges
        store.addNode({ id: 'src/main.ts', name: 'main.ts', kind: 'file', fileId: 'src/main.ts' });
        store.addNode({ id: 'src/utils.ts', name: 'utils.ts', kind: 'file', fileId: 'src/utils.ts' });
        store.addEdge({ source: 'src/main.ts', target: 'src/utils.ts', kind: 'import' });

        // Save
        await store.save();

        // Load into new instance
        const store2 = new ImportEdgeListStore(workspace.artifactDir);
        await store2.load();

        const nodes = store2.getNodes();
        const edges = store2.getEdges();

        assert.equal(nodes.length, 2, 'Should have 2 nodes');
        assert.equal(edges.length, 1, 'Should have 1 edge');
        assert.equal(edges[0].source, 'src/main.ts');
        assert.equal(edges[0].target, 'src/utils.ts');
    });

    test('CallEdgeListStore persists and loads data', async () => {
        const store = new CallEdgeListStore(workspace.artifactDir);

        // Add function nodes and call edges
        store.addNode({ id: 'src/main.ts::greet', name: 'greet', kind: 'function', fileId: 'src/main.ts' });
        store.addNode({ id: 'src/utils.ts::formatName', name: 'formatName', kind: 'function', fileId: 'src/utils.ts' });
        store.addEdge({ source: 'src/main.ts::greet', target: 'src/utils.ts::formatName', kind: 'call' });

        await store.save();

        const store2 = new CallEdgeListStore(workspace.artifactDir);
        await store2.load();

        const nodes = store2.getNodes();
        const edges = store2.getEdges();

        assert.equal(nodes.length, 2);
        assert.equal(edges.length, 1);
        assert.equal(edges[0].kind, 'call');
    });

    test('removeByFolder removes nodes and edges for folder', async () => {
        const store = new ImportEdgeListStore(workspace.artifactDir);

        store.addNode({ id: 'src/parser/a.ts', name: 'a.ts', kind: 'file', fileId: 'src/parser/a.ts' });
        store.addNode({ id: 'src/parser/b.ts', name: 'b.ts', kind: 'file', fileId: 'src/parser/b.ts' });
        store.addNode({ id: 'src/main.ts', name: 'main.ts', kind: 'file', fileId: 'src/main.ts' });
        store.addEdge({ source: 'src/parser/a.ts', target: 'src/parser/b.ts', kind: 'import' });
        store.addEdge({ source: 'src/main.ts', target: 'src/parser/a.ts', kind: 'import' });

        // Remove everything in src/parser
        store.removeByFolder('src/parser');

        const nodes = store.getNodes();
        const edges = store.getEdges();

        // Should only have main.ts left
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].id, 'src/main.ts');

        // Edge from main.ts still exists (it references parser, but source is main.ts)
        assert.equal(edges.length, 1);
    });
});

// ============================================================================
// TypeScript Extraction → Graph Building Tests
// ============================================================================

describe('TypeScript Extraction to Graph Pipeline', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('extracts imports and calls from TypeScript files', async () => {
        const tsService = new TypeScriptService(workspace.root);
        const extractor = new TypeScriptExtractor(() => tsService.getProgram(), workspace.root);

        // Extract from main.ts
        const mainPath = path.join(workspace.root, 'src', 'main.ts');
        const artifact = await extractor.extract(mainPath);

        assert.ok(artifact, 'Should extract artifact from main.ts');
        assert.equal(artifact.file.language, 'typescript');

        // Check imports
        assert.ok(artifact.imports.length >= 2, 'main.ts should import from utils and math');

        const utilsImport = artifact.imports.find(i => i.resolvedPath?.includes('utils'));
        assert.ok(utilsImport, 'Should have import from utils');

        const mathImport = artifact.imports.find(i => i.resolvedPath?.includes('math'));
        assert.ok(mathImport, 'Should have import from math');

        // Check entities
        const greetFn = artifact.entities.find(e => e.name === 'greet');
        assert.ok(greetFn, 'Should have greet function');
        assert.equal(greetFn.kind, 'function');

        // Check calls (greet calls formatName and capitalize)
        assert.ok(greetFn.calls && greetFn.calls.length >= 2, 'greet should have calls to formatName and capitalize');
    });

    test('builds graph from extracted artifacts', async () => {
        const tsService = new TypeScriptService(workspace.root);
        const extractor = new TypeScriptExtractor(() => tsService.getProgram(), workspace.root);

        const importStore = new ImportEdgeListStore(workspace.artifactDir);
        const callStore = new CallEdgeListStore(workspace.artifactDir);

        // Extract all files
        const files = ['src/utils.ts', 'src/math.ts', 'src/main.ts'];
        for (const file of files) {
            const fullPath = path.join(workspace.root, file);
            const artifact = await extractor.extract(fullPath);
            if (artifact) {
                const fileId = file.replace(/\\/g, '/');
                const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, fileId);
                importStore.addNodes(nodes);
                importStore.addEdges(importEdges);
                callStore.addNodes(nodes);
                callStore.addEdges(callEdges);
            }
        }

        // Build graphs
        const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(
            importStore.getData(),
            callStore.getData()
        );

        // Check import graph
        assert.ok(importGraph.nodes.size >= 3, 'Should have at least 3 file nodes');
        assert.ok(importGraph.edges.length >= 2, 'Should have import edges');

        // main.ts imports utils.ts
        const mainToUtils = importGraph.edges.find(
            e => e.source.includes('main') && e.target.includes('utils')
        );
        assert.ok(mainToUtils, 'Should have edge from main to utils');

        // Check call graph
        assert.ok(callGraph.nodes.size > 0, 'Should have function nodes');
        assert.ok(callGraph.edges.length > 0, 'Should have call edges');
    });

    test('prepares webview data from split edge lists', async () => {
        const tsService = new TypeScriptService(workspace.root);
        const extractor = new TypeScriptExtractor(() => tsService.getProgram(), workspace.root);

        const importStore = new ImportEdgeListStore(workspace.artifactDir);
        const callStore = new CallEdgeListStore(workspace.artifactDir);

        // Extract all files
        const files = ['src/utils.ts', 'src/math.ts', 'src/main.ts'];
        for (const file of files) {
            const fullPath = path.join(workspace.root, file);
            const artifact = await extractor.extract(fullPath);
            if (artifact) {
                const fileId = file.replace(/\\/g, '/');
                const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, fileId);
                importStore.addNodes(nodes);
                importStore.addEdges(importEdges);
                callStore.addNodes(nodes);
                callStore.addEdges(callEdges);
            }
        }

        // Prepare webview data
        const webviewData = prepareWebviewDataFromSplitEdgeLists(
            importStore.getData(),
            callStore.getData()
        );

        // Check structure
        assert.ok(webviewData.importGraph, 'Should have import graph');
        assert.ok(webviewData.callGraph, 'Should have call graph');

        // Check import graph vis data
        assert.ok(webviewData.importGraph.nodes.length >= 3, 'Should have file nodes');
        assert.ok(webviewData.importGraph.edges.length >= 2, 'Should have import edges');

        // Each node should have required fields
        for (const node of webviewData.importGraph.nodes) {
            assert.ok(node.id, 'Node should have id');
            assert.ok(node.label, 'Node should have label');
            assert.ok(node.group, 'Node should have group');
        }

        // Each edge should have required fields
        for (const edge of webviewData.importGraph.edges) {
            assert.ok(edge.from, 'Edge should have from');
            assert.ok(edge.to, 'Edge should have to');
        }

        // Check call graph vis data
        assert.ok(webviewData.callGraph.nodes.length > 0, 'Should have function nodes');
        for (const node of webviewData.callGraph.nodes) {
            assert.ok(node.id, 'Call node should have id');
            assert.ok(node.label, 'Call node should have label');
        }
    });
});

// ============================================================================
// Watched Files Filter Tests
// ============================================================================

describe('Graph Building with Watched Files Filter', () => {
    test('filters nodes and edges by watched files', () => {
        // Create test data
        const importData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [
                { id: 'src/a.ts', name: 'a.ts', kind: 'file' as const, fileId: 'src/a.ts' },
                { id: 'src/b.ts', name: 'b.ts', kind: 'file' as const, fileId: 'src/b.ts' },
                { id: 'src/c.ts', name: 'c.ts', kind: 'file' as const, fileId: 'src/c.ts' },
            ],
            edges: [
                { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' as const },
                { source: 'src/b.ts', target: 'src/c.ts', kind: 'import' as const },
                { source: 'src/a.ts', target: 'src/c.ts', kind: 'import' as const },
            ],
        };

        const callData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [
                { id: 'src/a.ts::fnA', name: 'fnA', kind: 'function' as const, fileId: 'src/a.ts' },
                { id: 'src/b.ts::fnB', name: 'fnB', kind: 'function' as const, fileId: 'src/b.ts' },
                { id: 'src/c.ts::fnC', name: 'fnC', kind: 'function' as const, fileId: 'src/c.ts' },
            ],
            edges: [
                { source: 'src/a.ts::fnA', target: 'src/b.ts::fnB', kind: 'call' as const },
                { source: 'src/b.ts::fnB', target: 'src/c.ts::fnC', kind: 'call' as const },
            ],
        };

        // Only watch a.ts and b.ts
        const watchedFiles = new Set(['src/a.ts', 'src/b.ts']);

        const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(
            importData,
            callData,
            watchedFiles
        );

        // Import graph should only have a.ts and b.ts nodes
        assert.equal(importGraph.nodes.size, 2, 'Should only have 2 import nodes');
        assert.ok(importGraph.nodes.has('src/a.ts'));
        assert.ok(importGraph.nodes.has('src/b.ts'));
        assert.ok(!importGraph.nodes.has('src/c.ts'), 'Should not have c.ts');

        // Import edges: only a->b (b->c and a->c filtered because c not watched)
        assert.equal(importGraph.edges.length, 1, 'Should only have 1 import edge');
        assert.equal(importGraph.edges[0].source, 'src/a.ts');
        assert.equal(importGraph.edges[0].target, 'src/b.ts');

        // Call graph: only fnA and fnB
        assert.equal(callGraph.nodes.size, 2, 'Should only have 2 call nodes');
        assert.ok(callGraph.nodes.has('src/a.ts::fnA'));
        assert.ok(callGraph.nodes.has('src/b.ts::fnB'));

        // Call edges: only fnA->fnB
        assert.equal(callGraph.edges.length, 1, 'Should only have 1 call edge');
    });

    test('includes external module targets in import graph', () => {
        const importData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [
                { id: 'src/main.ts', name: 'main.ts', kind: 'file' as const, fileId: 'src/main.ts' },
            ],
            edges: [
                { source: 'src/main.ts', target: 'lodash', kind: 'import' as const },
                { source: 'src/main.ts', target: 'react', kind: 'import' as const },
            ],
        };

        const callData = { version: '1.0.0', timestamp: '', nodes: [], edges: [] };

        const watchedFiles = new Set(['src/main.ts']);

        const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData, watchedFiles);

        // Should include external modules (lodash, react) even though not in watched files
        assert.ok(importGraph.nodes.has('lodash'), 'Should have lodash node');
        assert.ok(importGraph.nodes.has('react'), 'Should have react node');
        assert.equal(importGraph.edges.length, 2, 'Should have edges to external modules');
    });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Graph Building Edge Cases', () => {
    test('handles empty edge lists', () => {
        const emptyData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [],
            edges: [],
        };

        const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(emptyData, emptyData);

        assert.equal(importGraph.nodes.size, 0);
        assert.equal(importGraph.edges.length, 0);
        assert.equal(callGraph.nodes.size, 0);
        assert.equal(callGraph.edges.length, 0);
    });

    test('handles nodes without edges', () => {
        const importData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [
                { id: 'src/standalone.ts', name: 'standalone.ts', kind: 'file' as const, fileId: 'src/standalone.ts' },
            ],
            edges: [],
        };

        const callData = { version: '1.0.0', timestamp: '', nodes: [], edges: [] };

        const { importGraph } = buildGraphsFromSplitEdgeLists(importData, callData);

        assert.equal(importGraph.nodes.size, 1);
        assert.equal(importGraph.edges.length, 0);
    });

    test('deduplicates edges', () => {
        const importData = {
            version: '1.0.0',
            timestamp: new Date().toISOString(),
            nodes: [
                { id: 'src/a.ts', name: 'a.ts', kind: 'file' as const, fileId: 'src/a.ts' },
                { id: 'src/b.ts', name: 'b.ts', kind: 'file' as const, fileId: 'src/b.ts' },
            ],
            edges: [
                { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' as const },
                { source: 'src/a.ts', target: 'src/b.ts', kind: 'import' as const }, // duplicate
            ],
        };

        const store = new ImportEdgeListStore(os.tmpdir());
        store.addEdges(importData.edges);

        // Store should deduplicate
        assert.equal(store.getEdges().length, 1);
    });
});
