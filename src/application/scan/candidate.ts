/**
 * The single per-file candidate classifier, extracted from the inline gate
 * decision in `scanFolder`'s walk (former scan.ts lines ~457-509) so the
 * on-demand single-file refresh (loop 08) can reuse the EXACT same gate
 * order instead of mirroring it.
 *
 * Gate order (MUST be preserved exactly — see the original scanFolder walk):
 *   1. denylist  — `isGeneratedFile(basename)` (name-only, no I/O).
 *   2. byte-size — `sizeBytes > config.maxFileSizeKB * 1024`.
 *   3. heuristic — `getCallGraphCapability(rel) === 'heuristic'`, computed
 *      AFTER denylist+size (only for in-scope children) as a parse-independent
 *      side flag. Reported via `heuristic` so the caller can OR it into
 *      coverage. NOT a skip reason.
 *   4. unsupported-source-like accounting — `SOURCE_LIKE_INSTALL_HINTS.has(ext)
 *      && !registry.getParser(...)`. SEPARATE from the gate decision; reported
 *      via `sourceLikeUnsupported` so the caller (scanFolder's walk) can keep
 *      its per-extension accumulation. Computed only for files that pass
 *      denylist+size, mirroring the original walk.
 *   5. line gate — only for `registry.isSupported(basename)` files:
 *      `countFileLines(absPath) > config.maxFileLines` → 'skipped-lines',
 *      else 'parse'. This reads the file and runs LAST, only for supported
 *      files. Boundary: exactly `maxFileLines` is KEPT; `+1` is SKIPPED.
 *
 * An unsupported file (not denylisted, within size, not `isSupported`) yields
 * the `'unsupported'` decision — it is neither parsed nor a §7 coverage gate.
 *
 * Note: `getParser` can throw (tree-sitter native-module construction); the
 * classifier swallows that here only for the source-like-unsupported probe,
 * matching the original walk where `registry.getParser` was called inside the
 * `SOURCE_LIKE_INSTALL_HINTS.has(ext)` branch (a throw there propagated). To
 * preserve EXACT behavior, the classifier does NOT call `getParser` on the
 * parse path — the caller's parser-runner owns that try/catch.
 */

import * as path from 'path';
import { isGeneratedFile, getCallGraphCapability } from '../../parser/config';
import { countFileLines } from '../../parser/line-counter';
import type { ParserRegistry } from '../../parser/registry';
import type { RuntimeConfig } from '../workspace-context';

/** Why the classifier landed on its decision. */
export type ScanCandidateDecision =
    | 'skipped-denylist'
    | 'skipped-size'
    | 'skipped-lines'
    | 'unsupported'
    | 'parse';

/** Inputs to {@link classifyScanCandidate}. */
export interface ScanCandidateInput {
    /** Workspace-relative path (forward slashes). */
    rel: string;
    /** Basename of the file (used for denylist + isSupported, name-only). */
    basename: string;
    /** Byte size of the file (already stat'd by the caller). */
    sizeBytes: number;
    /** Absolute path on disk (used by the line gate's file read). */
    absPath: string;
    /** Runtime config supplying maxFileSizeKB / maxFileLines. */
    config: RuntimeConfig;
    /** Parser registry (used for the source-like-unsupported probe + isSupported). */
    registry: ParserRegistry;
    /** Workspace root (the source-like-unsupported probe passes it to getParser). */
    workspaceRoot: string;
}

/** Result of {@link classifyScanCandidate}. */
export interface ScanCandidateResult {
    /** The gate decision (skip reason, 'unsupported', or 'parse'). */
    decision: ScanCandidateDecision;
    /**
     * True when the file's LANGUAGE has a heuristic call graph (currently
     * Python). Parse-independent; the caller ORs this into
     * `coverage.heuristicCallGraph`. Set for any in-scope child (computed
     * after the denylist+size gates), regardless of the final decision.
     */
    heuristic: boolean;
    /** Lowercased extension with leading dot (matches `path.extname`). */
    ext: string;
    /**
     * True when this file is a `SOURCE_LIKE_INSTALL_HINTS` extension for which
     * `registry.getParser` returned null — i.e. a file we would silently drop
     * because no parser is registered. The caller increments its per-extension
     * `unsupportedSourceLikeCounts` accumulator keyed by `ext` when this is set.
     * Only meaningful when the file passed the denylist+size gates.
     */
    sourceLikeUnsupported: boolean;
    /**
     * Line count, present only when the line gate ran (i.e. the file is
     * `isSupported`). Absent for denylist/size skips and unsupported files,
     * which never read the file.
     */
    lines?: number;
}

/**
 * Lazy import to avoid a static cycle (`hints.ts` imports nothing from here,
 * but keeping the set behind the function call mirrors the original inline
 * access at the scanFolder call-site and keeps the gate self-contained).
 */
import { SOURCE_LIKE_INSTALL_HINTS } from './hints';

/**
 * Classify a single file against the scan gates in their canonical order.
 * Pure-ish: the only side effect is the line gate's file read via
 * `countFileLines` (matching the original walk, which read the file last and
 * only for supported files).
 */
export function classifyScanCandidate(input: ScanCandidateInput): ScanCandidateResult {
    const { rel, basename, sizeBytes, absPath, config, registry, workspaceRoot } = input;
    const maxFileSizeBytes = config.maxFileSizeKB * 1024;
    const maxFileLines = config.maxFileLines;

    // Gate 1 — denylist (name-only, no I/O).
    if (isGeneratedFile(basename)) {
        return {
            decision: 'skipped-denylist',
            heuristic: false,
            ext: path.extname(basename).toLowerCase(),
            sourceLikeUnsupported: false,
        };
    }

    // Gate 2 — byte-size (free: caller already stat'd).
    if (sizeBytes > maxFileSizeBytes) {
        return {
            decision: 'skipped-size',
            heuristic: false,
            ext: path.extname(basename).toLowerCase(),
            sourceLikeUnsupported: false,
        };
    }

    const ext = path.extname(basename).toLowerCase();

    // Gate 3 — heuristic-call-graph flag (parse-independent, by extension).
    // Computed AFTER denylist/size for any in-scope child; NOT a skip reason.
    const heuristic = getCallGraphCapability(rel) === 'heuristic';

    // Gate 4 — source-like-unsupported accounting (SEPARATE from the decision).
    let sourceLikeUnsupported = false;
    if (SOURCE_LIKE_INSTALL_HINTS.has(ext)) {
        if (!registry.getParser(absPath, workspaceRoot)) {
            sourceLikeUnsupported = true;
        }
    }

    // Gate 5 — line gate, only for files we'd actually parse. Reads the file
    // (do it last). Boundary ">": exactly maxFileLines is KEPT, +1 SKIPPED.
    if (registry.isSupported(basename)) {
        const lines = countFileLines(absPath);
        if (lines > maxFileLines) {
            return { decision: 'skipped-lines', heuristic, ext, sourceLikeUnsupported, lines };
        }
        return { decision: 'parse', heuristic, ext, sourceLikeUnsupported, lines };
    }

    // Not denylisted, within size, but no parser registered for it.
    return { decision: 'unsupported', heuristic, ext, sourceLikeUnsupported };
}
