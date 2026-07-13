/**
 * Clone-cluster severity ranking (distance dimension).
 *
 * Extracted from `clones-literals.ts` (which sits at its layer's file-size
 * budget): the PURE distance/severity helpers shared by both bucketing passes
 * (exact-body in `clones.ts`, shared-literal in `clones-literals.ts`). No IO,
 * no parse — plain string functions over workspace-relative POSIX fileIds.
 */

import type { Severity } from './types';

/**
 * Top-level module of a workspace-relative fileId for the distance dimension:
 * the first TWO segments (`src/application`), so two files under the SAME
 * capability area count as same-module. Outside `src/` → first segment.
 */
function moduleOf(fileId: string): string {
    const parts = fileId.split('/');
    if (parts[0] === 'src' && parts.length >= 2) return parts.slice(0, 2).join('/');
    return parts[0] ?? fileId;
}

/**
 * True iff `fileId` is a test file: under a `tests/` root, in a `__tests__/`
 * folder, or named `*.test.*` / `*.spec.*`. Pure string check on the
 * workspace-relative POSIX id.
 */
export function isTestFile(fileId: string): boolean {
    return (
        fileId.startsWith('tests/') ||
        fileId.includes('/tests/') ||
        fileId.includes('__tests__/') ||
        /\.(test|spec)\./.test(fileId)
    );
}

/**
 * Severity = strength × distance (RANKING ONLY); distance clamps it:
 *   - all members SAME file              → low  (sibling boilerplate)
 *   - different files, SAME top-level mod → medium
 *   - members span DIFFERENT modules      → high (cross-layer)
 *
 * A4 (2026-07-13): distance is measured over NON-TEST files only. A src file
 * mirrored by its own test is expected duplication — the src↔test pair alone
 * must not earn cross-layer `high`. Test members never RAISE severity; they
 * still belong to the cluster (recall-first — members/edges are untouched).
 * An all-test cluster is `low`.
 */
export function clusterSeverity(members: Array<{ fileId: string }>): Severity {
    const files = new Set(members.map(m => m.fileId));
    const nonTest = [...files].filter(f => !isTestFile(f));
    if (nonTest.length <= 1) return 'low';
    const modules = new Set(nonTest.map(moduleOf));
    return modules.size <= 1 ? 'medium' : 'high';
}

/** Human distance tag for a severity (shared by both bucketing passes). */
export function distanceNote(severity: Severity): string {
    return severity === 'low'
        ? ' (same-file sibling-boilerplate)'
        : severity === 'medium'
          ? ' (same-module)'
          : ' (cross-layer)';
}
