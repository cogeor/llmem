// tests/arch/console-discipline.test.ts
//
// Console-discipline safety net (Loop 20). Every direct `console.*` call
// in `src/` must live under one of the allow-listed paths, OR sit on a
// line that is preceded by an `// eslint-disable-next-line no-console`
// directive. Anything else fails the build.
//
// Allow-list (forward-slash, repo-relative):
//   - src/common/logger.ts                  // logger module (sink)
//   - src/core/logger.ts                    // boundary interface + consoleLogger
//   - src/webview/ui/**                     // browser bundle
//   - src/webview/live-reload.ts            // browser WebSocket client
//   - src/claude/cli.ts                     // CLI user-facing output
//   - src/info/cli.ts                       // CLI user-facing output
//   - src/info/cli_folder.ts                // CLI user-facing output
//   - src/scripts/**                        // dev script entrypoints
//   - src/claude/server/open-browser.ts     // user-facing fallback
//                                              ("Please open ${url} manually")
//
// Implementation notes:
//   - Detection uses the TypeScript Compiler API (no regex on raw
//     source), so the substring `console.` inside string literals or
//     comments cannot produce false positives.
//   - For non-allow-listed files, we still skip a call site if the line
//     ABOVE it carries `// eslint-disable-next-line no-console`. This
//     covers the documented fatal-bootstrap exemptions in
//     `src/mcp/server.ts` and `src/claude/index.ts`.
//   - Paths are forward-slash and relative to repo root.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

interface ConsoleCallSite {
    readonly rel: string;
    readonly line: number;
}

interface KnownViolation {
    readonly rel: string;
    readonly line: number;
    readonly reason: string;
}

// Loop 20 lands with a clean migration. Documented exemptions live as
// `// eslint-disable-next-line no-console` directives on the line above
// the call (see `src/mcp/server.ts` and `src/claude/index.ts`); those
// are skipped at the AST-collection layer below, NOT through this list.
// This list is reserved for future loops that need a transitional
// path-and-line entry.
const KNOWN_VIOLATIONS: readonly KnownViolation[] = [];

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

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

/**
 * Path is in the allow-list (browser bundle, CLI surfaces, scripts,
 * logger sink itself, the boundary interface module, the browser
 * live-reload client, and the open-browser user-facing fallback).
 */
function isAllowedPath(rel: string): boolean {
    return (
        rel === 'src/common/logger.ts' ||
        rel === 'src/core/logger.ts' ||
        rel === 'src/webview/live-reload.ts' ||
        rel === 'src/claude/cli.ts' ||
        rel === 'src/info/cli.ts' ||
        rel === 'src/info/cli_folder.ts' ||
        rel === 'src/claude/server/open-browser.ts' ||
        rel.startsWith('src/webview/ui/') ||
        rel.startsWith('src/scripts/')
    );
}

const ESLINT_DISABLE_RE = /\/\/\s*eslint-disable-next-line\s+no-console\b/;

/**
 * AST-walk a file and return every `console.<level>` call site. A site
 * is reported as `{ rel, line }` (1-indexed line number). If the line
 * IMMEDIATELY ABOVE the call carries
 * `// eslint-disable-next-line no-console`, the call is treated as
 * exempt and not returned.
 */
function collectConsoleCallSitesInFile(filePath: string): ConsoleCallSite[] {
    const source = fs.readFileSync(filePath, 'utf-8');
    const sf = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
    );
    const lines = source.split('\n');
    const rel = toRepoRel(filePath);
    const sites: ConsoleCallSite[] = [];

    function isExempt(zeroIndexedLine: number): boolean {
        if (zeroIndexedLine <= 0) return false;
        const prev = lines[zeroIndexedLine - 1] ?? '';
        return ESLINT_DISABLE_RE.test(prev);
    }

    function visit(node: ts.Node): void {
        // Match `console.<level>` member expressions whose <level> is in
        // the standard set. We match on the property access itself
        // (NOT the call expression) so plain member accesses like
        // `const fn = console.log;` are also caught.
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'console' &&
            ts.isIdentifier(node.name)
        ) {
            const levelName = node.name.text;
            if (
                levelName === 'log' ||
                levelName === 'debug' ||
                levelName === 'info' ||
                levelName === 'warn' ||
                levelName === 'error'
            ) {
                const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
                if (!isExempt(line)) {
                    // line is zero-indexed; report 1-indexed for human readers.
                    sites.push({ rel, line: line + 1 });
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sf);
    return sites;
}

function collectConsoleCallSites(): ConsoleCallSite[] {
    const sources = walkSrc(SRC_ROOT);
    const all: ConsoleCallSite[] = [];
    for (const file of sources) {
        all.push(...collectConsoleCallSitesInFile(file));
    }
    return all;
}

function siteKey(site: { rel: string; line: number }): string {
    return `${site.rel}:${site.line}`;
}

test('console-discipline: every direct console.* call lives under the allow-list (or is eslint-disabled)', () => {
    const observed = collectConsoleCallSites();
    const known = new Set(KNOWN_VIOLATIONS.map((v) => siteKey(v)));

    const offenders = observed.filter((site) => !isAllowedPath(site.rel));
    const undocumented = offenders.filter((site) => !known.has(siteKey(site)));

    if (undocumented.length > 0) {
        for (const site of undocumented) {
            // Surface the offender with a clear pointer at the right fix.
            // (Yes, this uses console.error itself — this file is a test
            // file under tests/arch/, not src/, so the rule does not
            // apply here.)
            console.error(
                `CONSOLE-DISCIPLINE VIOLATION  ${siteKey(site)}\n  ` +
                    `Route this call through src/common/logger.ts (createLogger). ` +
                    `If it is a fatal-bootstrap line that fires before the logger is ` +
                    `constructed, mark it with ` +
                    `\`// eslint-disable-next-line no-console\` on the line above and ` +
                    `add a one-line comment explaining why.`,
            );
        }
        assert.fail(
            `New console-discipline violation(s) detected (${undocumented.length}). ` +
                `See console.error above for each offender and the recommended fix.`,
        );
    }
});

test('console-discipline: every KNOWN_VIOLATIONS entry is still observed (no STALE rows)', () => {
    const observed = collectConsoleCallSites();
    const observedKeys = new Set(observed.map((site) => siteKey(site)));
    const stale: KnownViolation[] = [];

    for (const v of KNOWN_VIOLATIONS) {
        if (!observedKeys.has(siteKey(v))) stale.push(v);
    }

    if (stale.length > 0) {
        for (const v of stale) {
            console.error(
                `STALE  ${siteKey(v)} no longer present; ` +
                    `remove from KNOWN_VIOLATIONS in tests/arch/console-discipline.test.ts.\n  reason was: ${v.reason}`,
            );
        }
        assert.fail(`${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`);
    }
});
