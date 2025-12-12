
import { prepareWebviewData } from '../graph/webview-data';
import { generateStaticWebview } from '../webview/generator';
import { loadConfig, getConfig } from '../extension/config';
import * as path from 'path';

async function run() {
    try {
        console.log("Loading config...");
        loadConfig();
        const config = getConfig();

        // Ensure absolute path
        const root = process.cwd();
        const artifactDir = path.join(root, config.artifactRoot);

        console.log(`Building graphs from: ${artifactDir}`);
        const graphData = await prepareWebviewData(artifactDir);

        console.log(`Import Nodes: ${graphData.importGraph.nodes.length}`);
        console.log(`Call Nodes: ${graphData.callGraph.nodes.length}`);

        const webviewDir = path.join(artifactDir, 'webview');

        // Extension root is current directory
        const extensionRoot = root;

        console.log("Generating webview...");
        const indexPath = await generateStaticWebview(webviewDir, extensionRoot, graphData);

        console.log("SUCCESS");
        console.log(`URL: file://${indexPath.replace(/\\/g, '/')}`);

    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

run();
