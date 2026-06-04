/**
 * Atomic edge-list publish (Loop 14 extraction of `graph/edgelist.ts`).
 *
 * `writeFileAtomic` writes to a temp file in the SAME directory as the
 * target (so the publish `rename` is same-filesystem and therefore atomic),
 * then renames it over the target. A reader only ever sees the old complete
 * file or the new complete file, never a partially-written one — preventing
 * TORN reads that would silently zero the graph.
 *
 * Exported (re-exported by the `graph/edgelist` barrel) so other publish
 * sites (e.g. the scan manifest writer) can reuse the same temp+rename
 * discipline.
 */

import { WorkspaceIO } from '../../workspace/workspace-io';

/** Monotonic-enough counter for unique temp suffixes within this process. */
let atomicWriteCounter = 0;

/**
 * Atomically publish `content` to `relPath` via temp-write + rename.
 *
 * Writes to `<relPath>.tmp-<pid>-<n>` in the SAME directory as the target
 * (keeping the rename on one filesystem so it is atomic), then renames the
 * temp over the target. On ANY failure the temp file is best-effort
 * unlinked before the error is rethrown, so a failed publish never leaves
 * a stray `.tmp-*` behind and never corrupts the prior valid target.
 *
 * Exported so other publish sites (e.g. the scan manifest writer) can reuse
 * the same temp+rename discipline.
 */
export async function writeFileAtomic(
    io: WorkspaceIO,
    relPath: string,
    content: string | Buffer,
): Promise<void> {
    const suffix = `${process.pid}-${Date.now()}-${atomicWriteCounter++}`;
    const tmpRel = `${relPath}.tmp-${suffix}`;
    try {
        await io.writeFile(tmpRel, content);
        await io.rename(tmpRel, relPath);
    } catch (e) {
        // Best-effort cleanup of the temp file; swallow cleanup errors so
        // the ORIGINAL failure is the one that propagates.
        try {
            await io.unlink(tmpRel);
        } catch {
            // temp may not exist (writeFile itself failed) — ignore.
        }
        throw e;
    }
}
