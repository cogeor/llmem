/**
 * Simple Edge Verification Test
 * 
 * Checks for edge-node ID mismatches in the call graph.
 */

import * as path from 'path';
import * as fs from 'fs';
import { buildGraphs } from '../graph';
import { prepareWebviewData } from '../graph/webview-data';

async function main() {
    const rootDir = path.resolve(process.cwd(), '.artifacts');
    const output: string[] = [];

    const log = (msg: string) => {
        output.push(msg);
    };

    try {
        log(`Verifying edge-node consistency in: ${rootDir}`);
        log('');

        // Test raw graph data
        log('=== Raw Graph Data ===');
        const { callGraph } = await buildGraphs(rootDir);

        log(`Call Graph: ${callGraph.nodes.size} nodes, ${callGraph.edges.length} edges`);

        const nodeIds = new Set(callGraph.nodes.keys());
        let missingSource = 0;
        let missingTarget = 0;
        const samples: string[] = [];

        for (const edge of callGraph.edges) {
            if (!nodeIds.has(edge.source)) {
                missingSource++;
                if (samples.length < 5) samples.push(`Missing source: ${edge.source}`);
            }
            if (!nodeIds.has(edge.target)) {
                missingTarget++;
                if (samples.length < 5) samples.push(`Missing target: ${edge.target}`);
            }
        }

        log(`Missing source: ${missingSource}`);
        log(`Missing target: ${missingTarget}`);
        samples.forEach(s => log(`  - ${s}`));
        log('');

        // Test webview data
        log('=== Webview Data ===');
        const webviewData = await prepareWebviewData(rootDir);
        const visNodes = webviewData.callGraph.nodes;
        const visEdges = webviewData.callGraph.edges;

        log(`Webview: ${visNodes.length} nodes, ${visEdges.length} edges`);

        const visNodeIds = new Set(visNodes.map(n => n.id));
        let visMissingFrom = 0;
        let visMissingTo = 0;
        const visSamples: string[] = [];

        for (const edge of visEdges) {
            if (!visNodeIds.has(edge.from)) {
                visMissingFrom++;
                if (visSamples.length < 5) visSamples.push(`Missing from: ${edge.from}`);
            }
            if (!visNodeIds.has(edge.to)) {
                visMissingTo++;
                if (visSamples.length < 5) visSamples.push(`Missing to: ${edge.to}`);
            }
        }

        log(`Missing from: ${visMissingFrom}`);
        log(`Missing to: ${visMissingTo}`);
        visSamples.forEach(s => log(`  - ${s}`));
        log('');

        // Summary
        const total = missingSource + missingTarget + visMissingFrom + visMissingTo;
        if (total === 0) {
            log('RESULT: All edges reference valid nodes');
        } else {
            log(`RESULT: BUG CONFIRMED - ${total} edge-node mismatches`);
        }

        // Sample data
        log('');
        log('=== Sample Node IDs (first 3) ===');
        Array.from(callGraph.nodes.keys()).slice(0, 3).forEach(id => log(`  ${id}`));

        log('');
        log('=== Sample Edge References (first 3) ===');
        callGraph.edges.slice(0, 3).forEach(e => log(`  ${e.source} -> ${e.target}`));

    } catch (e: any) {
        log(`ERROR: ${e.message}`);
    }

    // Write results
    const resultPath = path.join(process.cwd(), 'edge_verify_result.txt');
    fs.writeFileSync(resultPath, output.join('\n'), 'utf8');
    console.log(`Results written to: ${resultPath}`);
}

main();
