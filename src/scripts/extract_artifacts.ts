import * as path from 'path';
import { handleAnalyzeCodebase } from '../mcp/tools';
import { initializeArtifactService } from '../artifact/service';

async function main() {
    const cwd = process.cwd();
    console.log(`Initializing artifact service in ${cwd}...`);
    await initializeArtifactService(cwd);

    console.log('Calling analyze_codebase (direct, recursive)...');
    try {
        // analyze_codebase runs recursively by default on the target path
        const response = await handleAnalyzeCodebase({ path: 'src' });

        if (response.status === 'error') {
            console.error('Analysis failed:', response.error);
            process.exit(1);
        }

        console.log('Analysis complete.');
        if (response.status === 'prompt_ready') {
            console.log('Prompt generated (truncated):');
            console.log(response.promptForHostLLM?.slice(0, 500) + '...');
        }
    } catch (error) {
        console.error('Script error:', error);
        process.exit(1);
    }
}

main().catch(console.error);
