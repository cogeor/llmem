/**
 * Shared parser-runner, factored from the duplicated `getParser` try/catch +
 * `extract` logic in `scanFile` (former scan.ts:290-339) and `scanFolder`
 * (former scan.ts:528-559) (loop 07). Centralizes the three failure modes
 * (init-error / no-parser / extract-error) and the langId logging so the
 * single-file refresh (loop 08) and the folder walk share one runner.
 *
 * Error-message discipline: scanFile and scanFolder historically emitted
 * SLIGHTLY different error strings for the same failure mode (scanFile keyed
 * on the lowercased extension, scanFolder on the relative path). To preserve
 * EXACT behavior, this runner does NOT format the ScanError message itself —
 * it surfaces the raw `kind` + the original error, and the caller builds the
 * message string verbatim. The runner owns only the control flow + the
 * tree-sitter native-module hint is appended by the caller.
 */

import type { ParserRegistry } from '../../parser/registry';
import { artifactToEdgeList, type ConversionResult } from '../artifact-converter';
import type { Logger } from '../../core/logger';

/** Inputs to {@link runParser}. */
export interface RunParserInput {
    /** Workspace-relative path (forward slashes) — used for the langId log. */
    rel: string;
    /** Absolute path on disk — passed to `parser.extract`. */
    absPath: string;
    /** Workspace root — passed to `registry.getParser`. */
    workspaceRoot: string;
    /**
     * Emit the `[GenerateEdges] Processing <langId> file: <rel>` progress log
     * (only when a parser exists, matching the legacy scanFile/scanFolder
     * behavior). Defaults to `true` so the scan use-cases are unchanged.
     *
     * The single-file refresh path (refresh-graph.ts, loop 08) passes `false`:
     * pre-loop-08 `refreshFileGraph` parsed inline WITHOUT this log, and the
     * CLI `document` path routes a stdout logger through it — emitting the line
     * would break the positional-vs-`--path` stdout parity (and is just noise
     * on a freshness refresh). Keeping the runner silent there preserves the
     * exact prior behavior.
     */
    logProgress?: boolean;
    /**
     * When true, the converter omits external-module import edges/nodes
     * (internal workspace edges + all call edges only). Threaded from
     * `ctx.config.internalOnly` by the scan/refresh callers. Defaults to
     * `false` here so the runner's own back-compat (and any caller that
     * does not set it) keeps emitting externals, matching
     * `artifactToEdgeList`'s default.
     */
    internalOnly?: boolean;
}

/**
 * Outcome of running the parser for one file. On success, exposes the
 * converted edge-list payload (nodes/callEdges/importEdges) ready for the
 * edge-writer. On failure, exposes the discriminating `kind` + the original
 * error so the caller can format the exact ScanError message it always did.
 */
export type RunParserResult =
    | { ok: true; conversion: ConversionResult }
    | { ok: false; kind: 'init-error'; error: unknown }
    | { ok: false; kind: 'no-parser' }
    | { ok: false; kind: 'no-artifact' }
    | { ok: false; kind: 'extract-error'; error: unknown };

/**
 * Acquire the parser for `rel`, parse `absPath`, and convert the artifact to
 * edge-list entries. Mirrors the original inline flow exactly:
 *   1. `registry.getParser` — a throw (tree-sitter native-module construction
 *      failure) yields `{ ok:false, kind:'init-error', error }`.
 *   2. a null parser (no registered extractor) yields
 *      `{ ok:false, kind:'no-parser' }`.
 *   3. log `[GenerateEdges] Processing ${langId} file: ${rel}` (langId via
 *      `registry.getLanguageId(absPath)`), then `parser.extract`.
 *        - a falsy artifact (`!artifact`) yields `{ ok:false, kind:'no-artifact' }`
 *          — scanFolder treats this as a SILENT continue (no error, no skip),
 *          while scanFile turns it into its `Failed to process` throw. Kept
 *          DISTINCT so neither caller's behavior changes.
 *        - a throw from `extract` yields `{ ok:false, kind:'extract-error', error }`.
 *   4. on success, `artifactToEdgeList(artifact, rel)` →
 *      `{ ok:true, conversion }`.
 */
export async function runParser(
    registry: ParserRegistry,
    logger: Logger,
    input: RunParserInput,
): Promise<RunParserResult> {
    const { rel, absPath, workspaceRoot, logProgress = true, internalOnly = false } = input;

    let parser;
    try {
        parser = registry.getParser(rel, workspaceRoot);
    } catch (e: unknown) {
        return { ok: false, kind: 'init-error', error: e };
    }

    if (!parser) {
        return { ok: false, kind: 'no-parser' };
    }

    // Progress log fires only when a parser exists (matching the legacy
    // post-null-check placement) and only when the caller opts in.
    if (logProgress) {
        const langId = registry.getLanguageId(absPath);
        logger.debug?.(`[GenerateEdges] Processing ${langId} file: ${rel}`);
    }

    try {
        const artifact = await parser.extract(absPath);
        // A falsy artifact is NOT an error: scanFolder continues silently and
        // scanFile turns it into its own throw. Surface a distinct kind so the
        // caller decides — but do it BEFORE artifactToEdgeList so a falsy
        // artifact never reaches the converter.
        if (!artifact) {
            return { ok: false, kind: 'no-artifact' };
        }
        const conversion = artifactToEdgeList(artifact, rel, { internalOnly });
        return { ok: true, conversion };
    } catch (e: unknown) {
        return { ok: false, kind: 'extract-error', error: e };
    }
}
