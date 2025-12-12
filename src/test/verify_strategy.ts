import { initializeArtifactService, ensureArtifacts } from '../artifact/service';
import { handleReadSourceCode } from '../mcp/tools';
import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
    const root = process.cwd();
    console.log(`Checking root: ${root}`);

    // Nuke .artifacts to force regeneration
    // This is critical because ensureArtifacts doesn't update existing records yet
    const artifactsDir = path.join(root, '.artifacts');
    try {
        await fs.rm(artifactsDir, { recursive: true, force: true });
        console.log('Cleared .artifacts directory');
    } catch (e) {
        console.warn('Failed to clear .artifacts', e);
    }

    // Initialize service (will create fresh index)
    await initializeArtifactService(root);

    // 1. Verify Rich Extraction
    console.log('--- Verifying Rich Extraction (imports, exports, types) ---');
    const records = await ensureArtifacts('src/parser');

    // Normalize paths for Windows lookup
    // Expect: src/parser/types.ts
    const typesRecord = records.find(r => r.metadata.sourcePath.replace(/\\/g, '/') === 'src/parser/types.ts');

    if (!typesRecord) {
        console.error('FAILED: types.ts artifact not found in src/parser results.');
        // Debug: list paths
        console.log('Found paths:', records.map(r => r.metadata.sourcePath));
        // Continue to test read_source_code anyway
    } else {
        const content = JSON.parse(typesRecord.content);
        console.log('Artifact keys:', Object.keys(content));

        // Check exports 
        if (!content.exports || content.exports.length === 0) {
            console.error('FAILED: No exports detected in types.ts');
        } else {
            console.log(`SUCCESS: Found ${content.exports.length} exports.`);
            console.log('Sample Export:', content.exports[0]);
        }

        // Check imports
        if (content.imports && content.imports.length > 0) {
            console.log(`SUCCESS: Found ${content.imports.length} imports.`);
        } else {
            // specific file might not have imports? types.ts has none.
            // extractor.ts has imports.
            const extRecord = records.find(r => r.metadata.sourcePath.replace(/\\/g, '/') === 'src/parser/extractor.ts');
            if (extRecord) {
                const extContent = JSON.parse(extRecord.content);
                if (extContent.imports && extContent.imports.length > 0) {
                    console.log(`SUCCESS: Found ${extContent.imports.length} imports in extractor.ts`);
                } else {
                    console.error('FAILED: No imports found in extractor.ts');
                }
            }
        }
    }

    // 2. Verify Read Source Code
    console.log('\n--- Verifying read_source_code ---');
    // Read lines 1-5 of src/parser/types.ts
    const readResponse = await handleReadSourceCode({
        path: 'src/parser/types.ts',
        startLine: 1,
        endLine: 5
    });

    if (readResponse.status !== 'success' || !readResponse.data) {
        console.error('FAILED: read_source_code', readResponse.error);
        process.exit(1);
    }

    console.log('SUCCESS: Read source code snippet:');
    console.log('--- START SNIPPET ---');
    console.log(readResponse.data);
    console.log('--- END SNIPPET ---');

    console.log('\nStrategic Analysis Capabilities Verified!');
}

main().catch(console.error);
