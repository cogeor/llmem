// tests/arch/parser-descriptor-purity.test.ts
//
// Loop 10 (K1) — keep `src/parser/language-descriptors.ts` PURE static
// metadata.
//
// Purpose
// -------
// The language metadata was split into three files:
//   - `language-descriptors.ts`  — pure static data (id, extensions, etc.)
//   - `language-loaders.ts`      — the lazy `require()`-based adapter loaders
//   - `languages.ts`             — the composed registry view (descriptor+load)
//
// The whole point of the split is that metadata-only consumers
// (`src/parser/config.ts`, `src/application/scan/hints.ts`) can read the
// descriptors WITHOUT transitively pulling in adapter modules or native
// tree-sitter grammars. If a runtime loader / grammar require()/adapter import
// ever leaks back into `language-descriptors.ts`, that guarantee silently
// breaks. This test turns the invariant into an enforced literal scan,
// mirroring `tests/arch/artifact-root-allowlist.test.ts`'s style.
//
// How to fix when it fails
// ------------------------
//   - DESCRIPTOR-IMPURITY <line>: `language-descriptors.ts` contains a
//     `require(`, dynamic `import(`, an `*/adapter` import, or a require()/
//     import of a tree-sitter grammar package. (A `grammarPackage:
//     'tree-sitter-...'` static STRING value is fine — that is metadata.)
//     Move that runtime concern into `language-loaders.ts` (or
//     `languages.ts`) — the descriptor file must stay data-only.
//   - CONFIG-ADAPTER-COUPLING <line>: `config.ts` imported something that
//     can transitively reach an adapter (`./languages`, `./adapter`, or a
//     grammar). Repoint it to `./language-descriptors`.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const DESCRIPTORS_FILE = path.join(
    REPO_ROOT, 'src', 'parser', 'language-descriptors.ts',
);
const CONFIG_FILE = path.join(REPO_ROOT, 'src', 'parser', 'config.ts');

function readLines(absPath: string): string[] {
    return fs.readFileSync(absPath, 'utf-8').split('\n');
}

// Strip `// ...` line comments so prose in banners/JSDoc (which legitimately
// mentions `require`, `adapter`, `tree-sitter-...`) does not trip the scan.
// Block-comment bodies (`* ...`) are likewise excluded by requiring the match
// to NOT sit on a comment-continuation line.
function isCommentLine(line: string): boolean {
    const t = line.trim();
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

interface Offender {
    readonly line: number;     // 1-indexed
    readonly content: string;  // trimmed
    readonly why: string;
}

// Patterns that must NEVER appear in CODE lines of language-descriptors.ts.
//
// NOTE: a tree-sitter package name appearing as a STRING VALUE (the
// `grammarPackage: 'tree-sitter-python'` static field) is pure metadata and is
// allowed — purity is about RUNTIME LOADING, not data. So the grammar check is
// scoped to a require()/import context, never a bare data string.
const IMPURITY_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
    { re: /\brequire\s*\(/, why: 'require() — runtime grammar/adapter load' },
    { re: /\bimport\s*\(/, why: 'dynamic import() — runtime load' },
    { re: /from\s+['"][^'"]*\/adapter['"]/, why: "imports an '*/adapter' module" },
    { re: /from\s+['"]\.\/adapter['"]/, why: "imports './adapter'" },
    {
        re: /(?:require\s*\(|from)\s*['"][^'"]*tree-sitter-/,
        why: 'require()/import of a tree-sitter grammar package',
    },
];

test('parser-descriptor-purity: language-descriptors.ts is pure static metadata', () => {
    const lines = readLines(DESCRIPTORS_FILE);
    const offenders: Offender[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line)) continue;
        for (const { re, why } of IMPURITY_PATTERNS) {
            if (re.test(line)) {
                offenders.push({ line: i + 1, content: line.trim(), why });
            }
        }
    }

    if (offenders.length > 0) {
        for (const o of offenders) {
            console.error(
                `DESCRIPTOR-IMPURITY  language-descriptors.ts:${o.line}\n  ` +
                    `${o.content}\n  (${o.why})`,
            );
        }
        assert.fail(
            `${offenders.length} impurity/-ies found in ` +
                `src/parser/language-descriptors.ts — it must contain NO ` +
                `require()/import()/adapter-import/grammar specifier. Move ` +
                `runtime loaders into src/parser/language-loaders.ts.`,
        );
    }
});

test('parser-descriptor-purity: config.ts does not import an adapter-coupled module', () => {
    const lines = readLines(CONFIG_FILE);
    const offenders: Offender[] = [];

    // config.ts is metadata-only: its language import must be the pure
    // `./language-descriptors`, never `./languages` (composed w/ loaders),
    // `./adapter`, or a grammar package.
    const COUPLED_IMPORTS: ReadonlyArray<{ re: RegExp; why: string }> = [
        { re: /from\s+['"]\.\/languages['"]/, why: "imports './languages' (carries loaders)" },
        { re: /from\s+['"][^'"]*\/adapter['"]/, why: "imports an '*/adapter' module" },
        { re: /from\s+['"]\.\/adapter['"]/, why: "imports './adapter'" },
        { re: /from\s+['"]tree-sitter-/, why: 'imports a tree-sitter grammar' },
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isCommentLine(line)) continue;
        if (!/^\s*import\b/.test(line)) continue;
        for (const { re, why } of COUPLED_IMPORTS) {
            if (re.test(line)) {
                offenders.push({ line: i + 1, content: line.trim(), why });
            }
        }
    }

    if (offenders.length > 0) {
        for (const o of offenders) {
            console.error(
                `CONFIG-ADAPTER-COUPLING  config.ts:${o.line}\n  ` +
                    `${o.content}\n  (${o.why})`,
            );
        }
        assert.fail(
            `${offenders.length} adapter-coupled import(s) in ` +
                `src/parser/config.ts — it must import language metadata from ` +
                `'./language-descriptors', never from './languages'/'./adapter'.`,
        );
    }
});
