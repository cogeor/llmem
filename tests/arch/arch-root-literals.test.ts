// tests/arch/arch-root-literals.test.ts
//
// Loop VS-B5 — enumerated OWNER allowlist of src/ files permitted to
// spell the legacy docs storage-root literal `.arch`.
//
// Purpose
// -------
// This is the SIBLING guard to `tests/arch/artifact-root-allowlist.test.ts`
// (which guards `.artifacts`). Before VS-B1 the AI-authored design-doc
// tree lived in `.arch/`; it has since been centralized to `.llmem/docs`
// (see `DOCS_DIR` in `src/docs/arch-store.ts`). Runtime code should now
// consume `ctx.archRootRel` / `DOCS_DIR` / named helpers rather than
// spelling the `.arch` directory name by hand. A NEW hardcoded `.arch`
// storage-root literal in a non-owner src/ file is almost always drift.
//
// This test turns that into an enforced invariant: every occurrence of
// the `.arch` storage-root literal in `src/` (a quoted string whose
// value is `.arch` or starts with `.arch/`) must either belong to a
// checked-in `ALLOWLIST` entry that justifies it, or be removed in
// favour of `ctx.archRootRel` / `DOCS_DIR`.
//
// Scoping decision (deviation from the sibling — read this)
// --------------------------------------------------------
// The `.artifacts` sibling scans the whole repo (minus SKIP_DIRS) and
// allowlists tests + docs by the dozen. For `.arch` that would be pure
// churn: tests legitimately spell `.arch` in migration fixtures
// (`tests/unit/application/migrate-docs.test.ts`) and the docs/memo
// trees are prose. To match this loop's intent — "constrain FUTURE src/
// edits" — and keep maintenance sane, THIS GUARD IS SCOPED TO `src/`
// ONLY. We deliberately do NOT scan `tests/`, `docs/`, `memo/`, `*.md`,
// or the repo-root dotfiles: after VS-B4 the root ignore dotfiles
// (`.gitignore`, `.eslintrc.json`, `.vscodeignore`) ignore the blanket
// `.llmem/` tree, not `.arch`, so there is nothing there to own.
//
// Why a quoted-literal regex (not the bare boundary regex)
// --------------------------------------------------------
// `src/` is full of identifiers and prose that contain the characters
// `.arch`: `ctx.archRootRel`, `archWatcher`, `getArchRoot`,
// `scanArchFolders`, `ARCH_*`, plus JSDoc prose describing the legacy
// `.arch/` layout. None of those are storage-root LITERALS. The
// `(?![A-Za-z0-9_$])` negative lookahead alone rejects the identifiers
// (`.archRoot`, `.archive`, `.architecture`) but still matches the many
// `.arch/` mentions in comments/prose. So we anchor on the storage-root
// FORM the loop calls out: a quoted string literal whose value is
// exactly `.arch` or begins with `.arch/`. This flags genuine
// hardcoded directory names in code (`const LEGACY_DIR = '.arch'`,
// `['.git', '.llmem', '.arch', '.artifacts']`) while ignoring prose.
// Sanity-check assertions at the bottom of this file pin that behaviour.
//
// How to fix when it fails
// ------------------------
// Two failure modes:
//
//   1. ARCH-LITERAL-OUTSIDE-ALLOWLIST <file>:<line>
//        The scan found a quoted `.arch` storage-root literal in a src/
//        file that is NOT in `ALLOWLIST`. Either:
//          (a) refactor the callsite to consume `ctx.archRootRel` /
//              `DOCS_DIR` (the preferred fix), OR
//          (b) add the file to `ALLOWLIST` with a one-line `reason`
//              explaining why the literal legitimately stays (it is
//              almost always one of: a legacy root-detection marker, the
//              migration source dir, or a scan-skip set).
//
//   2. STALE  <file>  remove from ALLOWLIST (reason was: ...)
//        An allowlisted file no longer spells the literal. Drop the row
//        in the same commit that removed the mention, so the allowlist
//        tracks reality on every commit.
//
// Implementation notes
// --------------------
//   - Pure literal-string scan. No TypeScript Compiler API needed.
//   - Walk is deterministic: `fs.readdirSync` results are sorted before
//     recursion, and the final match list is sorted by `(rel, line)`.
//   - Scan root is `src/` only (see scoping note above).
//   - No external test deps beyond what other arch tests already use:
//     `node:test`, `node:assert/strict`, `node:fs`, `node:path`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src');

// ---------------------------------------------------------------------------
// Walk + scan
// ---------------------------------------------------------------------------

interface Match {
    readonly rel: string;       // forward-slash repo-relative path
    readonly line: number;      // 1-indexed
    readonly content: string;   // trimmed line content
}

interface AllowlistEntry {
    readonly file: string;      // forward-slash repo-relative path
    /**
     * Mirrors the sibling test's expiration handshake. `'permanent'` for
     * rows kept by design (legacy root-detection markers, the migration
     * source dir, scan-skip sets). A target loop id for rows expected to
     * retire in a specific future loop. Today every row is `'permanent'`.
     */
    readonly phase: string;
    readonly reason: string;    // one-line justification
}

const SKIP_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    'dist',
    '.artifacts',
    '.llmem',
    '.delegate',
    '.arch',
    'plans',
    'out',
    'build',
    'coverage',
]);

const SKIP_FILE_NAMES: ReadonlySet<string> = new Set([
    'package-lock.json',
]);

const SKIP_FILE_SUFFIXES: readonly string[] = [
    '.js',
    '.js.map',
    '.d.ts',
    '.d.ts.map',
    '.lock',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.zip',
    '.vsix',
    '.gz',
    '.tar',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.pdf',
];

// `.md` is intentionally NOT included: this guard is scoped to src/ code
// (prose markdown legitimately spells `.arch`).
const INCLUDE_FILE_SUFFIXES: readonly string[] = [
    '.ts',
    '.tsx',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.html',
    '.css',
];

// Storage-root literal: a quoted string whose value is exactly `.arch`
// or begins with `.arch/`. The quote-anchoring is what restricts the
// match to genuine directory-name literals in code and rejects the many
// `.arch/` mentions in prose/JSDoc. The `(?:\/[^'"]*)?` tail also
// guarantees the character after `.arch` is the closing quote or a `/`,
// so `.archRoot` / `.archive` / `.architecture` can never match even if
// they were ever quoted. Captures the opening quote in group 1 and
// requires the same quote to close (`\1`).
const ARCH_RE = /(['"])\.arch(?:\/[^'"]*)?\1/g;

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(name: string): boolean {
    return SKIP_DIRS.has(name);
}

function shouldIncludeFile(name: string): boolean {
    if (SKIP_FILE_NAMES.has(name)) return false;
    for (const sfx of SKIP_FILE_SUFFIXES) {
        if (name.endsWith(sfx)) return false;
    }
    for (const sfx of INCLUDE_FILE_SUFFIXES) {
        if (name.endsWith(sfx)) return true;
    }
    return false;
}

function walkSrc(root: string, out: string[] = []): string[] {
    // Sort entries by name for deterministic recursion order.
    const entries = fs.readdirSync(root, { withFileTypes: true })
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            walkSrc(full, out);
        } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function scanArchLiteral(): Match[] {
    const matches: Match[] = [];
    for (const abs of walkSrc(SCAN_ROOT)) {
        let source: string;
        try {
            source = fs.readFileSync(abs, 'utf-8');
        } catch {
            continue;
        }
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            ARCH_RE.lastIndex = 0;
            if (ARCH_RE.test(line)) {
                matches.push({
                    rel: toRepoRel(abs),
                    line: i + 1,
                    content: line.trim(),
                });
            }
        }
    }
    matches.sort((a, b) => {
        if (a.rel !== b.rel) return a.rel < b.rel ? -1 : 1;
        return a.line - b.line;
    });
    return matches;
}

// ---------------------------------------------------------------------------
// ALLOWLIST — every src/ file currently allowed to contain the `.arch`
// storage-root literal. After centralization to `.llmem/docs` these are
// the ONLY legitimate spellings that remain: legacy root-detection
// markers, the one-time migration source dir, and directory-skip sets.
// Anything else should consume `ctx.archRootRel` / `DOCS_DIR`.
//
// Categories:
//   A. Legacy workspace root-detection markers — walk-up marker lists.
//   B. Docs-migration source dir              — names the legacy `.arch`.
//   C. Scan-skip / IGNORED_FOLDERS sets       — directory-skip sets.
// ---------------------------------------------------------------------------

const ALLOWLIST: readonly AllowlistEntry[] = [
    // -----------------------------------------------------------------------
    // A. Legacy workspace root-detection markers
    //    Walk-up detectors keep `.arch` / `.artifacts` alongside `.git`,
    //    `package.json`, `.llmem` as back-compat markers so an existing
    //    project documented under the old layout is still recognised.
    // -----------------------------------------------------------------------
    { file: 'src/cli/commands/generate.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker (`[\'.git\', \'package.json\', \'.llmem\', \'.arch\', \'.artifacts\']`); `.arch` is a legacy back-compat root marker.' },
    { file: 'src/cli/commands/stats.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker; `.arch` kept as a legacy back-compat root marker.' },
    { file: 'src/mcp/main.ts',
      phase: 'permanent',
      reason: 'detectWorkspaceRoot() marker list; `.arch` kept as a legacy back-compat root marker.' },
    { file: 'src/workspace/detect.ts',
      phase: 'permanent',
      reason: 'detectWorkspace() marker list + JSDoc that enumerates the markers; `.arch` is a legacy back-compat root marker (moved from the original CLI workspace helper in G2).' },

    // -----------------------------------------------------------------------
    // B. Docs-migration source dir
    // -----------------------------------------------------------------------
    { file: 'src/application/migrate-docs.ts',
      phase: 'permanent',
      reason: 'Owns `const LEGACY_DIR = \'.arch\'` — the one-time idempotent migration reads the legacy `.arch/` docs tree before moving it to `.llmem/docs`.' },

    // -----------------------------------------------------------------------
    // C. Scan-skip / IGNORED_FOLDERS sets
    // -----------------------------------------------------------------------
    { file: 'src/parser/config.ts',
      phase: 'permanent',
      reason: 'IGNORED_FOLDERS set lists `.arch` next to `.artifacts`/`.llmem`/`node_modules` so the legacy docs dir is excluded from parser scans.' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('arch-root-literals: every observed `.arch` storage-root literal is in ALLOWLIST', () => {
    const matches = scanArchLiteral();
    const allowed = new Set(ALLOWLIST.map((e) => e.file));

    const offenders = matches.filter((m) => !allowed.has(m.rel));
    if (offenders.length > 0) {
        for (const o of offenders) {
            console.error(
                `ARCH-LITERAL-OUTSIDE-ALLOWLIST  ${o.rel}:${o.line}\n  ` +
                    `${o.content}\n  ` +
                    `Add this file to ALLOWLIST in tests/arch/arch-root-literals.test.ts ` +
                    `with a one-line reason, or refactor it to consume \`ctx.archRootRel\` / ` +
                    `\`DOCS_DIR\` instead of the literal.`,
            );
        }
        assert.fail(
            `${offenders.length} \`.arch\` storage-root literal occurrence(s) found ` +
                `outside the allowlist. See console.error above for each offender and ` +
                `the recommended fix.`,
        );
    }
});

test('arch-root-literals: every ALLOWLIST entry is still observed (no STALE rows)', () => {
    const matches = scanArchLiteral();
    const observedFiles = new Set(matches.map((m) => m.rel));

    const stale: AllowlistEntry[] = [];
    for (const e of ALLOWLIST) {
        if (!observedFiles.has(e.file)) stale.push(e);
    }

    if (stale.length > 0) {
        for (const e of stale) {
            console.error(
                `STALE  ${e.file}  remove from ALLOWLIST in ` +
                    `tests/arch/arch-root-literals.test.ts (reason was: ${e.reason})`,
            );
        }
        assert.fail(`${stale.length} stale ALLOWLIST entry/entries detected.`);
    }
});

test('arch-root-literals: boundary regex matches storage-root literals only', () => {
    // Accepts genuine quoted `.arch` directory-name literals.
    for (const s of ["'.arch'", '".arch"', "'.arch/src/x'", "const x = '.arch';"]) {
        ARCH_RE.lastIndex = 0;
        assert.ok(ARCH_RE.test(s), `expected MATCH for: ${s}`);
    }
    // Rejects identifiers / prose that merely contain the chars `.arch`.
    for (const s of ['ctx.archRootRel', 'archWatcher', 'getArchRoot',
                     '.archRoot', '.archive', '.architecture',
                     'scanArchFolders', 'ARCH_DIR', 'walk .arch/ for docs']) {
        ARCH_RE.lastIndex = 0;
        assert.ok(!ARCH_RE.test(s), `expected NO match for: ${s}`);
    }
});
