import * as path from 'path';
import { readArtifacts } from '../graph/artifact/reader';
import { normalizePath } from '../graph/utils';

function main() {
    const rootDir = path.resolve(process.cwd(), '.artifacts');
    console.log(`Scanning artifacts in: ${rootDir}`);

    const artifacts = readArtifacts(rootDir);
    console.log(`Loaded ${artifacts.length} artifacts.`);

    // 1. List all node IDs
    const nodeIds = new Set(artifacts.map(a => a.fileId));
    console.log('\n--- Node IDs (first 10) ---');
    Array.from(nodeIds).slice(0, 10).forEach(id => console.log(id));

    // 2. Check imports for src/graph/index.ts
    const fileWithImports = artifacts.find(a => a.fileId.includes('src/graph/index.ts'));

    if (!fileWithImports) {
        console.log('Could not find src/graph/index.ts artifact.');
        // fallback to first artifact with ANY imports
        const anyFile = artifacts.find(a => a.artifact.imports && a.artifact.imports.length > 0);
        if (anyFile) {
            console.log(`Falling back to inspecting: ${anyFile.fileId}`);
            inspectImports(anyFile, nodeIds);
        }
        return;
    }

    inspectImports(fileWithImports, nodeIds);
}

function inspectImports(fileWithImports: any, nodeIds: Set<string>) {
    console.log(`\n--- Inspecting imports for: ${fileWithImports.fileId} ---`);
    if (!fileWithImports.artifact.imports) {
        console.log('No imports array in artifact.');
        return;
    }

    fileWithImports.artifact.imports.forEach((imp: any) => {
        console.log(`[Imp] sourceStr=${imp.source}`);
        console.log(`      rawResolved=${imp.resolvedPath}`);

        if (imp.resolvedPath) {
            const normalizedTarget = normalizePath(imp.resolvedPath);
            const exists = nodeIds.has(normalizedTarget);
            console.log(`      normalized =${normalizedTarget}`);
            console.log(`      MATCHES NODE? ${exists ? 'YES' : 'NO'}`);
        } else {
            console.log(`      (resolvedPath is null/undefined)`);
        }
        console.log('---');
    });
}

main();
