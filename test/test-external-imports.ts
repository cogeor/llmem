/**
 * Test external module imports and class calls
 * Verifies that imported classes create proper nodes and edges
 */

import * as path from 'path';
import * as fs from 'fs';
import { PythonExtractor } from '../src/parser/python';
import { artifactToEdgeList } from '../src/graph/artifact-converter';

async function main() {
    const testFile = path.join(__dirname, 'fixtures/sample.py');
    const extractor = new PythonExtractor(path.join(__dirname, '..'));

    console.log('=== Testing External Module Imports ===\n');

    const artifact = await extractor.extract(testFile);
    if (!artifact) {
        console.error('Failed to extract artifact');
        process.exit(1);
    }

    const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, 'test/fixtures/sample.py');

    console.log('--- Nodes Created ---');
    console.log(`Total nodes: ${nodes.length}\n`);

    // Group nodes by type
    const fileNodes = nodes.filter(n => n.kind === 'file');
    const classNodes = nodes.filter(n => n.kind === 'class');
    const functionNodes = nodes.filter(n => n.kind === 'function');
    const methodNodes = nodes.filter(n => n.kind === 'method');

    console.log(`File nodes (${fileNodes.length}):`);
    fileNodes.forEach(n => console.log(`  - ${n.id} (${n.name})`));

    console.log(`\nClass nodes (${classNodes.length}):`);
    classNodes.forEach(n => console.log(`  - ${n.id}`));

    console.log(`\nFunction nodes (${functionNodes.length}):`);
    functionNodes.forEach(n => console.log(`  - ${n.id}`));

    console.log(`\n--- Import Edges ---`);
    console.log(`Total import edges: ${importEdges.length}\n`);
    importEdges.forEach(e => {
        console.log(`  ${e.source} → ${e.target}`);
    });

    console.log(`\n--- Call Edges (to external modules) ---`);
    const externalCalls = callEdges.filter(e => {
        const target = e.target;
        return target.includes('::') && !target.startsWith('test/');
    });
    console.log(`External call edges: ${externalCalls.length}\n`);
    externalCalls.forEach(e => {
        console.log(`  ${e.source} → ${e.target}`);
    });

    console.log(`\n--- Verification ---`);

    // Check that pathlib module node exists
    const pathlibNode = nodes.find(n => n.id === 'pathlib');
    console.log(`✓ pathlib module node: ${pathlibNode ? 'EXISTS' : 'MISSING'}`);

    // Check that pathlib::Path node exists
    const pathClassNode = nodes.find(n => n.id === 'pathlib::Path');
    console.log(`✓ pathlib::Path class node: ${pathClassNode ? 'EXISTS' : 'MISSING'}`);

    // Check import edge from sample.py to pathlib
    const pathlibImport = importEdges.find(e =>
        e.source === 'test/fixtures/sample.py' && e.target === 'pathlib'
    );
    console.log(`✓ Import edge to pathlib: ${pathlibImport ? 'EXISTS' : 'MISSING'}`);

    // Check call edge from main to pathlib::Path
    const pathCall = callEdges.find(e =>
        e.source.includes('main') && e.target === 'pathlib::Path'
    );
    console.log(`✓ Call edge to pathlib::Path: ${pathCall ? 'EXISTS' : 'MISSING'}`);

    console.log(`\n=== Test Complete ===`);

    // Exit with error if any verification failed
    if (!pathlibNode || !pathClassNode || !pathlibImport || !pathCall) {
        console.error('\n❌ Some verifications failed!');
        process.exit(1);
    }

    console.log('\n✅ All verifications passed!');
}

main();
