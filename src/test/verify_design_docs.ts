
import { DesignDocManager } from '../webview/design-docs';
import * as path from 'path';

async function run() {
    console.log("Verifying DesignDocManager...");
    const root = process.cwd();
    const manager = new DesignDocManager(root);

    console.log(`Project Root: ${root}`);

    try {
        const docs = await manager.getAllDocsAsync();
        const keys = Object.keys(docs);
        console.log(`Found ${keys.length} design docs`);
        keys.forEach(k => console.log(` - ${k}`));

        // Verify specific expected key if exists
        // Verify specific expected key if exists
        // User mentioned src/graph -> .arch/src/graph.md
        // Expected key: src/graph.html
        if (keys.includes('src/graph.html')) {
            console.log("✔ Found expected key: src/graph.html");
        } else {
            console.log("⚠ Did not find src/graph.html");
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
