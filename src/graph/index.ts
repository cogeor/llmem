import { readArtifacts } from './artifact/reader';
import { buildImportGraph } from './importGraph/builder';
import { buildCallGraph } from './callGraph/builder';
import { ImportGraph, CallGraph } from './types';
export { savePlot } from './plot/generator';

export async function buildGraphs(rootDir: string): Promise<{
    importGraph: ImportGraph;
    callGraph: CallGraph;
}> {
    // 1. Read all artifacts
    const artifacts = readArtifacts(rootDir);

    // 2. Build Import Graph
    const importGraph = buildImportGraph(artifacts);

    // 3. Build Call Graph
    const callGraph = buildCallGraph(artifacts);

    return { importGraph, callGraph };
}
