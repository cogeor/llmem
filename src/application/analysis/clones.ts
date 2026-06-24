/**
 * Clone analyzer — Tier-1 normalized-body hash (Loop 06) + Tier-1.5
 * shared-literal payload (Loop 07).
 *
 * `findClones(ctx)` detects Type-1/2 clones across the in-scope files:
 *   1. In-scope file list = the call-edgelist `kind:'file'` nodes (the same
 *      analyzed/watched set the cycle/hub analyzers consume — NOT worktree-state,
 *      which the analysis layer never touches). Deduped + sorted.
 *   2. For each file: content-hash the bytes. On a cache HIT (same contentHash)
 *      reuse the cached per-entity hashes — NO parse, NO normalize. On a MISS,
 *      parse the file's entities via the shared-`ts.Program` `TypeScriptExtractor`,
 *      slice each callable body by `loc.startByte/endByte`, normalize, sha256, and
 *      in the SAME MISS branch (same `body` slice) a SECOND cheap scanner extracts
 *      the literal PAYLOAD hashes (`extractLiteralHashes`) — no new parse/Program;
 *      both products are cached so a warm run reuses both with zero re-parse.
 *   3. Bucket entity hashes (size > 1 ⇒ exact-body cluster). Separately bucket
 *      literal-payload hashes (shared by >=2 distinct functions ⇒ shared-literal
 *      cluster, `clusterSharedLiterals`). Combine + rank (severity → strength → id).
 *   4. Persist clone edges to the standalone `clone-edgelist.json` and the
 *      refreshed analysis cache (evicting entries for out-of-scope files).
 *
 * Parse cost is deferred: the workspace `ts.Program` / extractor is built LAZILY
 * and ONCE, only on the FIRST cache miss, so a fully-warm `health` parses ZERO
 * files (spec §6).
 *
 * Granularity: only `function | method | arrow` entities are compared (spec's
 * function/method granularity); `class` bodies are excluded (class-vs-class noise).
 *
 * Layer: application. Imports parser (`TypeScriptService`/`TypeScriptExtractor`)
 * + graph (`CallEdgeListStore`/`CloneEdgeListStore`/`makeEntityId`) — both
 * allowed. Imports NO cli/webview/mcp.
 */

import type { WorkspaceContext } from '../workspace-context';
import type { CloneFinding, Severity } from './types';
import {
    loadAnalysisCache,
    saveAnalysisCache,
    type CachedEntity,
} from './cache';
import { normalizeBody, sha256Hex } from './clones-normalize';
import {
    extractLiteralHashes,
    clusterSharedLiterals,
    clusterSeverity,
    distanceNote,
    chainEdges,
    sortFindingsEdges,
    type EntityHash,
} from './clones-literals';

// Re-export so existing `clones.ts` consumers (tests) keep importing `EntityHash`
// from here even though the type now lives in `clones-literals.ts`.
export type { EntityHash } from './clones-literals';
import { CallEdgeListStore, CloneEdgeListStore, type CloneEdge } from '../../graph/edgelist';
import { makeEntityId } from '../../core/ids';
import { TypeScriptService } from '../../parser/ts-service';
import { TypeScriptExtractor } from '../../parser/ts-extractor';
import type { EntityKind } from '../../parser/types';

/** Noise floor — entities with fewer original tokens are ignored (spec §2.3). */
export const CLONE_MIN_TOKENS = 20;

/** Entity kinds whose bodies are compared for clones (function granularity). */
const CLONEABLE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
    'function',
    'method',
    'arrow',
]);

/** PURE: bucket entity hashes into clone clusters + clone edges. No IO, no parse. */
export function clusterClones(entities: EntityHash[]): {
    findings: CloneFinding[];
    edges: CloneEdge[];
} {
    // 1. Noise floor.
    const surviving = entities.filter(e => e.tokenCount >= CLONE_MIN_TOKENS);

    // 2. Group by normalizedHash, preserving caller input order (caller sorts by
    //    entityId so membership order is deterministic).
    const buckets = new Map<string, EntityHash[]>();
    for (const e of surviving) {
        const bucket = buckets.get(e.normalizedHash);
        if (bucket) bucket.push(e);
        else buckets.set(e.normalizedHash, [e]);
    }

    const findings: CloneFinding[] = [];
    const edges: CloneEdge[] = [];

    for (const members of buckets.values()) {
        if (members.length < 2) continue;

        const severity = clusterSeverity(members);
        const memberIds = members.map(m => m.entityId); // already entityId-sorted
        const relatedFiles = [...new Set(members.map(m => m.fileId))].sort();
        const id = 'clone:' + memberIds.join('|');

        findings.push({
            id,
            type: 'clone',
            cloneType: 'exact-body',
            similarity: 1,
            severity,
            title: `${memberIds.length}-member exact-body clone${distanceNote(severity)}`,
            detail:
                `Exact-body (Type-1/2) clone across ${memberIds.length} entities: ` +
                memberIds.join(', '),
            relatedFiles,
            members: memberIds,
        });
        edges.push(...chainEdges(memberIds, severity, 'exact-body'));
    }

    sortFindingsEdges(findings, edges);
    return { findings, edges };
}

/**
 * Combined-finding sort (the single ranking authority — the renderer must NOT
 * re-sort): severity band high→low, then STRENGTH (exact-body before
 * shared-literal at equal severity), then id.
 */
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
function compareClones(a: CloneFinding, b: CloneFinding): number {
    const strength = (t: CloneFinding['cloneType']) => (t === 'exact-body' ? 0 : 1);
    return (
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        strength(a.cloneType) - strength(b.cloneType) ||
        a.id.localeCompare(b.id)
    );
}

/**
 * Build the per-file entity hashes for one file, using the cache when the
 * content hash matches. Returns the entity records AND whether the cache record
 * was (re)computed (caller marks the cache dirty / updates the record).
 */
function entitiesFromCache(cached: CachedEntity[], fileId: string): EntityHash[] {
    return cached.map(e => ({
        entityId: e.id,
        fileId,
        normalizedHash: e.normalizedHash,
        tokenCount: e.tokenCount,
        // HIT path reuses the cached literal hashes — zero re-parse.
        literalHashes: e.literalHashes,
    }));
}

/** ctx-in / data-out: in-scope files → entity hashes (cached) → clusterClones → persist. */
export async function findClones(ctx: WorkspaceContext): Promise<CloneFinding[]> {
    const cache = await loadAnalysisCache(ctx);

    // In-scope fileIds = call-edgelist file nodes (same scope as the other
    // analyzers). Load ONLY the call store (the import graph is irrelevant here).
    const callStore = new CallEdgeListStore(ctx.artifactRoot, ctx.io);
    await callStore.load();
    const inScope = [
        ...new Set(
            callStore
                .getNodes()
                .filter(n => n.kind === 'file')
                .map(n => n.fileId),
        ),
    ].sort();
    const inScopeSet = new Set(inScope);

    // Lazy, once-only parse harness — built on the FIRST cache miss so a fully
    // warm run parses zero files (spec §6).
    let extractor: TypeScriptExtractor | undefined;
    const ensureExtractor = (): TypeScriptExtractor => {
        if (!extractor) {
            const tsService = new TypeScriptService(ctx.workspaceRoot);
            extractor = new TypeScriptExtractor(
                () => tsService.getProgram(),
                ctx.workspaceRoot,
            );
        }
        return extractor;
    };

    const allEntities: EntityHash[] = [];

    for (const fileId of inScope) {
        let buf: Buffer;
        try {
            buf = await ctx.io.readFile(fileId, null);
        } catch {
            // ENOENT / unreadable — evict any stale record and skip.
            delete cache.files[fileId];
            continue;
        }
        const contentHash = sha256Hex(buf.toString('utf8'));

        const prior = cache.files[fileId];
        if (prior && prior.contentHash === contentHash && Array.isArray(prior.entities)) {
            // HIT — reuse cached entity hashes; no parse, no normalize.
            allEntities.push(...entitiesFromCache(prior.entities, fileId));
            continue;
        }

        // MISS — parse + normalize this file.
        const absPath = ctx.io.resolve(fileId);
        const artifact = await ensureExtractor().extract(absPath);
        const source = buf.toString('utf8');
        const records: CachedEntity[] = [];
        const seenNames = new Map<string, number>();

        if (artifact) {
            for (const ent of artifact.entities) {
                if (!CLONEABLE_KINDS.has(ent.kind)) continue;
                const body = source.slice(ent.loc.startByte, ent.loc.endByte);
                const { text, tokenCount } = normalizeBody(body);
                const normalizedHash = sha256Hex(text);
                // SAME body slice, SAME MISS branch — a second cheap scanner, no
                // new parse/Program (warm cache parses zero files; spec §6).
                const literalHashes = extractLiteralHashes(body);

                // Disambiguate same-name entities (e.g. overloads) by byte offset
                // so clone-store-local ids stay unique + stable.
                const count = seenNames.get(ent.name) ?? 0;
                seenNames.set(ent.name, count + 1);
                const name =
                    count === 0 ? ent.name : `${ent.name}@${ent.loc.startByte}`;
                const entityId = makeEntityId(fileId, name);

                records.push({ id: entityId, normalizedHash, tokenCount, literalHashes });
            }
        }

        cache.files[fileId] = { contentHash, entities: records };
        allEntities.push(...entitiesFromCache(records, fileId));
    }

    // Evict cache entries for fileIds no longer in scope (deleted/unwatched).
    for (const key of Object.keys(cache.files)) {
        if (!inScopeSet.has(key)) delete cache.files[key];
    }

    // Deterministic input order for both bucketing passes.
    allEntities.sort((a, b) => a.entityId.localeCompare(b.entityId));
    const exact = clusterClones(allEntities); // Tier-1 exact-body
    const shared = clusterSharedLiterals(allEntities); // Tier-1.5 shared-literal

    // Combine both signals: concatenate findings + edges, re-sort the findings
    // deterministically (severity band → strength → id) so the report reads
    // high→low and the renderer never re-sorts.
    const findings = [...exact.findings, ...shared.findings].sort(compareClones);
    const edges = [...exact.edges, ...shared.edges];

    // Persist clone edges + refreshed cache (the store sorts edges itself).
    const cloneStore = new CloneEdgeListStore(ctx.artifactRoot, ctx.io);
    await cloneStore.load();
    cloneStore.setEdges(edges);
    await cloneStore.save();
    await saveAnalysisCache(ctx, cache);

    return findings;
}
