#!/usr/bin/env npx ts-node
/**
 * File Info CLI
 * 
 * Command-line script to display imports and graph edges for a file.
 * 
 * Usage: npx ts-node src/info/cli.ts <relative-file-path> [--signatures]
 * Example: npx ts-node src/info/cli.ts src/info/extractor.ts --signatures
 */

import * as path from 'path';
import * as fs from 'fs';
import { TypeScriptService } from '../parser/ts-service';
import { TypeScriptExtractor } from '../parser/ts-extractor';
import { artifactToEdgeList } from '../graph/artifact-converter';
import { getImportEdges, getCallEdges, filterImportEdges } from './filter';
import { FileArtifact, Entity } from '../parser/types';

// Configuration
const INCLUDE_SIGNATURES = process.argv.includes('--signatures');
const SEMANTIC_MODE = process.argv.includes('--semantic');

// Cache for extracted artifacts (for cross-file signature lookups)
const artifactCache = new Map<string, FileArtifact>();

/**
 * Get signature for an entity from an artifact
 */
function getSignature(artifact: FileArtifact, entityName: string): string | null {
    const entity = artifact.entities.find(e => e.name === entityName);
    return entity?.signature || null;
}

/**
 * Format signature for display (extract just params, single line)
 */
function formatSignature(signature: string | null): string {
    if (!signature) return '';

    // Collapse multi-line signatures to single line
    const normalized = signature.replace(/\s+/g, ' ').trim();

    // Extract parameters from signature like "functionName(param1: Type, param2: Type): ReturnType"
    const match = normalized.match(/\(([^)]*)\)/);
    if (match) {
        // Simplify params: just keep names, not types
        const params = match[1]
            .split(',')
            .map(p => p.split(':')[0].trim())
            .filter(p => p.length > 0)
            .join(', ');
        return params ? `(${params})` : '()';
    }
    return '';
}

async function main() {
    const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

    if (args.length === 0) {
        console.error('Usage: npx ts-node src/info/cli.ts <relative-file-path> [--signatures] [--semantic]');
        console.error('Example: npx ts-node src/info/cli.ts src/info/extractor.ts --semantic');
        process.exit(1);
    }

    const relativePath = args[0].replace(/\\/g, '/');
    const root = process.cwd();
    const absolutePath = path.resolve(root, relativePath);

    // Check file exists
    if (!fs.existsSync(absolutePath)) {
        console.error(`ERROR: File not found: ${absolutePath}`);
        process.exit(1);
    }

    // Semantic mode: output LLM prompt to stdout
    if (SEMANTIC_MODE) {
        const { getFileInfoForMcp, buildEnrichmentPrompt } = await import('./mcp');
        const data = await getFileInfoForMcp(root, relativePath);
        const prompt = buildEnrichmentPrompt(data.filePath, data.markdown, data.sourceCode);
        console.log(prompt);
        return;
    }

    // Initialize TypeScript service
    const tsService = new TypeScriptService(root);
    const tsExtractor = new TypeScriptExtractor(() => tsService.getProgram(), root);

    // Extract artifact for the main file
    const artifact = await tsExtractor.extract(absolutePath);
    if (!artifact) {
        console.error(`ERROR: Failed to extract artifact from ${relativePath}`);
        process.exit(1);
    }
    artifactCache.set(relativePath, artifact);

    // Convert to edge list
    const { nodes, edges } = artifactToEdgeList(artifact, relativePath);

    // Get filtered edges
    const importEdges = filterImportEdges(getImportEdges(edges));
    const callEdges = getCallEdges(edges);

    // Output
    const separator = '='.repeat(80);
    console.log(separator);
    console.log(`FILE INFO: ${relativePath}`);
    console.log(separator);

    // Imports section
    console.log('\nIMPORTS (from this file):');
    if (importEdges.length === 0) {
        console.log('  (none)');
    } else {
        for (const edge of importEdges) {
            console.log(`  → ${edge.target}`);
        }
    }

    // Entities section
    console.log('\nENTITIES:');
    const entityNodes = nodes.filter(n => n.kind !== 'file');
    if (entityNodes.length === 0) {
        console.log('  (none)');
    } else {
        for (const node of entityNodes) {
            const entity = artifact.entities.find(e => e.name === node.name);
            const exportMark = entity?.isExported ? ' [exported]' : '';
            const sig = INCLUDE_SIGNATURES ? formatSignature(entity?.signature || null) : '';
            console.log(`  • ${node.name}${sig} (${node.kind})${exportMark}`);
        }
    }

    // Call edges section
    console.log('\nCALL EDGES (from this file):');

    // Standard library functions to filter out
    const stdlibFunctions = new Set([
        'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
        'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
        'includes', 'indexOf', 'join', 'split', 'trim', 'replace', 'match',
        'toString', 'valueOf', 'hasOwnProperty',
        'get', 'set', 'has', 'delete', 'clear', 'add', 'keys', 'values', 'entries',
        'next', 'done', 'then', 'catch', 'finally',
        'log', 'error', 'warn', 'info', 'debug',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math',
        'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect',
        'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
        'console', 'process', 'require', 'module', 'exports',
        'Buffer', 'RegExp', 'Function', 'Uint8Array', 'Int32Array'
    ]);

    // Helper to get signature for a target (with caching)
    async function getTargetSignature(targetFile: string, targetName: string): Promise<string> {
        if (!INCLUDE_SIGNATURES) return '';

        // Get or extract the target artifact
        let targetArtifact = artifactCache.get(targetFile);
        if (!targetArtifact) {
            const targetAbsPath = path.resolve(root, targetFile);
            if (fs.existsSync(targetAbsPath)) {
                try {
                    const extracted = await tsExtractor.extract(targetAbsPath);
                    if (extracted) {
                        targetArtifact = extracted;
                        artifactCache.set(targetFile, extracted);
                    }
                } catch (e) {
                    // Silently fail for files that can't be extracted
                }
            }
        }

        if (targetArtifact) {
            const sig = getSignature(targetArtifact, targetName);
            return formatSignature(sig);
        }
        return '';
    }

    // Filter and format call edges
    const formattedCallEdges: string[] = [];
    for (const edge of callEdges) {
        // Extract source and target info
        const sourceFile = edge.source.includes('::') ? edge.source.split('::')[0] : edge.source;
        const sourceName = edge.source.includes('::') ? edge.source.split('::').pop()! : edge.source;
        const targetFile = edge.target.includes('::') ? edge.target.split('::')[0] : edge.target;
        const targetName = edge.target.includes('::') ? edge.target.split('::').pop()! : edge.target;

        // Skip stdlib functions
        if (stdlibFunctions.has(targetName)) {
            continue;
        }

        // Get signatures
        const sourceSig = INCLUDE_SIGNATURES ? formatSignature(getSignature(artifact, sourceName)) : '';
        const targetSig = await getTargetSignature(targetFile, targetName);

        // Format target based on location
        let targetDisplay: string;
        if (targetFile === relativePath) {
            // Same file - just show function name
            targetDisplay = `${targetName}${targetSig}`;
        } else if (targetFile.includes('node_modules') || !targetFile.includes('/')) {
            // External library - show module:function
            const moduleName = targetFile.replace(/.*node_modules\//, '').split('/')[0];
            targetDisplay = `${moduleName}:${targetName}${targetSig}`;
        } else {
            // Different internal file - show path:function
            targetDisplay = `${targetFile}:${targetName}${targetSig}`;
        }

        formattedCallEdges.push(`  ${sourceName}${sourceSig} → ${targetDisplay}`);
    }

    if (formattedCallEdges.length === 0) {
        console.log('  (none)');
    } else {
        // Remove duplicates and print
        const uniqueEdges = Array.from(new Set(formattedCallEdges));
        for (const edge of uniqueEdges) {
            console.log(edge);
        }
    }

    console.log('');
}

main().catch(e => {
    console.error('Script failed:', e);
    process.exit(1);
});
