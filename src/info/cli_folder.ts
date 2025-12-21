#!/usr/bin/env npx ts-node
/**
 * Folder Info CLI
 * 
 * Command-line script to generate folder info prompt for verification.
 * 
 * Usage: npx ts-node src/info/cli_folder.ts <relative-folder-path> [--semantic]
 * Example: npx ts-node src/info/cli_folder.ts src/info
 * Example: npx ts-node src/info/cli_folder.ts src/info --semantic
 */

import * as path from 'path';
import * as fs from 'fs';
import { getFolderInfoForMcp, buildFolderEnrichmentPrompt } from './folder';

// Configuration
const SEMANTIC_MODE = process.argv.includes('--semantic');

async function main() {
    const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

    if (args.length === 0) {
        console.error('Usage: npx ts-node src/info/cli_folder.ts <relative-folder-path> [--semantic]');
        console.error('Example: npx ts-node src/info/cli_folder.ts src/info --semantic');
        process.exit(1);
    }

    const relativePath = args[0].replace(/\\/g, '/');
    const root = process.cwd();
    const absolutePath = path.resolve(root, relativePath);

    // Check folder exists
    if (!fs.existsSync(absolutePath)) {
        console.error(`ERROR: Folder not found: ${absolutePath}`);
        process.exit(1);
    }

    try {
        const data = await getFolderInfoForMcp(root, relativePath);
        const prompt = buildFolderEnrichmentPrompt(relativePath, data);

        // Semantic mode: output just the prompt to stdout (for LLM consumption)
        if (SEMANTIC_MODE) {
            console.log(prompt);
            return;
        }

        // Normal mode: show decorated output
        console.log(`Analyzing folder: ${relativePath}`);
        console.log(`Root: ${root}`);
        console.log('\n' + '='.repeat(80));
        console.log('GENERATED PROMPT');
        console.log('='.repeat(80) + '\n');
        console.log(prompt);

    } catch (e: any) {
        console.error('\nERROR:', e.message);
        if (e.stack) console.error(e.stack);
        process.exit(1);
    }
}

main();
