import { initializeArtifactService } from '../artifact/service';
import { handleGetArtifact } from '../mcp/tools';
import * as path from 'path';
import * as fs from 'fs/promises';

async function main() {
    const root = process.cwd();
    console.log(`Checking root: ${root}`);

    // Initialize service
    await initializeArtifactService(root);
    console.log('Artifact Service Initialized');

    const testFile = 'src/extension/config.ts';
    // Ensure the artifact does NOT exist before we start, to prove it's created on demand
    const artifactPath = path.join(root, '.artifacts', testFile, 'mirror.artifact');
    try {
        await fs.unlink(artifactPath);
        console.log('Cleaned up previous artifact');
    } catch {
        // ignore
    }

    console.log(`Requesting artifact for: ${testFile}`);
    const response = await handleGetArtifact({ path: testFile });

    if (response.status !== 'success') {
        console.error('MCP Request failed:', response.error);
        process.exit(1);
    }

    console.log('MCP Request success!');
    console.log('Data:', JSON.stringify(response.data, null, 2));

    // Verify file creation
    try {
        const stats = await fs.stat(artifactPath);
        console.log(`Artifact created at ${artifactPath} (Size: ${stats.size})`);

        const content = await fs.readFile(artifactPath, 'utf-8');
        if (content.includes('loadConfig') && content.includes('Config')) {
            console.log('Verification PASSED: Artifact contains expected function/interface names.');
        } else {
            console.error('Verification FAILED: Artifact missing expected content.');
            process.exit(1);
        }

    } catch (e) {
        console.error(`Verification FAILED: Artifact file not found at ${artifactPath}`);
        console.error(e);
        process.exit(1);
    }
}

main().catch(console.error);
