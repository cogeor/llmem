import * as path from 'path';
import { buildGraphs } from '../graph';

async function main() {
    // Determine the root directory.
    // Assuming this script is run from project root or scripts/ folder.
    // If run as 'node scripts/test-graph.js' (compiled), cwd is likely root.
    // The artifacts are typically in .artifacts/
    const rootDir = path.resolve(process.cwd(), '.artifacts');

    console.log(`Building graphs from artifacts in: ${rootDir}`);

    try {
        const { importGraph, callGraph } = await buildGraphs(rootDir);

        console.log('\n--- Import Graph Stats ---');
        console.log(`Nodes: ${importGraph.nodes.size}`);
        console.log(`Edges: ${importGraph.edges.length}`);

        // Sanity check: find parser.ts node
        const fileNode = Array.from(importGraph.nodes.values()).find(n => n.path.includes('parser.ts'));
        if (fileNode) {
            console.log(`Found parser node: ${fileNode.id}`);
            const outgoing = importGraph.edges.filter(e => e.source === fileNode.id);
            console.log(`Outgoing imports from parser: ${outgoing.length}`);
            outgoing.forEach(e => console.log(`  -> ${e.target} via ${JSON.stringify(e.specifiers)}`));
        } else {
            console.log('WARNING: parser.ts node not found in import graph');
        }

        console.log('\n--- Call Graph Stats ---');
        console.log(`Nodes: ${callGraph.nodes.size}`);
        console.log(`Edges: ${callGraph.edges.length}`);
        console.log(`Unresolved Calls: ${callGraph.unresolved.length}`);

        // Sanity check: check for unresolved "path.extname" or "console.warn"
        const externalCalls = callGraph.unresolved.filter(u => u.calleeName.includes('path.') || u.calleeName.includes('console.'));
        console.log(`Detected ${externalCalls.length} expected external/unresolved calls (path.*, console.*)`);

        if (callGraph.edges.length === 0 && callGraph.nodes.size > 0) {
            console.log('WARNING: No internal call edges found. This might be expected if artifacts lack internal calls or resolution failed.');
        }

    } catch (e) {
        console.error('Failed to build graphs:', e);
        process.exit(1);
    }
}

main();
