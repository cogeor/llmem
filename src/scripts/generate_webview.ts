import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { generateStaticWebview, GeneratorOptions } from '../webview/generator';
import { loadConfig, getConfig } from '../extension/config';
import * as path from 'path';

function parseArgs(): GeneratorOptions {
    const args = process.argv.slice(2);
    const graphOnly = args.includes('--graph-only');

    if (graphOnly) {
        console.log("Mode: graph-only (skipping worktree, design docs, arch)");
    }

    return {
        graphOnly
    };
}

async function run() {
    try {
        const options = parseArgs();

        console.log("Loading config...");
        loadConfig();
        const config = getConfig();

        // Ensure absolute path
        const root = process.cwd();
        const artifactDir = path.join(root, config.artifactRoot);

        console.log(`Loading edge lists from: ${artifactDir}`);
        const importStore = new ImportEdgeListStore(artifactDir);
        const callStore = new CallEdgeListStore(artifactDir);
        await Promise.all([importStore.load(), callStore.load()]);

        const importStats = importStore.getStats();
        const callStats = callStore.getStats();
        console.log(`Import edge list: ${importStats.nodes} nodes, ${importStats.edges} edges`);
        console.log(`Call edge list: ${callStats.nodes} nodes, ${callStats.edges} edges`);

        const graphData = prepareWebviewDataFromSplitEdgeLists(importStore.getData(), callStore.getData());

        console.log(`Import Nodes: ${graphData.importGraph.nodes.length}`);
        console.log(`Call Nodes: ${graphData.callGraph.nodes.length}`);

        const webviewDir = path.join(artifactDir, 'webview');

        // Extension root is current directory
        const extensionRoot = root;

        console.log("Generating webview...");
        const indexPath = await generateStaticWebview(webviewDir, extensionRoot, root, graphData, options);

        console.log("SUCCESS");
        console.log(`URL: file://${indexPath.replace(/\\/g, '/')}`);

    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

run();
