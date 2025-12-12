import * as path from 'path';
import { buildGraphs, savePlot } from '../graph';
import { handleAnalyzeCodebase } from '../mcp/tools';
import { initializeArtifactService } from '../artifact/service';

async function main() {
    const cwd = process.cwd();
    console.log(`Initializing artifact service in ${cwd}...`);
    await initializeArtifactService(cwd);

    console.log('Regenerating artifacts for "src"...');
    try {
        const response = await handleAnalyzeCodebase({ path: 'src' });
        if (response.status === 'error') {
            console.error('Artifact generation failed:', response.error);
            process.exit(1);
        }
        console.log('Artifacts regenerated successfully.');
    } catch (e) {
        console.error('Failed to regenerate artifacts:', e);
        process.exit(1);
    }

    const rootDir = path.resolve(cwd, '.artifacts');
    console.log(`Building graphs from: ${rootDir}`);

    try {
        const { importGraph, callGraph } = await buildGraphs(rootDir);

        const importPlotPath = path.resolve(cwd, 'import_graph.html');
        savePlot(importGraph, 'Import Graph', importPlotPath);

        const callPlotPath = path.resolve(cwd, 'call_graph.html');
        savePlot(callGraph, 'Call Graph', callPlotPath);

        console.log('Done.');
    } catch (e) {
        console.error('Error plotting graphs:', e);
        process.exit(1);
    }
}

main();
