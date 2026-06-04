/**
 * Folder structural-markdown projection (Loop 14 extraction of
 * `application/document-folder.ts`).
 *
 * Pure rendering of the folder's files / imports / calls into the
 * `### FOLDER GRAPH` markdown block that feeds the enrichment prompt. No I/O,
 * no edge-store access — it operates on already-filtered nodes/edges.
 */

import * as path from 'path';
import type { NodeEntry, EdgeEntry } from '../../graph/edgelist';
import { getImportEdges, getCallEdges, filterImportEdges } from '../../graph/query/filter';
import { parseGraphId } from '../../core/ids';

export interface StructuralMarkdownInput {
    folderPath: string;
    folderNodes: NodeEntry[];
    folderEdges: EdgeEntry[];
    prefix: string;
}

export function renderStructuralMarkdown(input: StructuralMarkdownInput): string {
    const { folderPath, folderNodes, folderEdges, prefix } = input;
    const lines: string[] = [];

    lines.push(`### FOLDER GRAPH: ${folderPath}`);
    lines.push('');

    // 1. Files & Entities
    const fileNodes = folderNodes.filter((n) => n.kind === 'file');
    lines.push(`#### FILES (${fileNodes.length})`);

    const filesMap = new Map<string, NodeEntry[]>();
    for (const node of folderNodes) {
        if (node.kind === 'file') continue;
        if (!filesMap.has(node.fileId)) filesMap.set(node.fileId, []);
        filesMap.get(node.fileId)!.push(node);
    }

    if (fileNodes.length === 0) {
        lines.push('(none found in graph)');
    } else {
        const sortedFiles = Array.from(filesMap.keys()).sort();
        for (const fileId of sortedFiles) {
            const entities = filesMap.get(fileId) || [];
            lines.push(`- **${fileId}**`);
            entities.forEach((e) => {
                lines.push(`  - \`${e.name}\` (${e.kind})`);
            });
        }
    }
    lines.push('');

    // 2. Imports (External Dependencies)
    lines.push('#### IMPORTS (External)');
    const importEdges = filterImportEdges(getImportEdges(folderEdges));
    const uniqueImports = new Set<string>();
    const isInternal = (p: string) => {
        const normalized = p.replace(/\\/g, '/');
        return normalized.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    };

    for (const edge of importEdges) {
        const target = edge.target;
        if (!isInternal(target)) {
            const sourceFile = path.basename(edge.source);
            uniqueImports.add(`${sourceFile} → ${target}`);
        }
    }

    if (uniqueImports.size === 0) {
        lines.push('(none)');
    } else {
        Array.from(uniqueImports).sort().forEach((i) => lines.push(`- ${i}`));
    }
    lines.push('');

    // 3. Calls
    lines.push('#### CALLS');
    const callEdges = getCallEdges(folderEdges);

    const internalCalls: string[] = [];
    const outgoingCalls: string[] = [];
    const incomingCalls: string[] = [];

    for (const edge of callEdges) {
        const source = edge.source;
        const target = edge.target;

        const sourceParsed = parseGraphId(source);
        const targetParsed = parseGraphId(target);

        const sourceFile = sourceParsed.kind === 'entity' ? sourceParsed.fileId : source;
        const targetFile = targetParsed.kind === 'entity' ? targetParsed.fileId : target;
        const targetName = targetParsed.kind === 'entity' ? targetParsed.name : target;
        const sourceName = sourceParsed.kind === 'entity' ? sourceParsed.name : path.basename(source);

        if (STDLIB_FUNCTIONS.has(targetName)) continue;

        const sourceIn = isInternal(sourceFile);
        const targetIn = isInternal(targetFile);

        const edgeStr = `${sourceName} → ${targetName}`;

        if (sourceIn && targetIn) {
            internalCalls.push(edgeStr);
        } else if (sourceIn && !targetIn) {
            outgoingCalls.push(`${sourceName} → ${targetFile}:${targetName}`);
        } else if (!sourceIn && targetIn) {
            incomingCalls.push(`${sourceFile}:${sourceName} → ${targetName}`);
        }
    }

    lines.push('**Internal Interactions**');
    if (internalCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(internalCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Outgoing Calls (Dependencies)**');
    if (outgoingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(outgoingCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    lines.push('**Incoming Calls (Usage)**');
    if (incomingCalls.length === 0) lines.push('- (none)');
    else Array.from(new Set(incomingCalls)).sort().forEach((c) => lines.push(`- ${c}`));
    lines.push('');

    return lines.join('\n');
}

// ============================================================================
// Constants
// ============================================================================

const STDLIB_FUNCTIONS: ReadonlySet<string> = new Set([
    'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat',
    'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
    'includes', 'indexOf', 'join', 'split', 'trim', 'replace', 'match',
    'toString', 'valueOf', 'hasOwnProperty',
    'get', 'set', 'has', 'delete', 'clear', 'add', 'keys', 'values', 'entries',
    'next', 'done', 'then', 'catch', 'finally',
    'log', 'error', 'warn', 'info', 'debug',
    'Map', 'Set', 'Promise', 'Error', 'JSON', 'Object', 'Array',
]);
