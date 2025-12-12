
import { buildGraphs } from './src/graph';
import * as path from 'path';

async function test() {
    const root = 'c:\\Users\\costa\\src\\llmem\\.artifacts';
    console.log(`Building graphs from: ${root}`);

    try {
        const { importGraph } = await buildGraphs(root);
        console.log(`Nodes: ${importGraph.nodes.size}`);
        console.log(`Edges: ${importGraph.edges.length}`);

        if (importGraph.nodes.size === 0) {
            console.log("No nodes found!");
        } else {
            console.log("First few nodes:", Array.from(importGraph.nodes.keys()).slice(0, 3));
        }
    } catch (e) {
        console.error("Error building graphs:", e);
    }
}

test();
