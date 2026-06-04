// tests/arch/logger-ownership.test.ts
//
// K3 — pin NAME-OWNERSHIP of the `Logger` boundary type.
//
// Purpose
// -------
// The codebase historically had TWO exports named `Logger`:
//
//   * `src/core/logger.ts`   — `interface Logger` (the pluggable boundary
//     TYPE: info/warn/error, plus `NoopLogger` / `consoleLogger`). This is
//     the leaf contract that `application/` and everything above it depend
//     on; core/ has zero outward imports.
//
//   * `src/common/logger.ts` — a concrete `class Logger` (leveled/scoped
//     structured logger: LogLevel/LogEntry/LoggerConfig + createLogger +
//     the `logger` singleton).
//
// Same identifier, two unrelated concepts = ambiguous "duplicate logger
// vocabulary". K3 resolves the ownership:
//
//   * core/logger.ts  OWNS the boundary TYPE named exactly `Logger`.
//   * common/logger.ts OWNS the concrete IMPLEMENTATION under the distinct
//     name `StructuredLogger` (which `implements` core's `Logger`).
//
// This test turns that decision into an enforced invariant so a future
// change can never reintroduce a second `Logger` export and re-muddy the
// vocabulary.
//
// What it asserts
// ---------------
//   1. Across `src/**/*.ts`, the ONLY file that exports something named
//      exactly `Logger` (an `export interface/class/type Logger`, or an
//      `export { Logger }` re-export of a local `Logger`) is
//      `src/core/logger.ts`.
//   2. `src/common/logger.ts` exports the concrete impl under the distinct
//      name `StructuredLogger`, and does NOT export anything named exactly
//      `Logger`.
//
// NON-goal: this test does NOT police which inner layers call
// `createLogger`. Ten inner files legitimately use the structured logger;
// that DI concern is out of scope. This is strictly about the NAME of the
// boundary type.
//
// Matching is exact-identifier (`\bLogger\b` with the immediate next char
// checked) so siblings like `StructuredLogger`, `ScanLogger`,
// `NoopLogger`, `WebviewLogger`, and `BoundaryLogger` aliases never match.
//
// Dependency-free: node:test + node:assert/strict + node:fs + node:path +
// regex, mirroring artifact-root-allowlist.test.ts.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// The one file allowed to export the boundary TYPE named exactly `Logger`.
const BOUNDARY_OWNER = 'src/core/logger.ts';
// The file that owns the concrete implementation under a distinct name.
const IMPL_FILE = 'src/common/logger.ts';
const IMPL_NAME = 'StructuredLogger';

const SKIP_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    'dist',
    '.artifacts',
    '.llmem',
    '.delegate',
    '.arch',
    'out',
    'build',
    'coverage',
]);

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function walkSrc(root: string, out: string[] = []): string[] {
    const entries = fs.readdirSync(root, { withFileTypes: true })
        .slice()
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkSrc(full, out);
        } else if (
            entry.isFile() &&
            entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.d.ts')
        ) {
            out.push(full);
        }
    }
    return out;
}

// --- Exact-identifier matchers --------------------------------------------
//
// `export interface Logger`, `export class Logger`, `export type Logger`,
// optionally with `abstract`/`declare`/`default` between `export` and the
// keyword. The trailing `(?![A-Za-z0-9_$])` rejects `StructuredLogger`,
// `LoggerConfig`, etc.
const DECL_RE =
    /\bexport\s+(?:default\s+|abstract\s+|declare\s+)*(?:interface|class|type)\s+Logger(?![A-Za-z0-9_$])/;

// `export { ... Logger ... }` re-export of a LOCAL `Logger` (no `as`
// rename that would change the exported name). We match a `Logger` token
// inside an `export { ... }` clause that is NOT immediately followed by
// `as` (which would rename it to something else) and is NOT itself the
// target of an `as` rename (`Foo as Logger` IS an export of `Logger`, so
// that we DO want to catch).
function hasNamedLoggerReexport(source: string): boolean {
    // Collapse to single-line per export block to keep the regex simple.
    const exportBlocks = source.match(/export\s*\{[^}]*\}/g) ?? [];
    for (const block of exportBlocks) {
        // Split specifiers on commas.
        const specs = block
            .replace(/^export\s*\{/, '')
            .replace(/\}$/, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const spec of specs) {
            // `Foo as Logger`  -> exported name is `Logger`
            const asMatch = spec.match(/\bas\s+([A-Za-z0-9_$]+)$/);
            if (asMatch) {
                if (asMatch[1] === 'Logger') return true;
                continue; // renamed to something else; exported name not `Logger`
            }
            // bare `Logger` (no rename) -> exported name is `Logger`
            if (/^Logger$/.test(spec)) return true;
        }
    }
    return false;
}

function exportsNamedLogger(source: string): boolean {
    return DECL_RE.test(source) || hasNamedLoggerReexport(source);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('logger-ownership: the boundary type `Logger` is exported ONLY by src/core/logger.ts', () => {
    const offenders: string[] = [];
    for (const abs of walkSrc(SRC_ROOT)) {
        const rel = toRepoRel(abs);
        if (rel === BOUNDARY_OWNER) continue;
        let source: string;
        try {
            source = fs.readFileSync(abs, 'utf-8');
        } catch {
            continue;
        }
        if (exportsNamedLogger(source)) offenders.push(rel);
    }
    offenders.sort();

    if (offenders.length > 0) {
        for (const rel of offenders) {
            console.error(
                `LOGGER-NAME-OWNERSHIP  ${rel}\n  ` +
                    `exports something named exactly \`Logger\`, but the boundary\n  ` +
                    `TYPE named \`Logger\` is owned solely by \`${BOUNDARY_OWNER}\`.\n  ` +
                    `If this is a concrete implementation, export it under a distinct\n  ` +
                    `name (e.g. \`${IMPL_NAME}\`) and have it \`implements Logger\` from\n  ` +
                    `core/logger. If it is a boundary type, depend on core's \`Logger\`.`,
            );
        }
        assert.fail(
            `${offenders.length} file(s) other than \`${BOUNDARY_OWNER}\` export the ` +
                `name \`Logger\`. See console.error above. The boundary type \`Logger\` ` +
                `has exactly one owner.`,
        );
    }
});

test('logger-ownership: src/core/logger.ts DOES own the `Logger` boundary type', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, BOUNDARY_OWNER), 'utf-8');
    assert.ok(
        exportsNamedLogger(source),
        `Expected \`${BOUNDARY_OWNER}\` to export the boundary type named exactly ` +
            `\`Logger\` (e.g. \`export interface Logger\`). It does not — ownership ` +
            `of the boundary type has been lost.`,
    );
});

test('logger-ownership: src/common/logger.ts exports `StructuredLogger`, never `Logger`', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, IMPL_FILE), 'utf-8');

    assert.ok(
        new RegExp(`\\bexport\\s+class\\s+${IMPL_NAME}\\b`).test(source),
        `Expected \`${IMPL_FILE}\` to export the concrete implementation as ` +
            `\`export class ${IMPL_NAME}\`. The structured logger must live under ` +
            `the distinct name \`${IMPL_NAME}\`, not \`Logger\`.`,
    );

    assert.ok(
        !exportsNamedLogger(source),
        `\`${IMPL_FILE}\` must NOT export anything named exactly \`Logger\` — the ` +
            `boundary type name belongs to \`${BOUNDARY_OWNER}\`. The concrete impl ` +
            `is \`${IMPL_NAME}\` (which \`implements\` core's \`Logger\`).`,
    );
});
