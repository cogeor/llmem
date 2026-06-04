/**
 * File structural-markdown projection (Loop 12 extraction of
 * `application/document-file.ts`).
 *
 * Pure rendering of a single file's imports / entities / call edges into the
 * `### IMPORTS` / `### ENTITIES` / `### CALL EDGES` markdown block that feeds
 * the enrichment prompt. No I/O — it operates on the already-parsed
 * `FileArtifact` plus the source-relative file path.
 */

import type { FileArtifact } from '../../parser/types';
import { artifactToEdgeList } from '../artifact-converter';
import { parseGraphId } from '../../core/ids';
import { getImportEdges, getCallEdges, filterImportEdges } from '../../graph/query/filter';

/**
 * Build the structural markdown summary (imports + entities + call edges)
 * for a single parsed file.
 */
export function renderStructuralMarkdown(filePath: string, artifact: FileArtifact): string {
    const { nodes, importEdges: rawImportEdges, callEdges: rawCallEdges } =
        artifactToEdgeList(artifact, filePath);

    const importEdges = filterImportEdges(getImportEdges(rawImportEdges));
    const callEdges = getCallEdges(rawCallEdges);

    const lines: string[] = [];

    lines.push('### IMPORTS');
    if (importEdges.length === 0) {
        lines.push('(none)');
    } else {
        for (const edge of importEdges) {
            lines.push(`- → ${edge.target}`);
        }
    }
    lines.push('');

    lines.push('### ENTITIES');
    const entityNodes = nodes.filter((n) => n.kind !== 'file');
    if (entityNodes.length === 0) {
        lines.push('(none)');
    } else {
        for (const node of entityNodes) {
            const entity = artifact.entities.find((e) => e.name === node.name);
            const exportMark = entity?.isExported ? ' [exported]' : '';
            const sig = entity?.signature ? ` - \`${entity.signature}\`` : '';
            lines.push(`- **${node.name}** (${node.kind})${exportMark}${sig}`);
        }
    }
    lines.push('');

    lines.push('### CALL EDGES');
    const filteredCallEdges = callEdges.filter((edge) => {
        const parsed = parseGraphId(edge.target);
        const targetName = parsed.kind === 'entity' ? parsed.name : edge.target;
        return !STDLIB_FUNCTIONS.has(targetName);
    });

    if (filteredCallEdges.length === 0) {
        lines.push('(none)');
    } else {
        for (const edge of filteredCallEdges) {
            const sourceParsed = parseGraphId(edge.source);
            const targetParsed = parseGraphId(edge.target);

            const sourceName = sourceParsed.kind === 'entity' ? sourceParsed.name : edge.source;
            const targetFile = targetParsed.kind === 'entity' ? targetParsed.fileId : edge.target;
            const targetName = targetParsed.kind === 'entity' ? targetParsed.name : edge.target;

            if (targetFile === filePath) {
                lines.push(`- ${sourceName} → ${targetName}`);
            } else {
                lines.push(`- ${sourceName} → ${targetFile}:${targetName}`);
            }
        }
    }

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
