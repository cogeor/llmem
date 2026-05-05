// tests/arch/file-size-budget.test.ts
//
// Loop 15 — file-size budget for the webview UI subtree.
//
// Every TS/TSX file under `src/webview/ui/**` must stay ≤ 400 lines, OR
// sit on the explicit `KNOWN_OVER_BUDGET` allowlist with a `phase` and a
// `reason`. The allowlist is intentionally narrow: it exists to track
// large files that an upcoming loop already owns (e.g. `HierarchicalLayout`
// + `Worktree` belong to loop 16's scope per `.delegate/work/.../LOOPS.yaml`).
//
// The 400-line cap is a forcing function for module decomposition — when
// a single file gets that large the per-responsibility split is almost
// always cheaper than the next behavior change. Mirrors the same red-line
// shape as `tests/arch/console-discipline.test.ts` (allowlist + stale-row
// detection).
//
// Implementation notes:
//   - Walk uses the same skip-dir / skip-file rules as
//     `console-discipline.test.ts` so behavior is consistent across
//     architecture tests.
//   - The `libs/` directory under `src/webview/ui/` is vendored
//     vis-network/etc. shims that we do not own — skipped.
//   - Both the report and the assertion use the same line-count
//     algorithm (`split('\n').length`) so off-by-one drift between the
//     two cannot cause flakes.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_WEBVIEW_UI = path.join(REPO_ROOT, 'src', 'webview', 'ui');

const MAX_LINES = 400;

interface OverBudgetEntry {
    /** Forward-slash, repo-relative path. */
    readonly rel: string;
    /** Allowed ceiling — current observed count + small slack (≤ +10). */
    readonly maxLines: number;
    /** Phase that owns the eventual fix (matches LOOPS.yaml ids). */
    readonly phase: string;
    /** One-line justification. */
    readonly reason: string;
}

/**
 * Allowlist: files that may exceed `MAX_LINES` until the named phase
 * lands. The `maxLines` ceiling caps growth — refactors during
 * intervening loops cannot push the file higher than this number even
 * while it waits for its decomposition phase.
 *
 * Loop 15 lands with two entries: `HierarchicalLayout.ts` and
 * `Worktree.ts`. Both are explicitly out of scope for loop 15 per the
 * orchestrator's plan ("DO NOT touch HierarchicalLayout / Worktree
 * internals" — owned by loop 16).
 */
const KNOWN_OVER_BUDGET: readonly OverBudgetEntry[] = [
    {
        rel: 'src/webview/ui/graph/HierarchicalLayout.ts',
        maxLines: 760,
        phase: 'loop-16',
        reason:
            'Layout type-out + extraction owned by loop 16 per LOOPS.yaml ' +
            '("DO NOT touch HierarchicalLayout internals" in loop-15 scope).',
    },
    {
        rel: 'src/webview/ui/components/Worktree.ts',
        maxLines: 490,
        phase: 'loop-16',
        reason:
            'Worktree helper extraction owned by loop 16 per LOOPS.yaml ' +
            '("DO NOT touch Worktree internals" in loop-15 scope).',
    },
];

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(name: string): boolean {
    return (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.artifacts' ||
        name === '.arch' ||
        // libs/ holds vendored third-party shims (vis-network, etc.). We
        // do not own their line counts.
        name === 'libs'
    );
}

function shouldSkipFile(name: string): boolean {
    if (name.endsWith('.d.ts')) return true;
    if (name.endsWith('.d.ts.map')) return true;
    if (name.endsWith('.js')) return true;
    if (name.endsWith('.js.map')) return true;
    if (name.endsWith('.test.ts')) return true;
    // Cover .ts and .tsx; future TSX migration is included in the gate.
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return true;
    return false;
}

function walkSrc(root: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            walkSrc(full, out);
        } else if (entry.isFile() && !shouldSkipFile(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function countLines(filePath: string): number {
    return fs.readFileSync(filePath, 'utf-8').split('\n').length;
}

interface FileMeasurement {
    readonly rel: string;
    readonly lines: number;
}

function measureAll(): FileMeasurement[] {
    const files = walkSrc(SRC_WEBVIEW_UI);
    return files.map((f) => ({ rel: toRepoRel(f), lines: countLines(f) }));
}

function findAllowlistEntry(rel: string): OverBudgetEntry | undefined {
    return KNOWN_OVER_BUDGET.find((e) => e.rel === rel);
}

test('file-size-budget: every src/webview/ui/** TS file is <= 400 lines (or on the allowlist)', () => {
    const measured = measureAll();
    const offenders: { rel: string; lines: number; allowed?: number }[] = [];

    for (const m of measured) {
        if (m.lines <= MAX_LINES) continue;
        const allow = findAllowlistEntry(m.rel);
        if (allow === undefined) {
            offenders.push({ rel: m.rel, lines: m.lines });
            continue;
        }
        if (m.lines > allow.maxLines) {
            offenders.push({ rel: m.rel, lines: m.lines, allowed: allow.maxLines });
        }
    }

    if (offenders.length > 0) {
        for (const o of offenders) {
            const ceiling =
                o.allowed === undefined
                    ? `>${MAX_LINES} lines`
                    : `>${o.allowed} lines (allowlist ceiling)`;
            // eslint-disable-next-line no-console
            console.error(
                `BUDGET-VIOLATION  ${o.rel}:${o.lines}  (${ceiling})\n  ` +
                    `Either split the file (preferred) or add an entry to ` +
                    `KNOWN_OVER_BUDGET in tests/arch/file-size-budget.test.ts ` +
                    `with phase + reason.`,
            );
        }
        assert.fail(
            `${offenders.length} file-size-budget offender(s) detected. ` +
                `See console.error above for each offender + the recommended fix.`,
        );
    }
});

test('file-size-budget: no STALE allowlist entries', () => {
    const measured = measureAll();
    const byRel = new Map(measured.map((m) => [m.rel, m.lines] as const));
    const stale: { entry: OverBudgetEntry; reason: string }[] = [];

    for (const entry of KNOWN_OVER_BUDGET) {
        const lines = byRel.get(entry.rel);
        if (lines === undefined) {
            stale.push({ entry, reason: 'file no longer exists' });
            continue;
        }
        if (lines <= MAX_LINES) {
            stale.push({
                entry,
                reason: `file is now ${lines} lines (<= ${MAX_LINES}); remove from allowlist`,
            });
        }
    }

    if (stale.length > 0) {
        for (const s of stale) {
            // eslint-disable-next-line no-console
            console.error(
                `STALE  ${s.entry.rel}  ${s.reason}\n  ` +
                    `phase: ${s.entry.phase}; reason was: ${s.entry.reason}`,
            );
        }
        assert.fail(
            `${stale.length} stale KNOWN_OVER_BUDGET entry/entries detected. ` +
                `Remove them from tests/arch/file-size-budget.test.ts.`,
        );
    }
});
