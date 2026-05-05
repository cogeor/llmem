// tests/arch/artifact-root-allowlist.test.ts
//
// Loop 10 — enumerated allowlist of files permitted to mention the
// literal directory token `.artifacts`.
//
// Purpose
// -------
// Constraint #5 in
// `memo/codebase-quality-implementation-plan-2026-05-05.md` says that a
// `git grep` for the literal `.artifacts` in workflow code should only
// turn up defaults/fallbacks/docs — never a hardcoded production
// callsite that ought to consume `ctx.artifactRoot`. Loop 09 cleaned
// the literal out of `src/application/**` and `src/mcp/**`. This test
// turns the soft "grep should only find ..." wording into a real,
// enforced invariant: every occurrence of the literal `.artifacts` in
// the repo (outside skipped directories and binary outputs) must
// either belong to a checked-in `ALLOWLIST` entry that justifies it,
// or be removed.
//
// How to fix when it fails
// ------------------------
// Two failure modes:
//
//   1. ARTIFACTS-LITERAL-OUTSIDE-ALLOWLIST <file>:<line>
//        The scan found a `.artifacts` mention in a file that is NOT
//        in `ALLOWLIST`. Either:
//          (a) refactor the callsite to consume `ctx.artifactRoot`
//              (the preferred fix — extends Loop 09's scope), OR
//          (b) add the file to `ALLOWLIST` with a one-line `reason`
//              explaining why the literal legitimately stays.
//
//   2. STALE  <file>  remove from ALLOWLIST (reason was: ...)
//        An allowlisted file no longer mentions the literal. Drop the
//        row in the same commit that removed the mention. This is a
//        load-bearing check: it forces the allowlist to track reality
//        on every commit, so reviewers can see when a category-D
//        callsite has been retired (Loop 17 burn-down).
//
// Implementation notes
// --------------------
//   - Pure literal-string scan. No TypeScript Compiler API needed; the
//     boundary regex `(^|[^A-Za-z0-9_$])\.artifacts\b` rejects
//     property accesses like `child.artifacts` (in
//     `src/artifact/tree.ts`) and prefix-extended identifiers like
//     `.artifactsRoot`.
//   - Walk is deterministic: `fs.readdirSync` results are sorted
//     before recursion, and the final match list is sorted by
//     `(rel, line)` before any console output. CI must produce the
//     same line numbers on Windows, macOS, and Linux.
//   - Skip directories: `node_modules`, `.git`, `dist`, `.artifacts`,
//     `.delegate`, `.arch`, `out`, `build`, `coverage`.
//   - Skip files: `package-lock.json`, `*.js`, `*.js.map`, `*.d.ts`,
//     `*.d.ts.map`, `*.lock`, common binary extensions.
//   - Include rule (otherwise skip): `.ts`, `.tsx`, `.json`, `.md`,
//     `.yaml`, `.yml`, `.toml`, `.html`, `.css`, plus a small set of
//     named dot-files at the repo root (`.gitignore`, `.eslintrc.json`,
//     `.vscodeignore`, `.env.example`).
//   - No external test deps beyond what other arch tests already use:
//     `node:test`, `node:assert/strict`, `node:fs`, `node:path`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

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
     * Loop 17: every row carries an explicit expiration handshake.
     * `'permanent'` for rows kept by design (categories A–C, plus the
     * source-of-truth defaults in D and the test self-references in
     * G/H/I). A target loop id (e.g. `'18'`) for rows expected to
     * retire in a specific future loop. Today every existing row is
     * `'permanent'` — see the per-category notes in the ALLOWLIST
     * literal below.
     */
    readonly phase: string;
    readonly reason: string;    // one-line justification
}

const SKIP_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    'dist',
    '.artifacts',
    '.delegate',
    '.arch',
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

const INCLUDE_FILE_SUFFIXES: readonly string[] = [
    '.ts',
    '.tsx',
    '.json',
    '.md',
    '.yaml',
    '.yml',
    '.toml',
    '.html',
    '.css',
];

// Named dot-files at the repo root that we explicitly include (they
// have no extension so the include-by-extension rule doesn't pick them
// up).
const ROOT_INCLUDED_DOTFILES: ReadonlySet<string> = new Set([
    '.gitignore',
    '.eslintrc.json',
    '.vscodeignore',
    '.env.example',
]);

// Boundary class on the LEFT rejects identifier-character predecessors
// (so `child.artifacts` in src/artifact/tree.ts does not match), and
// the trailing `\b` rejects identifier-character successors (so a
// hypothetical `.artifactsRoot` would not match either).
const ARTIFACTS_RE = /(^|[^A-Za-z0-9_$])\.artifacts\b/g;

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(name: string): boolean {
    return SKIP_DIRS.has(name);
}

function shouldIncludeFile(absPath: string, name: string): boolean {
    if (SKIP_FILE_NAMES.has(name)) return false;
    for (const sfx of SKIP_FILE_SUFFIXES) {
        if (name.endsWith(sfx)) return false;
    }
    // Root-level explicitly-included dot-files (no extension).
    if (path.dirname(absPath) === REPO_ROOT && ROOT_INCLUDED_DOTFILES.has(name)) {
        return true;
    }
    for (const sfx of INCLUDE_FILE_SUFFIXES) {
        if (name.endsWith(sfx)) return true;
    }
    return false;
}

function walkRepo(root: string, out: string[] = []): string[] {
    // Sort entries by name for deterministic recursion order.
    const entries = fs.readdirSync(root, { withFileTypes: true })
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            walkRepo(full, out);
        } else if (entry.isFile() && shouldIncludeFile(full, entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function scanArtifactsLiteral(): Match[] {
    const matches: Match[] = [];
    for (const abs of walkRepo(REPO_ROOT)) {
        let source: string;
        try {
            source = fs.readFileSync(abs, 'utf-8');
        } catch {
            continue;
        }
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            ARTIFACTS_RE.lastIndex = 0;
            if (ARTIFACTS_RE.test(line)) {
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
// ALLOWLIST — every file currently allowed to contain the literal
// `.artifacts`. Ordered by category, alphabetical inside each
// category. Each `reason` answers: why is this literal legitimate
// here, and what (if anything) would retire it?
//
// Categories:
//   A. Repo-root config files               — canonical declarations.
//   B. Top-level documentation              — human-facing docs.
//   C. Memo / design docs                   — historical/design records.
//   D. Config defaults & workspace markers  — production source defaults.
//   E. IGNORED_FOLDERS / scan-skip lists    — directory-skip sets.
//   F. JSDoc / banner comments in src/      — documentation comments.
//   G. Architecture tests' skip-dir lists   — other arch tests.
//   H. Integration & contract tests         — fixture artifact dirs.
//   I. Unit tests                           — fixture artifact dirs.
// ---------------------------------------------------------------------------

const ALLOWLIST: readonly AllowlistEntry[] = [
    // -----------------------------------------------------------------------
    // A. Repo-root config files
    // -----------------------------------------------------------------------
    { file: '.env.example',
      phase: 'permanent',
      reason: 'Example env file documents `ARTIFACT_ROOT=.artifacts` as the default.' },
    { file: '.eslintrc.json',
      phase: 'permanent',
      reason: 'ESLint ignore pattern for the generated artifact directory.' },
    { file: '.gitignore',
      phase: 'permanent',
      reason: 'git-ignore for the generated artifact directory.' },
    { file: '.vscodeignore',
      phase: 'permanent',
      reason: 'VSIX packaging excludes the generated artifact directory.' },
    { file: 'package.json',
      phase: 'permanent',
      reason: 'Extension contributes `llmem.artifactRoot` setting; canonical default value is `.artifacts`.' },

    // -----------------------------------------------------------------------
    // B. Top-level documentation
    // -----------------------------------------------------------------------
    { file: 'CLAUDE.md',
      phase: 'permanent',
      reason: 'Codebase guide for Claude Code; documents artifact root layout.' },
    { file: 'CONTRIBUTING.md',
      phase: 'permanent',
      reason: 'Documents legacy `rm -rf .artifacts/webview` step in case Loop 01 cache-invalidation regresses.' },
    { file: 'README.md',
      phase: 'permanent',
      reason: 'User-facing README documents the default artifact root and resolution rules.' },

    // -----------------------------------------------------------------------
    // C. Memo / design docs
    // -----------------------------------------------------------------------
    { file: 'memo/ARCHITECTURE.md',
      phase: 'permanent',
      reason: 'Architecture notes describe the artifact root layout.' },
    { file: 'memo/codebase-quality-implementation-plan-2026-05-03.md',
      phase: 'permanent',
      reason: 'Older quality plan references the literal as a known hardcode site.' },
    { file: 'memo/codebase-quality-implementation-plan-2026-05-05.md',
      phase: 'permanent',
      reason: 'Current quality plan; constraint #5 IS this loop. Permanent historical record.' },
    { file: 'memo/design/01_non_ts_call_graphs.md',
      phase: 'permanent',
      reason: 'Design doc discusses `.artifacts/` vs `.llmem/` placement.' },
    { file: 'memo/design/02_folder_view.md',
      phase: 'permanent',
      reason: 'Design doc describes folder-view artifacts under the artifact root.' },
    { file: 'memo/design/03_spec_to_code_mapping.md',
      phase: 'permanent',
      reason: 'Design doc names the spec-index artifact path.' },
    { file: 'memo/design/04_platform.md',
      phase: 'permanent',
      reason: 'Platform design doc references the bundle layout under the artifact root.' },
    { file: 'memo/design/05_claude_integration.md',
      phase: 'permanent',
      reason: 'Claude integration design doc describes initial-scan output.' },
    { file: 'memo/design/06_cli_first.md',
      phase: 'permanent',
      reason: 'CLI-first design doc; includes a config TOML example with the default value.' },

    // -----------------------------------------------------------------------
    // D. Config defaults & workspace-marker walkers in src/
    //    After Loop 09, these are the *only* src/ callsites that should
    //    legitimately mention the literal. Any new entry to this
    //    category requires reviewer scrutiny in the PR.
    // -----------------------------------------------------------------------
    { file: 'src/claude/cli/commands/generate.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker (`[\'.git\', \'package.json\', \'.llmem\', \'.arch\', \'.artifacts\']`).' },
    { file: 'src/claude/cli/commands/init.ts',
      phase: 'permanent',
      reason: 'Emits a `.llmem/config.toml` template that contains `artifactRoot = ".artifacts"`.' },
    { file: 'src/claude/cli/commands/scan.ts',
      phase: 'permanent',
      reason: 'CLI command description string ("write edge lists to .artifacts/").' },
    { file: 'src/claude/cli/commands/serve.ts',
      phase: 'permanent',
      reason: 'Default `{ artifactRoot: \'.artifacts\' }` and `path.join(workspace, \'.artifacts\', \'webview\')` derived path.' },
    { file: 'src/claude/cli/commands/stats.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker.' },
    { file: 'src/claude/cli/main.ts',
      phase: 'permanent',
      reason: '--help text documents `LLMEM_ARTIFACT_ROOT` default value.' },
    { file: 'src/claude/cli/workspace.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker + JSDoc that lists the markers checked.' },
    { file: 'src/claude/config.ts',
      phase: 'permanent',
      reason: 'JSDoc documents `LLMEM_ARTIFACT_ROOT` env var default.' },
    { file: 'src/claude/index.ts',
      phase: 'permanent',
      reason: 'Workspace-marker walker.' },
    { file: 'src/claude/server/index.ts',
      phase: 'permanent',
      reason: 'JSDoc + `config.artifactRoot || \'.artifacts\'` fallback in HTTP server bootstrap.' },
    { file: 'src/claude/web-launcher.ts',
      phase: 'permanent',
      reason: 'Default-param assignment for the legacy back-compat path; ignored when `ctx` is supplied.' },
    { file: 'src/config-defaults.ts',
      phase: 'permanent',
      reason: 'Canonical default value for `RuntimeConfig.artifactRoot`. Single source of truth; if this entry ever moves, the rest of category D must follow.' },

    // -----------------------------------------------------------------------
    // E. IGNORED_FOLDERS / scan-skip lists in src/
    //    Sets of directory names to exclude from scans. The literal
    //    lives in a `Set` next to other always-ignored names like
    //    `node_modules` and `.git`. Safe future cleanup: centralise in
    //    `src/config-defaults.ts`.
    // -----------------------------------------------------------------------
    { file: 'src/artifact/service.ts',
      phase: 'permanent',
      reason: 'ALWAYS_IGNORED set in legacy artifact tree builder.' },
    { file: 'src/parser/config.ts',
      phase: 'permanent',
      reason: 'IGNORED_FOLDERS set used by parser scans.' },
    { file: 'src/parser/ts-service.ts',
      phase: 'permanent',
      reason: 'TS-specific skip set used by the TypeScript service walker.' },
    { file: 'src/webview/worktree.ts',
      phase: 'permanent',
      reason: 'Webview worktree builder ignored-folders set.' },

    // -----------------------------------------------------------------------
    // F. JSDoc / banner comments in src/
    //    Functional code uses `ctx.artifactRoot` (or equivalent) but
    //    comments describe the on-disk shape for readers.
    // -----------------------------------------------------------------------
    { file: 'src/artifact/path-mapper.ts',
      phase: 'permanent',
      reason: 'JSDoc describes the on-disk layout (`/.artifacts/path/to/source/file.ext/...`).' },
    { file: 'src/extension/panel.ts',
      phase: 'permanent',
      reason: 'JSDoc on `_loadFolderTree` / `_loadFolderEdges` documents which artifact JSON files are read.' },
    { file: 'src/scripts/generate-call-edges.ts',
      phase: 'permanent',
      reason: 'Dev script-side helper resolves `.artifacts` directly; scripts run outside the WorkspaceContext model, allowed by design.' },
    { file: 'src/scripts/generate_edgelist.ts',
      phase: 'permanent',
      reason: 'Dev script-side `configOverrides: { artifactRoot: \'.artifacts\' }` literal default.' },
    { file: 'src/webview/generator.ts',
      phase: 'permanent',
      reason: 'JSDoc + comments describe the `.artifacts/webview/` cache surface (this module owns it).' },
    { file: 'src/webview/shell-cache.ts',
      phase: 'permanent',
      reason: 'Banner doc on the cache-invalidation guard for `.artifacts/webview/` (this module owns the cache writes).' },
    { file: 'src/webview/ui/services/vscodeDataProvider.ts',
      phase: 'permanent',
      reason: 'JSDoc comment naming the artifact JSON file the host reads.' },

    // -----------------------------------------------------------------------
    // G. Architecture tests' own skip-directory lists
    // -----------------------------------------------------------------------
    { file: 'tests/arch/artifact-root-allowlist.test.ts',
      phase: 'permanent',
      reason: 'This file IS the allowlist test — its banner, regex, scan, ALLOWLIST entries, and assertion messages all mention the literal by design. Self-reference is permanent.' },
    { file: 'tests/arch/console-discipline.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc.' },
    { file: 'tests/arch/dependencies.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc.' },
    { file: 'tests/arch/file-size-budget.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc (loop 15 file-size budget; literal lives in shouldSkipDir).' },
    { file: 'tests/arch/graph-ids.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc.' },
    { file: 'tests/arch/no-layout-scratch-any.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc.' },
    { file: 'tests/arch/webview-shell-parity.test.ts',
      phase: 'permanent',
      reason: 'Banner comment + cache-invalidation test for `.artifacts/webview/`.' },
    { file: 'tests/arch/workspace-context-singleton.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc.' },
    { file: 'tests/arch/workspace-paths.test.ts',
      phase: 'permanent',
      reason: 'Skip directory in walkSrc + WRITE_ALLOWLIST justifications mention the directory.' },

    // -----------------------------------------------------------------------
    // H. Integration & contract tests under tests/
    //    Tests that legitimately need to construct a fixture artifact
    //    dir, assert against scan output paths, exercise CLI describe
    //    snapshots, etc.
    // -----------------------------------------------------------------------
    { file: 'tests/contracts/__snapshots__/cli-describe.json',
      phase: 'permanent',
      reason: 'Frozen CLI description snapshot mentions `.artifacts/` (matches src/claude/cli/commands/scan.ts).' },
    { file: 'tests/contracts/_helpers/build-server.ts',
      phase: 'permanent',
      reason: 'Fixture builds a server with `artifactRoot: \'.artifacts\'` and a webviewDir under it.' },
    { file: 'tests/contracts/http-route-dtos.test.ts',
      phase: 'permanent',
      reason: 'Constructs fixture artifact dir under tmp.' },
    { file: 'tests/integration/arch-watcher.test.ts',
      phase: 'permanent',
      reason: 'TEST_ARTIFACTS_DIR constant for the watcher fixture.' },
    { file: 'tests/integration/cli/cli-describe.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for CLI describe assertions.' },
    { file: 'tests/integration/cli/cli-document.test.ts',
      phase: 'permanent',
      reason: 'Comment + fixture artifact dir for CLI document assertions.' },
    { file: 'tests/integration/cli/cli-port-fallback.test.ts',
      phase: 'permanent',
      reason: 'Banner + comment about pre-existing `.artifacts/` in this repo as the test workspace.' },
    { file: 'tests/integration/cli/cli-scan-folder-artifacts.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir constructed under tmp (twice).' },
    { file: 'tests/integration/cli/cli-scan.test.ts',
      phase: 'permanent',
      reason: 'Banner + fixture path assertions on scan output files.' },
    { file: 'tests/integration/cli/cli-serve-folder-artifacts.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for the serve-folder-artifacts integration.' },
    { file: 'tests/integration/cli/cli-serve-zero-config.test.ts',
      phase: 'permanent',
      reason: 'Banner + asserts that scan wrote `.artifacts/import-edgelist.json`.' },
    { file: 'tests/integration/document-folder.test.ts',
      phase: 'permanent',
      reason: 'Test name + "poison" fixture asserts hardcoded `.artifacts` is NOT used (Loop 09 contract).' },
    { file: 'tests/integration/graph-build.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for graph-build integration.' },
    { file: 'tests/integration/mcp-tools.test.ts',
      phase: 'permanent',
      reason: 'Comment about reader/writer not consulting `.artifacts` directly.' },
    { file: 'tests/integration/server-hardening.test.ts',
      phase: 'permanent',
      reason: 'Fixture builds a server with `artifactRoot: \'.artifacts\'` and webviewDir under it (multiple fixtures).' },
    { file: 'tests/integration/toggle-watch.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for the toggle-watch integration (multiple fixtures).' },
    { file: 'tests/integration/webview/generator-folder-globals.test.ts',
      phase: 'permanent',
      reason: 'Banner mentions `.artifacts/webview/` cache rule (per CLAUDE.md).' },

    // -----------------------------------------------------------------------
    // I. Unit tests under tests/unit/
    // -----------------------------------------------------------------------
    { file: 'tests/unit/application/scan-containment.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for scan-containment unit test.' },
    { file: 'tests/unit/application/viewer-data.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for viewer-data unit test.' },
    { file: 'tests/unit/application/workspace-context.test.ts',
      phase: 'permanent',
      reason: 'Asserts `RuntimeConfig.artifactRoot` default value is `.artifacts`.' },
    { file: 'tests/unit/claude-server/middleware.test.ts',
      phase: 'permanent',
      reason: 'Fixture builds context with `artifactRoot: \'.artifacts\'`.' },
    { file: 'tests/unit/extension/panel-folder-handlers.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for panel folder-handlers unit test.' },
    { file: 'tests/unit/graph/folder-edges-store.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for folder-edges-store unit tests (multiple fixtures).' },
    { file: 'tests/unit/graph/folder-tree-store.test.ts',
      phase: 'permanent',
      reason: 'Fixture artifact dir for folder-tree-store unit tests (multiple fixtures).' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('artifact-root-allowlist: every observed `.artifacts` literal is in ALLOWLIST', () => {
    const matches = scanArtifactsLiteral();
    const allowed = new Set(ALLOWLIST.map((e) => e.file));

    const offenders = matches.filter((m) => !allowed.has(m.rel));
    if (offenders.length > 0) {
        for (const o of offenders) {
            console.error(
                `ARTIFACTS-LITERAL-OUTSIDE-ALLOWLIST  ${o.rel}:${o.line}\n  ` +
                    `${o.content}\n  ` +
                    `Add this file to ALLOWLIST in tests/arch/artifact-root-allowlist.test.ts ` +
                    `with a one-line reason, or refactor it to consume \`ctx.artifactRoot\` ` +
                    `instead of the literal.`,
            );
        }
        assert.fail(
            `${offenders.length} \`.artifacts\` literal occurrence(s) found outside ` +
                `the allowlist. See console.error above for each offender and the ` +
                `recommended fix.`,
        );
    }
});

test('artifact-root-allowlist: every ALLOWLIST entry is still observed (no STALE rows)', () => {
    const matches = scanArtifactsLiteral();
    const observedFiles = new Set(matches.map((m) => m.rel));

    const stale: AllowlistEntry[] = [];
    for (const e of ALLOWLIST) {
        if (!observedFiles.has(e.file)) stale.push(e);
    }

    if (stale.length > 0) {
        for (const e of stale) {
            console.error(
                `STALE  ${e.file}  remove from ALLOWLIST in ` +
                    `tests/arch/artifact-root-allowlist.test.ts (reason was: ${e.reason})`,
            );
        }
        assert.fail(`${stale.length} stale ALLOWLIST entry/entries detected.`);
    }
});
