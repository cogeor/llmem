/**
 * Build reverse call index from call graph
 * 
 * The call graph has edges: caller -> callee
 * We need to reverse this to find: for each callee, who calls it
 */

import { CallGraph, EntityNode } from '../graph/types';
import { CallerInfo, ReverseCallIndex } from './types';

/**
 * Parse an entity label to extract file path and function name
 * Labels are in format: "path/to/file.ts:functionName"
 */
export function parseEntityLabel(label: string): { file: string; name: string } {
    const colonIndex = label.lastIndexOf(':');
    if (colonIndex === -1) {
        return { file: '', name: label };
    }
    return {
        file: label.substring(0, colonIndex),
        name: label.substring(colonIndex + 1)
    };
}

/**
 * Build a reverse call index from a call graph
 * 
 * @param callGraph The call graph with edges (caller -> callee)
 * @returns Map from entity ID to list of callers
 */
export function buildReverseCallIndex(callGraph: CallGraph): ReverseCallIndex {
    const index: ReverseCallIndex = new Map();

    for (const edge of callGraph.edges) {
        const targetId = edge.target;
        const sourceId = edge.source;

        // Get the caller node to extract its info
        const callerNode = callGraph.nodes.get(sourceId);
        if (!callerNode) continue;

        const { file, name } = parseEntityLabel(callerNode.label);

        const callerInfo: CallerInfo = {
            name,
            file
        };

        // Add to index
        if (!index.has(targetId)) {
            index.set(targetId, []);
        }

        // Avoid duplicate callers (same function might call multiple times)
        const callers = index.get(targetId)!;
        const exists = callers.some(c => c.name === name && c.file === file);
        if (!exists) {
            callers.push(callerInfo);
        }
    }

    return index;
}

/**
 * Get callers for a specific entity
 */
export function getCallersForEntity(
    entityId: string,
    reverseIndex: ReverseCallIndex
): CallerInfo[] {
    return reverseIndex.get(entityId) || [];
}
