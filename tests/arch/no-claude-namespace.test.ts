// tests/arch/no-claude-namespace.test.ts
//
// Loop J4 (a-grade refactor) — guard against re-introducing the legacy
// `src/claude` source namespace or the `dist/claude` output layout.
//
// Purpose
// -------
// J4 hoisted the MCP stdio entry point out of `src/claude/` (now
// `src/mcp/main.ts` + `src/mcp/config.ts`) and retargeted the build so
// the published bundles live at `dist/cli/main.js` and `dist/mcp/main.js`
// (no more `dist/claude/**`). The package surface — `main`, `exports`,
// `files[]`, `bin/llmem` — and every dist-spawning test helper now point
// at the new paths. This test makes the de-brand a hard invariant: any
// re-appearance of the literal token `src/claude` or `dist/claude` in a
// scanned source / test / build / package file fails the suite, so the
// rename cannot silently regress.
//
// What it scans
// -------------
// Walks the repo (skipping generated / vendored / VCS dirs and binary
// outputs) and matches the literal substrings `src/claude` and
// `dist/claude` in file CONTENT. It does NOT match on directory names —
// the `tests/unit/claude/` directory keeps its historical name, and a
// PATH segment `tests/unit/claude` is not the forbidden token (the token
// is `src/claude` / `dist/claude`).
//
// Allowed exceptions
// ------------------
//   - THIS test file: its banner, regex, and assertion messages name the
//     forbidden tokens by design (self-reference is permanent).
//
// Implementation notes
// --------------------
//   - Pure literal-string scan (no TypeScript Compiler API): the token is
//     blunt and unambiguous, so a substring scan is sufficient.
//   - Walk skip / include rules mirror artifact-root-allowlist.test.ts:
//     skip node_modules, .git, .claude, dist, .artifacts, .arch, .llmem,
//     .delegate, plans, memo, notes, out, build, coverage; skip .js /
//     .d.ts / map / binary files; include .ts/.tsx/.json/.md/.yaml/.yml/
//     .toml/.html/.css plus a small set of named root dot-files and the
//     extension-less `bin/llmem` shim.
//   - `memo/` and `notes/` are historical design / analysis records that
//     legitimately describe the pre-J4 `src/claude` layout (what WAS
//     built at the time); they are not the build/package/test contract,
//     so they are skipped — the same carve-out artifact-root-allowlist
//     applies to memo/. `.claude/` is Claude Code harness config, not
//     project source.
//   - No external deps beyond node:test / node:assert / node:fs /
//     node:path.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// The forbidden literal tokens. `src/claude` is the retired source
// namespace; `dist/claude` is the retired build-output layout.
const FORBIDDEN_TOKENS: readonly string[] = ['src/claude', 'dist/claude'];

// Files explicitly allowed to contain the forbidden token (self-references).
const ALLOWED_FILES: ReadonlySet<string> = new Set([
    'tests/arch/no-claude-namespace.test.ts',
]);

const SKIP_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    '.claude',
    'dist',
    '.artifacts',
    '.arch',
    '.llmem',
    '.delegate',
    'memo',
    'notes',
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

// Extension-less files we explicitly include (the bin shim + a few named
// repo-root dot-files).
const NAMED_INCLUDED_FILES: ReadonlySet<string> = new Set([
    'llmem', // bin/llmem
    '.gitignore',
    '.eslintrc.json',
    '.vscodeignore',
    '.env.example',
]);

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
    if (NAMED_INCLUDED_FILES.has(name)) return true;
    for (const sfx of INCLUDE_FILE_SUFFIXES) {
        if (name.endsWith(sfx)) return true;
    }
    return false;
}

function walkRepo(root: string, out: string[] = []): string[] {
    const entries = fs
        .readdirSync(root, { withFileTypes: true })
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (shouldSkipDir(entry.name)) continue;
            walkRepo(full, out);
        } else if (entry.isFile() && shouldIncludeFile(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

interface Match {
    readonly rel: string;
    readonly line: number;
    readonly token: string;
    readonly content: string;
}

function scanForbiddenTokens(): Match[] {
    const matches: Match[] = [];
    for (const abs of walkRepo(REPO_ROOT)) {
        const rel = toRepoRel(abs);
        if (ALLOWED_FILES.has(rel)) continue;
        let source: string;
        try {
            source = fs.readFileSync(abs, 'utf-8');
        } catch {
            continue;
        }
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const token of FORBIDDEN_TOKENS) {
                if (line.includes(token)) {
                    matches.push({
                        rel,
                        line: i + 1,
                        token,
                        content: line.trim(),
                    });
                }
            }
        }
    }
    matches.sort((a, b) => {
        if (a.rel !== b.rel) return a.rel < b.rel ? -1 : 1;
        return a.line - b.line;
    });
    return matches;
}

test('no-claude-namespace: no file references the retired `src/claude` or `dist/claude` namespace', () => {
    const matches = scanForbiddenTokens();

    if (matches.length > 0) {
        for (const m of matches) {
            // eslint-disable-next-line no-console
            console.error(
                `CLAUDE-NAMESPACE-REGRESSION  ${m.rel}:${m.line}  (token: ${m.token})\n  ` +
                    `${m.content}\n  ` +
                    `The legacy \`src/claude\` source namespace and \`dist/claude\` ` +
                    `output layout were retired in J4. Use \`src/mcp\` / \`src/cli\` ` +
                    `(source) and \`dist/mcp/main.js\` / \`dist/cli/main.js\` (output).`,
            );
        }
        assert.fail(
            `${matches.length} forbidden \`src/claude\`/\`dist/claude\` reference(s) found. ` +
                `See console.error above for each offender.`,
        );
    }
});
