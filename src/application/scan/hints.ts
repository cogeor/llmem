/**
 * Unsupported-source-like install-hint formatting, extracted from
 * `application/scan.ts` (loop 07). The allowlist + the C/C++-family
 * collapsing logic live here in one place; the scan walk accumulates the
 * per-extension counts and callers render them via
 * `formatUnsupportedSourceHints`.
 */

import { LANGUAGE_DESCRIPTORS } from '../../core/language-descriptors';

/**
 * Source-like extension → install-hint package, derived from the
 * `LANGUAGE_DESCRIPTORS` static metadata: every language that declares a
 * `grammarPackage` (i.e. needs a
 * tree-sitter grammar to parse) contributes its extensions, each mapped to
 * that grammar package. TypeScript/JavaScript has no grammarPackage and so
 * is excluded — it is always parsable via the compiler API and never needs a
 * hint.
 *
 * This is the install-hint surface, NOT runtime registry state: it nudges
 * users toward grammars they have not installed yet, so it must list every
 * known source-like extension regardless of what is currently loaded.
 *
 * All C/C++ family extensions (`.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`,
 * `.hxx`) share the `tree-sitter-cpp` package and collapse to a single hint
 * at format time. Keys are lowercased extensions with a leading dot (matching
 * the output of `path.extname().toLowerCase()`).
 */
export const SOURCE_LIKE_INSTALL_HINTS: ReadonlyMap<string, string> = new Map(
    LANGUAGE_DESCRIPTORS.filter((l) => l.grammarPackage).flatMap((l) =>
        l.extensions.map((e): [string, string] => [e.toLowerCase(), l.grammarPackage!]),
    ),
);

/** Lowercased C/C++ family extensions — collapse to a single hint line. */
export const CPP_FAMILY_EXTS: ReadonlySet<string> = new Set([
    '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx',
]);

/**
 * Format `ScanResult.unsupportedSourceLikeCounts` into zero or more
 * human-readable hint lines. Pure function — no I/O, no logging.
 *
 * Behavior:
 *  - Returns `[]` when every count is 0 / the map is empty.
 *  - Collapses all C/C++ family entries into one combined line keyed by
 *    `tree-sitter-cpp`.
 *  - Collapses `.r` (we lowercase at accumulation time, so `.R` lands
 *    under `.r`) into one line naming both candidate packages.
 *  - Other extensions get one line each, with the literal lowercased
 *    extension in the message.
 *  - Singular vs plural is not branched — "1 .py files" is acceptable
 *    per the loop-03 plan.
 */
export function formatUnsupportedSourceHints(
    counts: Record<string, number>,
): string[] {
    const lines: string[] = [];

    // C/C++ family: sum across all family extensions, emit one line.
    let cppTotal = 0;
    for (const ext of CPP_FAMILY_EXTS) {
        cppTotal += counts[ext] ?? 0;
    }
    if (cppTotal > 0) {
        lines.push(
            `Skipped ${cppTotal} C/C++ files — install tree-sitter-cpp to include them.`,
        );
    }

    // Remaining extensions in deterministic order (insertion order of the
    // allowlist). Skip C/C++ family members (already handled above) and
    // any entry with count 0.
    for (const [ext, hint] of SOURCE_LIKE_INSTALL_HINTS) {
        if (CPP_FAMILY_EXTS.has(ext)) continue;
        const n = counts[ext] ?? 0;
        if (n <= 0) continue;
        lines.push(`Skipped ${n} ${ext} files — install ${hint} to include them.`);
    }

    return lines;
}
