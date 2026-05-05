// tests/arch/workspace-context-singleton.test.ts
//
// Loop 04 — pin the `WorkspaceIO.create` audit. After this loop, only the
// factory itself (`createWorkspaceContext`) and the `workspace-io.ts` thin
// alias should call `WorkspaceIO.create(...)` from production source. Every
// host (panel, server, CLI, MCP) builds its workspace context via
// `createWorkspaceContext`, which is the single direct caller of
// `WorkspaceIO.create`.
//
// The test walks `src/**/*.ts`, regex-matches `WorkspaceIO.create(`, and
// asserts the set of files containing such a call equals exactly the
// allowlist below. Mirrors Part B's stale-row check from
// `workspace-paths.test.ts` so a future loop that drops a callsite must
// also drop the allowlist row.
//
// Tests under `tests/` (and any `*.test.ts`) are out of scope — focused
// tests are allowed to construct a `WorkspaceIO` directly because they
// are testing the io surface itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// Production files allowed to call `WorkspaceIO.create(...)`. After
// Loop 04 only the factory itself remains as a direct caller; every
// other host routes through `createWorkspaceContext`. The
// `workspace-io.ts` self-reference (a `createWorkspaceIO` thin alias)
// is kept as a co-located factory.
//
// Justifications per row:
//   - workspace-context.ts: the factory itself — the single production
//     direct caller of `WorkspaceIO.create`. Hosts call
//     `createWorkspaceContext`, not this constructor.
//   - workspace-io.ts: thin alias `createWorkspaceIO(root) ⇒
//     WorkspaceIO.create(root)`. Pre-loop-04 ergonomics; kept because
//     focused tests still import it directly.
const ALLOWLIST: ReadonlySet<string> = new Set([
    'src/application/workspace-context.ts',
    'src/workspace/workspace-io.ts',
]);

const CREATE_RE = /\bWorkspaceIO\.create\s*\(/g;

function shouldSkipDir(name: string): boolean {
    return (
        name === 'node_modules' ||
        name === 'dist' ||
        name === '.artifacts' ||
        name === '.arch'
    );
}

function shouldSkipFile(name: string): boolean {
    if (name.endsWith('.d.ts')) return true;
    if (name.endsWith('.d.ts.map')) return true;
    if (name.endsWith('.js')) return true;
    if (name.endsWith('.js.map')) return true;
    if (name.endsWith('.test.ts')) return true;
    return !name.endsWith('.ts');
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

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

/**
 * Strip line-comments (`// ...` to EOL) and block-comments (`/* ... *\/`)
 * before regex-scanning so a textual reference inside a docstring
 * (e.g. "previously called WorkspaceIO.create(...)") does NOT count as
 * a real call site.
 *
 * String-literal stripping is intentionally NOT done — the audit's
 * regex requires `WorkspaceIO.create(` (with a paren), so a string
 * literal `'WorkspaceIO.create'` would not match. Block/line comments
 * are the realistic source of false positives.
 */
function stripComments(source: string): string {
    let stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
    stripped = stripped.replace(/\/\/.*$/gm, '');
    return stripped;
}

function scanCallers(): Set<string> {
    const observed = new Set<string>();
    for (const abs of walkSrc(SRC_ROOT)) {
        const source = stripComments(fs.readFileSync(abs, 'utf-8'));
        CREATE_RE.lastIndex = 0;
        if (CREATE_RE.test(source)) {
            observed.add(toRepoRel(abs));
        }
    }
    return observed;
}

test('workspace-context-singleton: every WorkspaceIO.create caller is in the allowlist', () => {
    const observed = scanCallers();
    const offenders: string[] = [];
    for (const file of observed) {
        if (!ALLOWLIST.has(file)) offenders.push(file);
    }

    if (offenders.length > 0) {
        for (const f of offenders.sort()) {
            // eslint-disable-next-line no-console
            console.error(`OFFENDER: ${f}`);
        }
        assert.fail(
            `${offenders.length} unauthorized WorkspaceIO.create call site(s) found. ` +
            `Loop 04 contract: every host routes through createWorkspaceContext. ` +
            `If this is a deliberate addition, justify it and add the path to ` +
            `tests/arch/workspace-context-singleton.test.ts ALLOWLIST.`,
        );
    }
});

test('workspace-context-singleton: no STALE allowlist rows (every entry must still be observed)', () => {
    const observed = scanCallers();
    const stale: string[] = [];
    for (const f of ALLOWLIST) {
        if (!observed.has(f)) stale.push(f);
    }

    if (stale.length > 0) {
        for (const f of stale) {
            // eslint-disable-next-line no-console
            console.error(`STALE: ${f}`);
        }
        assert.fail(
            `${stale.length} stale allowlist entry/entries detected. ` +
            `Either restore the call site or remove the row from the ALLOWLIST.`,
        );
    }
});
