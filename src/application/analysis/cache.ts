/**
 * Analysis-cache sidecar (STUB).
 *
 * Tolerant load / save of a per-workspace analysis cache at
 * `<artifactRoot>/analysis-cache.json` (via `ctx.artifactIo`). It is a CACHE,
 * not a deliverable, so it follows the artifact store — with `--artifact-root`
 * or `--store global` it must not leak into the analyzed workspace. It
 * historically lived at `<workspaceRoot>/.llmem/analysis-cache.json`; a legacy
 * file there is simply orphaned and ignored (the same "stale → recompute once"
 * contract as a CACHE_VERSION bump).
 *
 * Loop 06 wires real per-file fingerprinting: each `files[fileId]` holds the
 * file's content sha256 plus per-entity normalized-body hashes, so an unchanged
 * file is never re-parsed/re-normalized. Read tolerance mirrors
 * `scan-manifest.ts`: a MISSING or CORRUPT cache returns an empty cache rather
 * than throwing.
 *
 * Loop 07 makes `literalHashes` a first-class cached product per entity (the
 * shared-literal payload hashes — see `clones-literals.ts`) and BUMPS
 * `CACHE_VERSION` 1 → 2. A v1 record has no `literalHashes`, so `asValidCache`
 * now rejects the whole v1 envelope (`version !== 2`) and degrades to empty —
 * exactly the "stale → recompute once" contract Loop 06 already relies on. After
 * the first Loop-07 `health` run every entity carries `literalHashes`, so the
 * bucketing pass never sees a record missing them (no crash, no silent miss).
 */

import { writeFileAtomic } from '../../graph/edgelist';
import type { WorkspaceContext } from '../workspace-context';

/** Cache filename under `ctx.artifactRoot` (addressed via `ctx.artifactIo`). */
const CACHE_FILENAME = 'analysis-cache.json';

/** Current cache schema version. Bumped 1 → 2 by Loop 07 (adds `literalHashes`). */
const CACHE_VERSION = 2 as const;

/**
 * Per-entity cached analysis product. `literalHashes` added by Loop 07 (required).
 */
export interface CachedEntity {
    /** Entity id (`<fileId>::<name>[@offset]`). */
    id: string;
    /** Tier-1 normalized-body sha256. */
    normalizedHash: string;
    /**
     * Token count of the entity's body — cached so a HIT can still apply the
     * noise floor without re-reading/normalizing the body.
     */
    tokenCount: number;
    /**
     * Loop 07: sorted, kind-prefixed sha256 hashes of the entity's literal
     * payloads (`extractLiteralHashes`). Cached so a HIT reuses them with no
     * re-parse — the shared-literal bucketing runs purely from the cache.
     */
    literalHashes: string[];
}

/** Per-file cached analysis product. */
export interface CachedFile {
    /** sha256 of the file bytes. */
    contentHash: string;
    entities: CachedEntity[];
}

/** The v1 analysis-cache envelope. */
export interface AnalysisCache {
    version: typeof CACHE_VERSION;
    /** Per-file analysis products (keyed by workspace-relative POSIX fileId). */
    files: Record<string, CachedFile>;
}

/** A fresh, empty cache — used for missing/corrupt files. */
function emptyCache(): AnalysisCache {
    return { version: CACHE_VERSION, files: {} };
}

/**
 * Validate that a parsed value is a well-formed v2 cache. Returns it typed as
 * `AnalysisCache` when valid, else `null`. A stale v1 envelope fails the
 * `version` check and degrades to empty (recompute once — Loop 07 migration).
 *
 * LENIENT by design: we validate only `version === 2` and that `files` is an
 * object. We do NOT deep-validate each `CachedFile` — a partially-written or
 * future-shaped record should degrade to "miss → recompute", never crash. A
 * malformed record simply won't `contentHash`-equal the current file hash in
 * `clones.ts`, so it is naturally treated as a miss and overwritten.
 */
function asValidCache(value: unknown): AnalysisCache | null {
    if (typeof value !== 'object' || value === null) return null;
    const obj = value as Record<string, unknown>;
    if (obj.version !== CACHE_VERSION) return null;
    if (typeof obj.files !== 'object' || obj.files === null) return null;
    return {
        version: CACHE_VERSION,
        files: obj.files as Record<string, CachedFile>,
    };
}

/**
 * Load `<artifactRoot>/analysis-cache.json` via `ctx.artifactIo`. Tolerates a
 * MISSING file or CORRUPT JSON by returning an empty cache. Never throws on
 * those conditions.
 */
export async function loadAnalysisCache(
    ctx: WorkspaceContext,
): Promise<AnalysisCache> {
    let raw: string;
    try {
        raw = await ctx.artifactIo.readFile(CACHE_FILENAME, 'utf-8');
    } catch {
        return emptyCache();
    }
    try {
        const parsed = JSON.parse(raw);
        return asValidCache(parsed) ?? emptyCache();
    } catch {
        return emptyCache();
    }
}

/**
 * Serialize `cache` and publish it to `<artifactRoot>/analysis-cache.json`,
 * atomically via LS-10's `writeFileAtomic`. The artifact root itself is
 * guaranteed to exist (the context factory mkdirs it), so no mkdir here.
 */
export async function saveAnalysisCache(
    ctx: WorkspaceContext,
    cache: AnalysisCache,
): Promise<void> {
    const content = JSON.stringify(cache, null, 2);
    await writeFileAtomic(ctx.artifactIo, CACHE_FILENAME, content);
}
