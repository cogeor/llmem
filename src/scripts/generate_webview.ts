import { prepareWebviewDataFromSplitEdgeLists } from '../graph/webview-data';
import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { generateStaticWebview, GeneratorOptions } from '../webview/generator';
import { loadConfig, getConfig } from '../runtime/config';
import { createWorkspaceContext } from '../application/workspace-context';
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

        // Loop 07: build a per-script WorkspaceContext so the edge-list
        // stores get a real `WorkspaceIO` (mandatory after this loop).
        const ctx = await createWorkspaceContext({
            workspaceRoot: process.cwd(),
            configOverrides: { artifactRoot: config.artifactRoot },
        });
        const root = ctx.workspaceRoot;
        const artifactDir = ctx.artifactRoot;

        console.log(`Loading edge lists from: ${artifactDir}`);
        const importStore = new ImportEdgeListStore(artifactDir, ctx.io);
        const callStore = new CallEdgeListStore(artifactDir, ctx.io);
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
