/**
 * A3 — resource-payload ownership signal (WS-4), feeding FR1.
 *
 * Server-payload DTOs (the snapshot the host injects / serves: `GraphData`,
 * `WorkTreeNode`, `WorkTreeData`, `DesignDoc`, `FolderTreeData`, `FolderEdges` —
 * the boundary shapes named in the webview architecture memos) are meant to flow
 * through ONE owner. When several modules each hold a long-lived binding/field
 * typed as the same DTO, each is an authoritative copy that must be refreshed
 * independently — the FR1 "multi-owned server payload" smell.
 *
 * Unlike the per-file scanners, this one aggregates ACROSS the whole in-scope
 * `sources` array: it builds a `DTO → Set<fileId>` ownership map by regex-finding
 * declarations whose type annotation is one of the DTOs, then emits an FR1
 * candidate for every DTO owned by ≥2 distinct files. The candidate `ref` is the
 * DTO name; the `note` lists the sorted owner file ids. This is the
 * regex-review-time approximation of the extraction-plan's A3 payload-owner map
 * (true long-lived-field analysis is out of regex reach; a typed
 * field/binding declaration is the honest, noisy proxy — the LLM filter judges
 * authoritative-copies-needing-refresh vs deliberate memoized projection).
 *
 * Only FR1 is emitted. D1 ("Duplicated logic across files") is already
 * analyzer-fed by the 'clones' query; feeding it the DTO-ownership candidates
 * here would clobber its clone candidates, so this scanner stays FR1-only.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * Server-payload DTO set (from the webview memos). A binding/field annotated as
 * one of these is treated as an owned copy of that server payload.
 */
const PAYLOAD_DTOS: readonly string[] = [
    'GraphData',
    'WorkTreeNode',
    'WorkTreeData',
    'DesignDoc',
    'FolderTreeData',
    'FolderEdges',
];

/**
 * Match a binding/field declaration whose type annotation is a payload DTO:
 *   - `readonly graph: GraphData`
 *   - `private data: WorkTreeData`
 *   - `let doc: DesignDoc`
 *   - `tree: FolderTreeData` (bare field)
 * The leading visibility/binding keyword is optional (fields carry none). The DTO
 * name is captured (group 1) and word-boundaried (`\b`) so `GraphDataView` does
 * not match `GraphData`.
 */
const FIELD_RE = new RegExp(
    '(?:readonly\\s+|private\\s+|public\\s+|protected\\s+|let\\s+|const\\s+|var\\s+)?' +
        '[\\w$]+\\s*:\\s*(' +
        PAYLOAD_DTOS.join('|') +
        ')\\b',
    'g',
);

/**
 * Build the `DTO → Set<fileId>` ownership map across all in-scope sources. A
 * source contributes a DTO once (set semantics) no matter how many fields in it
 * are typed as that DTO.
 */
function ownershipMap(sources: ScopedSource[]): Map<string, Set<string>> {
    const owners = new Map<string, Set<string>>();
    for (const source of sources) {
        // A fresh regex per file avoids shared `lastIndex` state across files.
        const re = new RegExp(FIELD_RE.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(source.text)) !== null) {
            const dto = m[1];
            const set = owners.get(dto) ?? new Set<string>();
            set.add(source.fileId);
            owners.set(dto, set);
        }
    }
    return owners;
}

/**
 * `payloadOwnerScanner` — emits one FR1 candidate per payload DTO held by ≥2
 * distinct in-scope files. The candidate `ref` is the DTO name and `note` lists
 * the sorted owner file ids. Returns an empty FR1 result list when no DTO is
 * multi-owned (the harness merge tolerates empties).
 */
export const payloadOwnerScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const owners = ownershipMap(sources);
    const candidates: RecallCandidate[] = [];
    for (const [dto, fileSet] of owners) {
        if (fileSet.size < 2) {
            continue;
        }
        const files = [...fileSet].sort((a, b) => a.localeCompare(b));
        candidates.push({
            ref: dto,
            note: `held by ${files.length} modules: ${files.join(', ')}`,
        });
    }
    return [{ itemId: 'FR1', candidates }];
};
