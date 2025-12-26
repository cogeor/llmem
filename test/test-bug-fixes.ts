/**
 * Test bug fixes:
 * 1. Hardcoded .ts extension in relative imports
 * 2. Call edges not rendered (filtered out by watchedFiles)
 */

import * as path from 'path';
import { PythonExtractor } from '../src/parser/python';
import { artifactToEdgeList } from '../src/graph/artifact-converter';
import { buildGraphsFromSplitEdgeLists } from '../src/graph/index';
import { EdgeListData } from '../src/graph/edgelist';

async function main() {
    console.log('=== Testing Bug Fixes ===\n');

    const testFile = path.join(__dirname, 'fixtures/sample.py');
    const extractor = new PythonExtractor(path.join(__dirname, '..'));

    // Extract and convert to edge list
    const artifact = await extractor.extract(testFile);
    if (!artifact) {
        console.error('Failed to extract artifact');
        process.exit(1);
    }

    const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, 'test/fixtures/sample.py');

    // Create edge list data structures
    const importData: EdgeListData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        nodes: nodes,
        edges: importEdges
    };

    const callData: EdgeListData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        nodes: nodes,
        edges: callEdges
    };

    console.log('--- Bug 1: Relative Import Extension ---');
    const relativeImports = importEdges.filter(e => e.target.startsWith('test/'));
    console.log(`Relative import edges: ${relativeImports.length}`);
    relativeImports.forEach(e => {
        const hasExtension = e.target.endsWith('.py') || e.target.endsWith('.ts');
        const correctExtension = e.target.endsWith('.py');
        console.log(`  ${e.source} → ${e.target}`);
        console.log(`    Has extension: ${hasExtension ? 'YES' : 'NO'}`);
        console.log(`    Correct (.py): ${correctExtension ? '✓' : '✗ (should be .py not .ts)'}`);
    });

    console.log('\n--- Bug 2: Call Edges Rendering ---');
    console.log(`Total call edges created: ${callEdges.length}`);
    console.log(`Call edges to external modules: ${callEdges.filter(e => !e.target.startsWith('test/')).length}`);

    // Test with watched files filter (simulates real usage)
    const watchedFiles = new Set(['test/fixtures/sample.py']);
    const { importGraph, callGraph } = buildGraphsFromSplitEdgeLists(importData, callData, watchedFiles);

    console.log(`\nAfter buildGraphsFromSplitEdgeLists (with watchedFiles filter):`);
    console.log(`  Import graph nodes: ${importGraph.nodes.size}`);
    console.log(`  Import graph edges: ${importGraph.edges.length}`);
    console.log(`  Call graph nodes: ${callGraph.nodes.size}`);
    console.log(`  Call graph edges: ${callGraph.edges.length}`);

    // Check for external module nodes in call graph
    const externalNodes = Array.from(callGraph.nodes.values()).filter(n =>
        !n.fileId.startsWith('test/')
    );
    console.log(`\n  External module nodes in call graph: ${externalNodes.length}`);
    externalNodes.forEach(n => {
        console.log(`    - ${n.id} (${n.kind})`);
    });

    // Check for edges to external modules
    const externalCallEdges = callGraph.edges.filter(e =>
        !e.target.startsWith('test/')
    );
    console.log(`\n  Call edges to external modules (rendered): ${externalCallEdges.length}`);
    externalCallEdges.slice(0, 10).forEach(e => {
        console.log(`    - ${e.source} → ${e.target}`);
    });

    console.log('\n--- Verification ---');

    // Bug 1: Check that relative imports have .py extension
    const wrongExtension = relativeImports.find(e => e.target.endsWith('.ts'));
    console.log(`✓ Bug 1 (Extension): ${wrongExtension ? '❌ FAILED - still uses .ts' : '✅ FIXED'}`);

    // Bug 2: Check that external module edges are rendered
    const hasExternalEdges = externalCallEdges.length > 0;
    const hasExternalNodes = externalNodes.length > 0;
    console.log(`✓ Bug 2 (Call Edges): ${hasExternalEdges && hasExternalNodes ? '✅ FIXED' : '❌ FAILED'}`);

    if (wrongExtension || !hasExternalEdges || !hasExternalNodes) {
        console.log('\n❌ Some tests failed!');
        process.exit(1);
    }

    console.log('\n✅ All bug fixes verified!');
}

main();
