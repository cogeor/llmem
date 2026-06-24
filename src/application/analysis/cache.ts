/**
 * Analysis-cache sidecar (STUB).
 *
 * Tolerant load / save of a per-workspace analysis cache at
 * `<workspaceRoot>/.llmem/analysis-cache.json`. NOTE: this lives at the
 * WORKSPACE ROOT's `.llmem/` — a sibling of `.llmem/graph` (the artifactRoot) —
 * NOT under `ctx.artifactRoot`.
 *
 * Loop 06 wires real per-file fingerprinting: each `files[fileId]` holds the
 * file's content sha256 plus per-entity normalized-body hashes, so an unchanged
 * file is never re-parsed/re-normalized. Read tolerance mirrors
 * `scan-manifest.ts`: a MISSING or CORRUPT cache returns an empty cache rather
 * than throwing.
 */

import * as path from 'path';
import { writeFileAtomic } from '../../graph/edgelist';
import type { WorkspaceContext } from '../workspace-context';

/** Subdirectory (workspace-root sibling of `.llmem/graph`). */
const CACHE_DIR = '.llmem';

/** Cache filename under `<workspaceRoot>/.llmem/`. */
const CACHE_FILENAME = 'analysis-cache.json';

/** Current cache schema version. */
const CACHE_VERSION = 1 as const;

/**
 * Per-entity cached analysis product. `literalHashes` is added by Loop 07.
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
    // literalHashes?: string[];  // Loop 07 — declared then, not here
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
 * Workspace-relative directory of the cache (`.llmem`), relative to
 * `io.getRealRoot()`, forward-slash normalized.
 */
function cacheDirRel(ctx: WorkspaceContext): string {
    const abs = path.join(ctx.workspaceRoot, CACHE_DIR);
    return path.relative(ctx.io.getRealRoot(), abs).replace(/\\/g, '/');
}

/**
 * Workspace-relative path of the cache file, relative to `io.getRealRoot()`,
 * forward-slash normalized.
 */
function cacheRelPath(ctx: WorkspaceContext): string {
    const abs = path.join(ctx.workspaceRoot, CACHE_DIR, CACHE_FILENAME);
    return path.relative(ctx.io.getRealRoot(), abs).replace(/\\/g, '/');
}

/**
 * Validate that a parsed value is a well-formed v1 cache. Returns it typed as
 * `AnalysisCache` when valid, else `null`.
 *
 * LENIENT by design: we validate only `version === 1` and that `files` is an
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
 * Load `<workspaceRoot>/.llmem/analysis-cache.json` via `ctx.io`. Tolerates a
 * MISSING file or CORRUPT JSON by returning an empty cache. Never throws on
 * those conditions.
 */
export async function loadAnalysisCache(
    ctx: WorkspaceContext,
): Promise<AnalysisCache> {
    const rel = cacheRelPath(ctx);
    let raw: string;
    try {
        raw = await ctx.io.readFile(rel, 'utf-8');
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
 * Serialize `cache` and publish it to `<workspaceRoot>/.llmem/analysis-cache.json`.
 * Ensures the `.llmem` directory exists (it is a workspace-root sibling that may
 * not pre-exist) then writes atomically via LS-10's `writeFileAtomic`.
 */
export async function saveAnalysisCache(
    ctx: WorkspaceContext,
    cache: AnalysisCache,
): Promise<void> {
    await ctx.io.mkdirRecursive(cacheDirRel(ctx));
    const rel = cacheRelPath(ctx);
    const content = JSON.stringify(cache, null, 2);
    await writeFileAtomic(ctx.io, rel, content);
}
