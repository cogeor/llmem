/**
 * Public scan result/request/coverage types, extracted verbatim from the
 * former monolithic `application/scan.ts` (loop 07). These are the shared
 * data shapes that VS Code, the HTTP server, the CLI shim, and the on-demand
 * graph refresh all consume. Re-exported through the `application/scan`
 * barrel so existing import sites keep working unchanged.
 */

/**
 * A per-file failure surfaced to the caller. The scan continues past these
 * (matching the legacy console.warn behavior); callers decide how to render.
 */
export interface ScanError {
    /** Workspace-relative path of the file that failed. */
    filePath: string;
    /** Human-readable error message. */
    message: string;
    /** The original error (Error instance or thrown value). */
    cause: unknown;
}

/** Per-call request fields for `scanFolder` / `scanFolderRecursive`. */
export interface ScanFolderRequest {
    /** Workspace-relative folder path (forward slashes). */
    folderPath: string;
    /**
     * B3 (2026-07-13): invoked once per file handed to a parser, BEFORE the
     * parse, with the workspace-relative path. `scanFolderRecursive` threads
     * the same callback to every subfolder. Hosts use it for progress output
     * (the application layer stays console-free — this is a callback seam,
     * not a print). Callers wanting a running count keep their own counter.
     */
    onFile?: (relPath: string) => void;
}

/** Per-call request fields for `scanFile`. */
export interface ScanFileRequest {
    /** Workspace-relative file path (forward slashes). */
    filePath: string;
}

/**
 * What the scan filter gates excluded, and why. Produced by `scanFolder`
 * and aggregated across subfolders by `scanFolderRecursive`. Consumers
 * (LS-04 renders the caveat in document-folder) read this to surface what
 * was deliberately left out of the graph.
 *
 * The buckets are populated by the three enforcement gates in
 * `scanFolder`'s walk:
 *   - `skippedDenylist` — files matching `isGeneratedFile` (e.g. *.min.js,
 *     *.d.ts).
 *   - `skippedSize` — files larger than `config.maxFileSizeKB * 1024` bytes.
 *   - `skippedLines` — files with more than `config.maxFileLines` lines.
 * Each holds workspace-relative paths (forward slashes), named so callers
 * can tell the user exactly which files were dropped.
 *
 * `overFileCap` is the count of direct children beyond `maxFilesPerFolder`
 * — a DISPLAY-ONLY caveat number, never a reason a file is excluded from
 * the graph (see the maxFilesPerFolder note in `scanFolder`). Optional;
 * the current implementation does not set it.
 *
 * `parseErrors` mirrors `ScanResult.errors` for callers that want the
 * filter-coverage view in one place.
 *
 * python-callgraph adds a heuristic-call-graph caveat bucket here — extend,
 * do not fork.
 */
export interface ScanCoverage {
    /** Files skipped by the byte-size gate (over `maxFileSizeKB * 1024`). */
    skippedSize: string[];
    /** Files skipped by the line-count gate (over `maxFileLines`). */
    skippedLines: string[];
    /** Files skipped by the generated-file denylist gate. */
    skippedDenylist: string[];
    /** Direct children beyond `maxFilesPerFolder` (display-only caveat). */
    overFileCap?: number;
    /** Per-file parse failures (mirrors `ScanResult.errors`). */
    parseErrors: ScanError[];
    /**
     * True when the scanned subtree contains >=1 in-scope source file whose
     * language has a HEURISTIC call graph (currently Python — call edges are
     * name-matched and may miss dynamic dispatch). Set by EXTENSION via
     * `getCallGraphCapability`, parse-independent (fires even when the
     * grammar is not installed). Consumers (PC-03) inject a one-line caveat
     * near the FUNCTION CALLS section so the LLM does not read missing
     * Python call edges as evidence of loose coupling. Absent/false for
     * pure-semantic (TS/JS) folders so they get no noise.
     */
    heuristicCallGraph?: boolean;
}

/**
 * Result of a scan operation. Structured so CLI/HTTP/extension callers can
 * each render output in their own way.
 */
export interface ScanResult {
    /** Number of files processed (parser succeeded). */
    filesProcessed: number;
    /** Number of files skipped (no parser, or per-file failure). */
    filesSkipped: number;
    /** Per-file failures. Empty array when none. */
    errors: ScanError[];
    /** Net new edges added across both stores (call + import). */
    newEdges: number;
    /** Total edges across both stores after the operation. */
    totalEdges: number;
    /**
     * Per-extension count of source-like files that were silently dropped
     * because no parser is registered for them — keyed by lowercased
     * extension (with leading dot, matching the keys of
     * `SOURCE_LIKE_INSTALL_HINTS`). Always present; `{}` when no
     * allowlist files were skipped (or the scan was a single-file scan).
     *
     * Callers format this via `formatUnsupportedSourceHints` so the
     * C/C++-family-collapsing logic lives in one place.
     */
    unsupportedSourceLikeCounts: Record<string, number>;
    /**
     * What the filter gates (denylist / byte-size / line-count) excluded
     * from this scan, with the offending files named. Aggregated across
     * subfolders by `scanFolderRecursive`. See {@link ScanCoverage}.
     */
    coverage: ScanCoverage;
}
