// tests/arch/no-layout-scratch-any.test.ts
//
// Loop 16 — architecture gate against the layout-scratch `as any` pattern.
//
// Background: the `HierarchicalLayout` engine historically smuggled
// per-pass intermediate state through `(node as any)._x`,
// `(node as any)._relX`, etc. — direct mutations on the input
// `VisNode[]` references that bypass the type system. Loop 16 lifts
// those scratch fields into a typed `Map<string, MeasuredNode>` owned
// by the layout pass.
//
// This test is a forward-looking gate: any future loop that reaches for
// the same `(node as any)._<scratch>` pattern under `src/webview/ui/**`
// will fail this test.
//
// Detection is regex-on-source by design — the forbidden pattern is a
// specific call shape, not a TypeScript construct. The regex is
// deliberately narrow: it matches `(<ident> as any)._<scratch>` for
// the six scratch field names (`_x`, `_y`, `_relX`, `_relY`, `_localX`,
// `_localY`). It does NOT ban `as any` tree-wide — five pre-existing
// call sites under `src/webview/ui/` (browser-host bridges, `window`
// access) are out of scope for this loop and pass through.
//
// Implementation notes:
//   - Walk uses the same skip-dir / skip-file rules as
//     `console-discipline.test.ts` and `file-size-budget.test.ts`.
//   - `KNOWN_VIOLATIONS` lands empty (loop 16 ships the migration
//     green); reserved for future transitional rows, same shape as
//     `console-discipline.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_WEBVIEW_UI = path.join(REPO_ROOT, 'src', 'webview', 'ui');

interface ScratchAnySite {
    readonly rel: string;
    readonly line: number;
    readonly source: string;
}

interface KnownViolation {
    readonly rel: string;
    readonly line: number;
    /**
     * Loop 17: every future row carries an explicit expiration phase
     * (`'permanent'` or a target loop id like `'18'`). The list is
     * empty today, so no row exercises the field — the type guards
     * future entries against being added without an expiration
     * handshake.
     */
    readonly phase: string;
    readonly reason: string;
}

/**
 * Loop 16 lands with a clean migration. Reserved for future loops that
 * need a transitional path-and-line entry while a refactor is in
 * flight.
 *
 * Loop 17: every future entry MUST carry `phase` (`'permanent'` or a
 * target loop id) plus a `reason`. The list lands empty.
 */
const KNOWN_VIOLATIONS: readonly KnownViolation[] = [];

/**
 * Forbidden pattern: `(<ident> as any)._<scratch>` where `<scratch>`
 * is one of the six known layout-scratch fields. Examples:
 *
 *   (node as any)._x
 *   (node as any)._y
 *   (node as any)._relX
 *   (node as any)._relY
 *   (node as any)._localX
 *   (node as any)._localY
 *
 * The pattern intentionally requires the `._<scratch>` access to be
 * fused to the `as any` cast — `(window as any).WATCHED_FILES` and
 * `(this.dataProvider as any).designDocCache?.fetch(...)` (browser
 * bridge / cache, both out of scope) do not match.
 */
const FORBIDDEN_RE =
    /\(\s*\w+\s+as\s+any\s*\)\s*\._(x|y|relX|relY|localX|localY)\b/;

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(name: string): boolean {
    return (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.artifacts' ||
        name === '.arch' ||
        name === 'libs'
    );
}

function shouldSkipFile(name: string): boolean {
    if (name.endsWith('.d.ts')) return true;
    if (name.endsWith('.d.ts.map')) return true;
    if (name.endsWith('.js')) return true;
    if (name.endsWith('.js.map')) return true;
    if (name.endsWith('.test.ts')) return true;
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

function collectScratchAnySites(): ScratchAnySite[] {
    const sites: ScratchAnySite[] = [];
    for (const file of walkSrc(SRC_WEBVIEW_UI)) {
        const lines = fs.readFileSync(file, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (FORBIDDEN_RE.test(line)) {
                sites.push({
                    rel: toRepoRel(file),
                    line: i + 1,
                    source: line.trim(),
                });
            }
        }
    }
    return sites;
}

function siteKey(site: { rel: string; line: number }): string {
    return `${site.rel}:${site.line}`;
}

test('no-layout-scratch-any: no `(node as any)._<scratch>` mutations under src/webview/ui/**', () => {
    const observed = collectScratchAnySites();
    const known = new Set(KNOWN_VIOLATIONS.map((v) => siteKey(v)));
    const undocumented = observed.filter((site) => !known.has(siteKey(site)));

    if (undocumented.length > 0) {
        for (const site of undocumented) {
            // eslint-disable-next-line no-console
            console.error(
                `LAYOUT-SCRATCH-ANY  ${siteKey(site)}\n  ` +
                    `${site.source}\n  ` +
                    `Use the typed \`MeasuredNode\` map in ` +
                    `\`graph/layout-types.ts\` instead of mutating the input ` +
                    `node.`,
            );
        }
        assert.fail(
            `${undocumented.length} layout-scratch \`as any\` violation(s) ` +
                `detected under src/webview/ui/**. See console.error above ` +
                `for each offender + the recommended fix.`,
        );
    }
});

test('no-layout-scratch-any: no STALE KNOWN_VIOLATIONS entries', () => {
    const observed = collectScratchAnySites();
    const observedKeys = new Set(observed.map((site) => siteKey(site)));
    const stale: KnownViolation[] = [];

    for (const v of KNOWN_VIOLATIONS) {
        if (!observedKeys.has(siteKey(v))) stale.push(v);
    }

    if (stale.length > 0) {
        for (const v of stale) {
            // eslint-disable-next-line no-console
            console.error(
                `STALE  ${siteKey(v)} no longer present; ` +
                    `remove from KNOWN_VIOLATIONS in ` +
                    `tests/arch/no-layout-scratch-any.test.ts.\n  ` +
                    `reason was: ${v.reason}`,
            );
        }
        assert.fail(
            `${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`,
        );
    }
});
