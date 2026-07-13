/**
 * One-time, idempotent, conflict-safe docs migration: `.arch` → `.llmem/docs`.
 *
 * Background
 * ----------
 * Before VS-B1 the AI-authored documentation tree lived in `.arch/`. It now
 * lives under `.llmem/docs` (see `src/docs/doc-store.ts` — `DOCS_DIR`).
 * Existing users have hand-authored, NON-regenerable docs in the legacy
 * `.arch/` dir, so we must carry those over exactly once at workspace-context
 * init — never silently clobbering anything.
 *
 * Scope
 * -----
 * Only docs migrate. Edge lists and the webview regenerate, and `.artifacts/`
 * (and `.llmem/graph`) are regenerable cache — this helper NEVER touches them.
 *
 * Design
 * ------
 * Whole-directory move via a single `fs.rename` (atomic + all-or-nothing on the
 * same volume — the dominant case, so no half-moved-tree trap). The rare
 * cross-volume case (EXDEV) falls back to copy-all → verify → unlink-source,
 * and on any failure leaves `.arch` intact + warns (never unlink before the
 * copy is verified).
 *
 * Operates on ABSOLUTE paths under `workspaceRoot`. This is a one-time init
 * move of top-level dirs; the realpath-safe `WorkspaceIO` surface (which has no
 * `rename`) is for in-workspace file ops, not whole-dir top-level moves.
 *
 * Call site: `initWorkspaceContext` (src/application/workspace-context.ts) —
 * the host-startup factory, NOT the pure `createWorkspaceContext`. It runs once
 * per host startup (CLI command, serve, MCP, extension panel), after the
 * workspace root is resolved, so the already-migrated path must be cheap — a
 * single `.llmem/docs` exists() check short-circuits before any other work.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DOCS_DIR } from '../docs/doc-store';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';

const LEGACY_DIR = '.arch';

/** Outcome of a `migrateDocs` call (for tests + structured logging). */
export interface MigrateResult {
    readonly action:
        | 'none' // no-op: no legacy, or already migrated, or new-only
        | 'migrated' // clean same-volume rename move
        | 'copied-exdev' // cross-volume copy → verify → unlink-source
        | 'conflict-skipped'; // both present → left untouched, warned
}

/** Does the path exist (any type)? Absolute-path probe; no realpath. */
async function pathExists(abs: string): Promise<boolean> {
    try {
        await fs.stat(abs);
        return true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw err;
    }
}

/**
 * Recursively copy `srcDir` → `destDir`, then verify the copy (entry-by-entry
 * file count + byte sizes). Throws if verification fails. Used only on the
 * EXDEV cross-volume fallback. Does NOT touch the source.
 */
async function copyDirVerified(srcDir: string, destDir: string): Promise<void> {
    await fs.cp(srcDir, destDir, { recursive: true, errorOnExist: false });
    await verifyTree(srcDir, destDir);
}

/** Assert every file/dir under `srcDir` exists under `destDir` with same size. */
async function verifyTree(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcChild = path.join(srcDir, entry.name);
        const destChild = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            const destStat = await fs.stat(destChild);
            if (!destStat.isDirectory()) {
                throw new Error(`migrate verify: ${destChild} is not a directory`);
            }
            await verifyTree(srcChild, destChild);
        } else {
            const [srcStat, destStat] = await Promise.all([
                fs.stat(srcChild),
                fs.stat(destChild),
            ]);
            if (srcStat.size !== destStat.size) {
                throw new Error(
                    `migrate verify: size mismatch for ${entry.name} ` +
                        `(${srcStat.size} != ${destStat.size})`,
                );
            }
        }
    }
}

/**
 * One-time idempotent, conflict-safe move of the legacy `.arch/` docs tree to
 * `.llmem/docs/` under `workspaceRoot`. See module header for the full
 * contract. The four cases:
 *
 *   1. NO-LEGACY (neither dir)                 → 'none'
 *   2. LEGACY-ONLY (.arch only)                → 'migrated' (or 'copied-exdev')
 *   3. NEW-ONLY (.llmem/docs only)             → 'none'
 *   4. BOTH-PRESENT CONFLICT                   → 'conflict-skipped' (untouched)
 *
 * Never overwrites/merges an existing `.llmem/docs`. Never touches
 * `.artifacts/` or `.llmem/graph`. Never crashes init — a rename failure
 * (lock, race) leaves `.arch` intact and warns.
 */
export async function migrateDocs(
    workspaceRoot: string,
    logger: Logger = NoopLogger,
): Promise<MigrateResult> {
    const docsAbs = path.join(workspaceRoot, DOCS_DIR);

    // Warm-init fast path: destination already exists → nothing to do for the
    // NEW-ONLY case. For the BOTH-PRESENT case we still must detect + warn, so
    // only short-circuit when the legacy dir is absent.
    const docsExists = await pathExists(docsAbs);

    const archAbs = path.join(workspaceRoot, LEGACY_DIR);
    const archExists = await pathExists(archAbs);

    // (1) NO-LEGACY and (3) NEW-ONLY: nothing to migrate.
    if (!archExists) {
        return { action: 'none' };
    }

    // (4) BOTH-PRESENT CONFLICT: leave both trees fully untouched, warn once.
    if (docsExists) {
        logger.warn(
            `LLMem docs migration skipped: a legacy '${LEGACY_DIR}' directory ` +
                `remains and '${DOCS_DIR}' already exists. Both were left ` +
                `untouched; resolve manually (e.g. a future ` +
                `'llmem migrate --force') to avoid losing docs.`,
        );
        return { action: 'conflict-skipped' };
    }

    // (2) LEGACY-ONLY: move `.arch` → `.llmem/docs`. Ensure `.llmem/` parent
    // exists, then a single whole-dir rename (atomic on same volume).
    await fs.mkdir(path.dirname(docsAbs), { recursive: true });
    try {
        await fs.rename(archAbs, docsAbs);
        logger.info(`LLMem migrated docs: ${LEGACY_DIR} -> ${DOCS_DIR}`);
        return { action: 'migrated' };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            // Concurrent init won the race and already moved `.arch`. Treat as
            // already-migrated no-op.
            return { action: 'none' };
        }
        if (code === 'EXDEV') {
            // Cross-volume: copy-all → verify → unlink source. On ANY failure,
            // leave `.arch` intact and warn (never unlink before verify).
            try {
                await copyDirVerified(archAbs, docsAbs);
            } catch (copyErr) {
                logger.warn(
                    `LLMem docs migration failed (cross-volume copy): ` +
                        `${(copyErr as Error).message}. Legacy '${LEGACY_DIR}' ` +
                        `was left intact.`,
                );
                return { action: 'conflict-skipped' };
            }
            await fs.rm(archAbs, { recursive: true, force: true });
            logger.info(
                `LLMem migrated docs (cross-volume): ${LEGACY_DIR} -> ${DOCS_DIR}`,
            );
            return { action: 'copied-exdev' };
        }
        // Other failure (e.g. Windows lock by a running arch-watcher). Leave
        // `.arch` intact and warn — never crash init.
        logger.warn(
            `LLMem docs migration failed: ${(err as Error).message}. ` +
                `Legacy '${LEGACY_DIR}' was left intact.`,
        );
        return { action: 'conflict-skipped' };
    }
}
