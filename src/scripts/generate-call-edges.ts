#!/usr/bin/env npx ts-node
/**
 * CLI shim for the application-layer scan service.
 *
 * Run: npx ts-node src/scripts/generate-call-edges.ts <folder-path> [--recursive]
 *
 * Library callers (extension panel, hot-reload, HTTP server) MUST import
 * from src/application/scan, NOT from this file. This shim only exposes a
 * main() that prints to console; it has no exports.
 */

import * as path from 'path';
import * as fs from 'fs';
import { scanFolder, scanFolderRecursive } from '../application/scan';
import { createWorkspaceContext } from '../application/workspace-context';
import type { Logger } from '../core/logger';
import { createLogger } from '../common/logger';

// Loop 20: route the application-layer adapter through the structured
// logger. The script's own `console.log` progress prints stay (they
// produce the user-visible CLI report), but progress lines emitted from
// `application/scan` now flow through scope='generate-call-edges'.
const scanLog = createLogger('generate-call-edges');
const consoleLogger: Logger = {
    info: (m) => scanLog.info(m),
    warn: (m) => scanLog.warn(m),
    error: (m) => scanLog.error(m),
};

async function main(): Promise<void> {
    const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
    const recursive =
        process.argv.includes('--recursive') || process.argv.includes('-r');

    if (args.length === 0) {
        console.error(
            'Usage: npx ts-node src/scripts/generate-call-edges.ts <folder-path> [--recursive]'
        );
        console.error(
            'Example: npx ts-node src/scripts/generate-call-edges.ts src/parser'
        );
        console.error('');
        console.error('Options:');
        console.error('  --recursive, -r  Process folder and all subfolders');
        process.exit(1);
    }

    const folderPath = args[0].replace(/\\/g, '/');
    const root = process.cwd();
    const artifactDir = path.join(root, '.artifacts');

    console.log('='.repeat(60));
    console.log('GENERATE CALL EDGES');
    console.log('='.repeat(60));
    console.log(`\nFolder: ${folderPath}`);
    console.log(`Recursive: ${recursive}`);
    console.log(`Artifact dir: ${artifactDir}\n`);

    if (!fs.existsSync(artifactDir)) {
        console.error(
            'ERROR: .artifacts directory not found. Run the initial scan first.'
        );
        process.exit(1);
    }

    try {
        // Loop 04: build a single context for the script. The CLI logger
        // bridges into the application logger so scan progress flows to
        // the structured logger.
        const ctx = await createWorkspaceContext({
            workspaceRoot: root,
            logger: consoleLogger,
        });
        void artifactDir; // resolved below via ctx.artifactRoot
        const req = { folderPath };
        const result = recursive
            ? await scanFolderRecursive(ctx, req)
            : await scanFolder(ctx, req);

        // Render per-file failures the same way the legacy script did.
        for (const err of result.errors) {
            console.warn(`[GenerateEdges] Skip ${err.filePath}: ${err.message}`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('COMPLETE');
        console.log('='.repeat(60));
        console.log(`New edges added: ${result.newEdges}`);
        console.log(`Total call edges: ${result.totalEdges}`);
    } catch (e: any) {
        console.error(`\nERROR: ${e.message}`);
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('Script failed:', e);
    process.exit(1);
});
