/**
 * Clone analyzer — Tier-1 normalized-body hash (Loop 06).
 *
 * `findClones(ctx)` detects Type-1/2 clones across the in-scope files:
 *   1. In-scope file list = the call-edgelist `kind:'file'` nodes (the same
 *      analyzed/watched set the cycle/hub analyzers consume — NOT worktree-state,
 *      which the analysis layer never touches). Deduped + sorted.
 *   2. For each file: content-hash the bytes. On a cache HIT (same contentHash)
 *      reuse the cached per-entity hashes — NO parse, NO normalize. On a MISS,
 *      parse the file's entities via the shared-`ts.Program` `TypeScriptExtractor`,
 *      slice each callable body by `loc.startByte/endByte`, normalize
 *      (comments+whitespace stripped; identifiers AND literals placeholdered),
 *      sha256 the canonical text, and refresh the cache record.
 *   3. Bucket entity hashes; a bucket of size > 1 is a clone cluster.
 *   4. Persist clone edges to the standalone `clone-edgelist.json` and the
 *      refreshed analysis cache (evicting entries for out-of-scope files).
 *
 * Parse cost is deferred: the workspace `ts.Program` / extractor is built LAZILY
 * and ONCE, only on the FIRST cache miss, so a fully-warm `health` parses ZERO
 * files (spec §6).
 *
 * Granularity: only `function | method | arrow` entities are compared (the
 * spec's function/method granularity). `class` entities — whole-class bodies —
 * are excluded to avoid class-vs-class noise.
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

/** Minimal per-entity shape the PURE bucketing fn needs (testable w/o parse/IO). */
export interface EntityHash {
    entityId: string; // <fileId>::<name>[@offset]
    fileId: string; // workspace-rel POSIX
    normalizedHash: string; // sha256 of normalizeBody().text
    tokenCount: number; // for the noise floor
}

/**
 * Top-level module of a workspace-relative fileId for the distance dimension:
 * the first TWO path segments (e.g. `src/application`), so two files under the
 * SAME capability area count as same-module. Files outside `src/` fall back to
 * their first segment.
 */
function moduleOf(fileId: string): string {
    const parts = fileId.split('/');
    if (parts[0] === 'src' && parts.length >= 2) {
        return parts.slice(0, 2).join('/');
    }
    return parts[0] ?? fileId;
}

/**
 * Severity = strength × distance (RANKING ONLY). Strength is fixed for Tier-1
 * (`exact-body`); distance clamps it:
 *   - all members in the SAME file        → `same-file`   → `low`  (sibling boilerplate)
 *   - different files, SAME top-level mod  → `same-module` → `medium`
 *   - members span DIFFERENT modules       → `cross-layer` → `high`
 */
function clusterSeverity(members: EntityHash[]): Severity {
    const files = new Set(members.map(m => m.fileId));
    if (files.size <= 1) return 'low'; // same-file
    const modules = new Set([...files].map(moduleOf));
    return modules.size <= 1 ? 'medium' : 'high'; // same-module : cross-layer
}

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
        const distanceNote =
            severity === 'low'
                ? ' (same-file sibling-boilerplate)'
                : severity === 'medium'
                  ? ' (same-module)'
                  : ' (cross-layer)';

        findings.push({
            id,
            type: 'clone',
            cloneType: 'exact-body',
            similarity: 1,
            severity,
            title: `${memberIds.length}-member exact-body clone${distanceNote}`,
            detail:
                `Exact-body (Type-1/2) clone across ${memberIds.length} entities: ` +
                memberIds.join(', '),
            relatedFiles,
            members: memberIds,
        });

        // Consecutive-chain edges (n-1, deterministic, avoids O(n²) on large
        // boilerplate clusters).
        for (let i = 0; i + 1 < members.length; i++) {
            edges.push({
                source: memberIds[i],
                target: memberIds[i + 1],
                kind: 'clone',
                similarity: 1,
                cloneType: 'exact-body',
                severity,
            });
        }
    }

    // 4. Deterministic order.
    findings.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort(
        (a, b) =>
            a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    );

    return { findings, edges };
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

                // Disambiguate same-name entities (e.g. overloads) by byte offset
                // so clone-store-local ids stay unique + stable.
                const count = seenNames.get(ent.name) ?? 0;
                seenNames.set(ent.name, count + 1);
                const name =
                    count === 0 ? ent.name : `${ent.name}@${ent.loc.startByte}`;
                const entityId = makeEntityId(fileId, name);

                records.push({ id: entityId, normalizedHash, tokenCount });
            }
        }

        cache.files[fileId] = { contentHash, entities: records };
        allEntities.push(...entitiesFromCache(records, fileId));
    }

    // Evict cache entries for fileIds no longer in scope (deleted/unwatched).
    for (const key of Object.keys(cache.files)) {
        if (!inScopeSet.has(key)) delete cache.files[key];
    }

    // Deterministic input order for clusterClones.
    allEntities.sort((a, b) => a.entityId.localeCompare(b.entityId));
    const { findings, edges } = clusterClones(allEntities);

    // Persist clone edges + refreshed cache.
    const cloneStore = new CloneEdgeListStore(ctx.artifactRoot, ctx.io);
    await cloneStore.load();
    cloneStore.setEdges(edges);
    await cloneStore.save();
    await saveAnalysisCache(ctx, cache);

    return findings;
}
