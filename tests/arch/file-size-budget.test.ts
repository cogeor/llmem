// tests/arch/file-size-budget.test.ts
//
// Loop 06 (quality-refactor) — whole-tree file-size budget.
//
// Previously this gate only scanned `src/webview/ui/**` against a flat
// 400-line cap (loop 15). It now scans the ENTIRE source tree
// (`src/**/*.ts(x)`) with PER-LAYER budgets. Every file must either stay
// within its layer budget OR sit on the explicit `KNOWN_OVER_BUDGET`
// allowlist with a `phase` and a `reason`.
//
// Per-layer budgets (see `budgetFor`):
//   - src/core/, src/contracts/, src/docs/                        => 200
//   - src/parser/                                                 => 350
//   - src/graph/, src/domain/                                     => 350
//   - src/application/                                            => 350
//   - src/mcp/, src/extension/, src/cli/, src/runtime/             => 250
//   - src/webview/ui/                                             => 350
//   - everything else under src/ (default, incl. webview non-ui)  => 400
//
// Rationale for the tiers:
//   - "platform handler" layers (mcp/extension/cli/runtime) are wiring
//     and should stay small (250) so handlers don't accrete logic.
//   - "pure" layers (core/contracts/docs) are types + tiny helpers (200).
//   - parser/graph/application/webview-ui hold the heavier algorithms (350).
//   - the catch-all default stays at the historical 400 so that legacy
//     webview-shell / script files don't explode the allowlist this loop.
//
// The budget is a forcing function for module decomposition — when a
// single file gets that large the per-responsibility split is almost
// always cheaper than the next behavior change. Mirrors the same red-line
// shape as `tests/arch/console-discipline.test.ts` (allowlist + stale-row
// detection).
//
// Implementation notes:
//   - Walk uses the same skip-dir / skip-file rules as
//     `console-discipline.test.ts` so behavior is consistent across
//     architecture tests.
//   - `libs/` directories hold vendored third-party shims (vis-network,
//     etc.) that we do not own — skipped.
//   - Both the report and the assertion use the same line-count
//     algorithm (`split('\n').length`) so off-by-one drift between the
//     two cannot cause flakes. (Note: this counts one MORE than `wc -l`
//     for files with a trailing newline.)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** Catch-all ceiling for files not covered by a tighter tier. */
const DEFAULT_BUDGET = 400;

/**
 * Per-layer budget. `rel` is a forward-slash, repo-relative path
 * (e.g. `src/application/scan.ts`). Most specific prefix wins; the
 * webview/ui tier is checked before the generic webview catch-all.
 */
function budgetFor(rel: string): number {
    // Pure layers: types + tiny helpers.
    if (
        rel.startsWith('src/core/') ||
        rel.startsWith('src/contracts/') ||
        rel.startsWith('src/docs/')
    ) {
        return 200;
    }
    // Platform-handler / wiring layers — keep handlers thin.
    if (
        rel.startsWith('src/mcp/') ||
        rel.startsWith('src/extension/') ||
        rel.startsWith('src/http-server/') ||
        rel.startsWith('src/cli/') ||
        rel.startsWith('src/runtime/')
    ) {
        return 250;
    }
    // Heavier-algorithm layers.
    if (rel.startsWith('src/parser/')) return 350;
    if (rel.startsWith('src/graph/') || rel.startsWith('src/domain/')) return 350;
    if (rel.startsWith('src/application/')) return 350;
    if (rel.startsWith('src/webview/ui/')) return 350;
    // Everything else under src/ (webview shell, scripts, info, etc.).
    return DEFAULT_BUDGET;
}

interface OverBudgetEntry {
    /** Forward-slash, repo-relative path. */
    readonly rel: string;
    /** Allowed ceiling — current observed count + small slack (<= +10). */
    readonly maxLines: number;
    /** Phase that owns the eventual fix (matches LOOPS.yaml ids). */
    readonly phase: string;
    /** One-line justification. */
    readonly reason: string;
}

/**
 * Allowlist: files that currently exceed their layer budget, each pinned
 * to a `maxLines` ceiling (observed count + small slack) so they cannot
 * grow further while they wait for the named decomposition `phase`.
 *
 * Derived EMPIRICALLY: run the gate with an empty allowlist, then add
 * every offender the test reports. Re-measure before changing a ceiling.
 */
const KNOWN_OVER_BUDGET: readonly OverBudgetEntry[] = [
    // Loop 22 (final file-size burndown) split the last five over-budget
    // webview-ui files under the 350-line budget, so the allowlist is now
    // EMPTY. Future transitional rows MUST carry a `phase` (the loop id that
    // retires the row) and a one-line `reason`; the stale-row test below
    // fires on any unobserved entry.
    {
        rel: 'src/application/analysis/interface-width.ts',
        maxLines: 560,
        phase: 'interface-width Loop 07',
        reason:
            'Loop 04 landed the interface-width pure core (W1/W2/W3/W4) + ' +
            'barrel annotation + dynamic-percentile calibration in one analyzer ' +
            'module (552 lines, header-heavy). Decomposed once the Loop-06 schema ' +
            'bump splits the pure-metric vs calibration concerns.',
    },
    {
        rel: 'src/application/review/registry.ts',
        maxLines: 800,
        phase: 'permanent',
        reason:
            'Frozen REVIEW_REGISTRY data table (34 general + 31 frontend ' +
            'checklist items) — pure `Object.freeze`d data, NO logic. The ' +
            'per-item prose (title / recallQuery / promptInstruction) is ' +
            'inherently line-heavy and is the single source of truth for the ' +
            'review checklist. Splitting it across files would fragment that ' +
            'SSOT for no behavioral gain; the budget exists to force ' +
            'decomposition of LOGIC, which this file has none of.',
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
    readonly budget: number;
}

function measureAll(): FileMeasurement[] {
    const files = walkSrc(SRC_ROOT);
    return files.map((f) => {
        const rel = toRepoRel(f);
        return { rel, lines: countLines(f), budget: budgetFor(rel) };
    });
}

function findAllowlistEntry(rel: string): OverBudgetEntry | undefined {
    return KNOWN_OVER_BUDGET.find((e) => e.rel === rel);
}

test('file-size-budget: every src/**/*.ts(x) file is within its layer budget (or on the allowlist)', () => {
    const measured = measureAll();
    const offenders: { rel: string; lines: number; budget: number; allowed?: number }[] = [];

    for (const m of measured) {
        if (m.lines <= m.budget) continue;
        const allow = findAllowlistEntry(m.rel);
        if (allow === undefined) {
            offenders.push({ rel: m.rel, lines: m.lines, budget: m.budget });
            continue;
        }
        if (m.lines > allow.maxLines) {
            offenders.push({
                rel: m.rel,
                lines: m.lines,
                budget: m.budget,
                allowed: allow.maxLines,
            });
        }
    }

    if (offenders.length > 0) {
        for (const o of offenders) {
            const ceiling =
                o.allowed === undefined
                    ? `>${o.budget} lines (layer budget)`
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
    const byRel = new Map(measured.map((m) => [m.rel, m] as const));
    const stale: { entry: OverBudgetEntry; reason: string }[] = [];

    for (const entry of KNOWN_OVER_BUDGET) {
        const m = byRel.get(entry.rel);
        if (m === undefined) {
            stale.push({ entry, reason: 'file no longer exists' });
            continue;
        }
        if (m.lines <= m.budget) {
            stale.push({
                entry,
                reason: `file is now ${m.lines} lines (<= ${m.budget} layer budget); remove from allowlist`,
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
