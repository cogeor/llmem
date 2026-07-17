/**
 * Scan-manifest sidecar (LS-05).
 *
 * A self-contained read / diff / write module for a per-file fingerprint
 * sidecar that lets the refresh path decide which files are new, changed, or
 * deleted SINCE the last scan — without re-parsing everything. It is pure
 * data plus a pure diff; it has NO coupling to the edge-list stores or the
 * graph schema.
 *
 * Storage
 * -------
 * The manifest lives at `<artifactRoot>/scan-manifest.json`, where
 * `<artifactRoot>` is `ctx.artifactRoot` (the configured artifact root —
 * `.llmem/graph` by default; see `src/config-defaults.ts`). The path is
 * DERIVED from the context, never a hardcoded artifact-dir literal, so it
 * auto-follows whatever the user configured as `artifactRoot`.
 *
 * Torn-write safety
 * -----------------
 * `writeManifest` publishes through LS-10's `writeFileAtomic` (temp-write +
 * rename in the same directory) — this is the second JSON writer in the
 * refresh path (alongside the edge lists), so an interrupted write must leave
 * the prior valid manifest intact rather than a half-written file.
 *
 * Tolerance
 * ---------
 * A MISSING or CORRUPT manifest is treated as "everything is new": both read
 * paths return an empty `{ version: 1, files: {} }` rather than throwing. This
 * keeps the refresh path robust against a first run or a previously torn write
 * that somehow slipped through.
 *
 * Scope
 * -----
 * Sidecar only. This module does NOT bump the edge-list schema version and
 * does NOT add a field to `NodeEntry`.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { writeFileAtomic } from '../graph/edgelist';
import type { WorkspaceContext } from './workspace-context';
import type { WorkspaceIO } from '../workspace/workspace-io';

/** Filename of the manifest sidecar under the artifact root. */
const MANIFEST_FILENAME = 'scan-manifest.json';

/** Current sidecar schema version. */
const MANIFEST_VERSION = 1 as const;

/**
 * Per-file status recorded in the manifest, mirroring the scan's filter
 * outcomes so a future refresh can reason about why a file is (not) in the
 * graph:
 *   - `parsed`           — the file was parsed into the graph.
 *   - `skipped-size`     — dropped by the byte-size gate.
 *   - `skipped-lines`    — dropped by the line-count gate.
 *   - `skipped-denylist` — dropped by the generated-file denylist gate.
 *   - `error`            — a per-file parse failure (mirrors ScanError).
 */
export type ManifestStatus =
    | 'parsed'
    | 'skipped-size'
    | 'skipped-lines'
    | 'skipped-denylist'
    | 'error';

/** One per-file fingerprint entry. */
export interface ManifestEntry {
    /** Last-modified time in ms (FS-precision varies; size is the tie-break). */
    mtimeMs: number;
    /** Byte size of the file. */
    size: number;
    /** Line count at scan time. */
    lines: number;
    /** Filter/parse outcome for the file. */
    status: ManifestStatus;
    /**
     * Content sha256 (hex) of the file bytes. OPTIONAL: absent on entries
     * written before content-hash freshness (a pre-Loop-10 v1 manifest) — such
     * a hashless entry is treated as `changed` (recompute once) the next time
     * its mtime/size moves, gaining a hash on the rewrite. Never bumps
     * MANIFEST_VERSION, so an old manifest still validates.
     */
    hash?: string;
}

/** The v1 manifest envelope: a version tag plus a path → entry map. */
export interface Manifest {
    version: typeof MANIFEST_VERSION;
    /** Keyed by workspace-relative path (forward slashes). */
    files: Record<string, ManifestEntry>;
}

/**
 * Minimal FS fingerprint the caller supplies to `diffManifest`. Keep this in
 * sync with the fields the changed-check compares (mtimeMs + size).
 */
export interface FsStat {
    mtimeMs: number;
    size: number;
    /**
     * Content sha256 (hex). Supplied by the caller ONLY when mtime/size
     * already differ from the manifest entry (the cheap pre-filter), so the
     * diff never forces a hash read for an unchanged-fingerprint file. Left
     * `undefined` for unchanged files — `diffManifest`'s mtime+size branch
     * keeps them warm without ever reading bytes.
     */
    hash?: string;
}

/**
 * Content sha256 (hex) of `rel`'s bytes. The SINGLE hashing impl for the
 * manifest/refresh subsystem — byte-identical to `src/graph/worktree-state.ts`
 * (`createHash('sha256').update(buf).digest('hex')`, buffer via the null
 * encoding overload). Both `refreshFileGraph` and `refreshFolderGraph` consume
 * it so the two change-detectors converge on ONE method.
 */
export async function hashFile(io: WorkspaceIO, rel: string): Promise<string> {
    const buf = await io.readFile(rel, null);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Classification result of `diffManifest`. */
export interface ManifestDiff {
    /** Paths present in fsStats but absent from the manifest. */
    new: string[];
    /** Paths present in both, classified changed by content hash (behind an mtime+size pre-filter). */
    changed: string[];
    /** Paths present in the manifest (under prefix) but absent from fsStats. */
    deleted: string[];
}

/** A fresh, empty manifest — used for missing/corrupt files ("everything new"). */
function emptyManifest(): Manifest {
    return { version: MANIFEST_VERSION, files: {} };
}

/**
 * Artifact-root-relative path of the manifest sidecar, derived from
 * `ctx.artifactRoot` (NOT a hardcoded artifact literal — it follows the
 * configured artifact root, which may live outside the workspace).
 *
 * Mirrors how the edge-list stores derive their `relPath` against the
 * artifact-scoped IO (a plain filename in practice).
 */
function manifestRelPath(ctx: WorkspaceContext): string {
    const abs = path.join(ctx.artifactRoot, MANIFEST_FILENAME);
    return path.relative(ctx.artifactIo.getRealRoot(), abs).replace(/\\/g, '/');
}

/**
 * Validate that a parsed value is a well-formed v1 manifest. Returns the
 * value typed as `Manifest` when valid, else `null` (the caller falls back to
 * an empty manifest). Permissive on entry shape: a non-object `files` or
 * missing version makes the whole thing untrusted → empty.
 */
function asValidManifest(value: unknown): Manifest | null {
    if (typeof value !== 'object' || value === null) return null;
    const obj = value as Record<string, unknown>;
    if (obj.version !== MANIFEST_VERSION) return null;
    if (typeof obj.files !== 'object' || obj.files === null) return null;
    return { version: MANIFEST_VERSION, files: obj.files as Record<string, ManifestEntry> };
}

/**
 * Load `<artifactRoot>/scan-manifest.json` via `ctx.artifactIo`. Tolerates a MISSING
 * file (ENOENT) or CORRUPT JSON by returning an empty manifest
 * (`{ version: 1, files: {} }`) — both mean "treat everything as new". Never
 * throws on those two conditions.
 */
export async function readManifest(ctx: WorkspaceContext): Promise<Manifest> {
    const rel = manifestRelPath(ctx);
    let raw: string;
    try {
        raw = await ctx.artifactIo.readFile(rel, 'utf-8');
    } catch {
        // Missing (ENOENT) or any read failure → everything-new.
        return emptyManifest();
    }
    try {
        const parsed = JSON.parse(raw);
        return asValidManifest(parsed) ?? emptyManifest();
    } catch {
        // Corrupt JSON → everything-new.
        return emptyManifest();
    }
}

/**
 * Pure diff (no I/O). Classify the files UNDER `subtreePrefix` into new /
 * changed / deleted by comparing `fsStats` (the caller-provided current FS
 * snapshot) against `manifest`:
 *   - new     — in fsStats, not in manifest.
 *   - changed — in both, decided by content HASH behind a CHEAP mtime+size
 *               PRE-FILTER: identical mtime+size → unchanged (no hash read);
 *               otherwise a hashless legacy entry → changed (recompute once),
 *               equal hashes → WARM (a touch/checkout that did not edit bytes),
 *               differing hashes (or no caller-supplied hash) → changed.
 *   - deleted — in manifest (under prefix), not in fsStats.
 *
 * Only paths under `subtreePrefix` are considered on BOTH sides, so a
 * subtree-scoped refresh never reports files outside its subtree as deleted.
 * An empty prefix (`''`) matches everything. The prefix is matched on a
 * normalized `<prefix>/` boundary (or exact match) to avoid `src/a` matching
 * `src/ab`.
 */
export function diffManifest(
    manifest: Manifest,
    fsStats: Record<string, FsStat>,
    subtreePrefix: string,
): ManifestDiff {
    const prefix = subtreePrefix.replace(/\\/g, '/');
    const underPrefix = (p: string): boolean => {
        if (prefix === '' || prefix === '.') return true;
        const norm = p.replace(/\\/g, '/');
        const bounded = prefix.endsWith('/') ? prefix : prefix + '/';
        return norm === prefix || norm.startsWith(bounded);
    };

    const result: ManifestDiff = { new: [], changed: [], deleted: [] };

    for (const [p, stat] of Object.entries(fsStats)) {
        if (!underPrefix(p)) continue;
        const prev = manifest.files[p];
        if (!prev) {
            result.new.push(p);
        } else if (prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) {
            // PRE-FILTER: mtime+size identical → assume unchanged, no hash needed.
            // (unchanged: not pushed to any bucket)
        } else if (prev.hash === undefined) {
            // Hashless legacy entry whose mtime/size moved → recompute ONCE to
            // gain a hash.
            result.changed.push(p);
        } else if (stat.hash !== undefined && prev.hash === stat.hash) {
            // mtime/size moved (touch / checkout) but BYTES identical → WARM.
            // (not pushed — this is the whole point of the loop)
        } else {
            // hash differs (or caller could not supply one) → real change.
            result.changed.push(p);
        }
    }

    for (const p of Object.keys(manifest.files)) {
        if (!underPrefix(p)) continue;
        if (!(p in fsStats)) result.deleted.push(p);
    }

    return result;
}

/**
 * Serialize `manifest` and publish it to `<artifactRoot>/scan-manifest.json`
 * via LS-10's `writeFileAtomic` (temp-write + rename) so an interrupted write
 * leaves the prior valid manifest intact. The artifact directory must already
 * exist (the edge-list save path mkdir's it); writeFileAtomic does not create
 * parents.
 */
export async function writeManifest(
    ctx: WorkspaceContext,
    manifest: Manifest,
): Promise<void> {
    const rel = manifestRelPath(ctx);
    const content = JSON.stringify(manifest, null, 2);
    await writeFileAtomic(ctx.artifactIo, rel, content);
}
