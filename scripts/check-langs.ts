/**
 * Languages parity gate (`npm run check:langs`).
 *
 * Asserts the LANGUAGES descriptor in src/parser/languages.ts stays in sync
 * with the things that must mirror it elsewhere in the repo:
 *
 *   1. peerDeps parity (authoritative, exact):
 *        - every LANGUAGES.grammarPackage is a package.json peerDependency
 *          AND is marked optional:true in peerDependenciesMeta.
 *        - every package.json peerDependency corresponds to a LANGUAGES
 *          grammarPackage (no orphan peerDeps). All current peerDeps ARE
 *          tree-sitter grammars, so the two sets must match exactly.
 *
 *   2. README Languages table presence (scoped to a SUBSTRING check):
 *        - the README mentions each language's displayName and, when it has
 *          one, its grammarPackage. Parsing the markdown table cell-by-cell is
 *          brittle (multi-extension cells, "…" truncation, emoji), so this is
 *          deliberately a presence check rather than a structural row-by-row
 *          parity. The peerDep check above is the strict gate.
 *
 * Exit 0 in parity; exit 1 with a list of mismatches otherwise.
 *
 * Run: npm run check:langs   (-> npx ts-node scripts/check-langs.ts)
 */

import * as fs from 'fs';
import * as path from 'path';

import { LANGUAGES } from '../src/parser/languages';

const REPO_ROOT = path.resolve(__dirname, '..');

const problems: string[] = [];
function bad(msg: string): void {
    problems.push(msg);
}

// ---------------------------------------------------------------------------
// Load package.json + README.
// ---------------------------------------------------------------------------

const pkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

const peerDeps = pkg.peerDependencies ?? {};
const peerMeta = pkg.peerDependenciesMeta ?? {};

// Grammar packages declared by the single source of truth.
const descriptorGrammars = LANGUAGES
    .map((l) => l.grammarPackage)
    .filter((g): g is string => typeof g === 'string');

const descriptorGrammarSet = new Set(descriptorGrammars);
const peerDepSet = new Set(Object.keys(peerDeps));

// ---------------------------------------------------------------------------
// 1. peerDeps parity (exact, both directions).
// ---------------------------------------------------------------------------

for (const grammar of descriptorGrammars) {
    if (!peerDepSet.has(grammar)) {
        bad(`LANGUAGES grammarPackage "${grammar}" is missing from package.json peerDependencies.`);
        continue;
    }
    if (!peerMeta[grammar] || peerMeta[grammar].optional !== true) {
        bad(`peerDependency "${grammar}" must be marked optional:true in peerDependenciesMeta.`);
    }
}

for (const dep of peerDepSet) {
    if (!descriptorGrammarSet.has(dep)) {
        bad(`orphan peerDependency "${dep}" has no matching LANGUAGES grammarPackage (every grammar peerDep must mirror a descriptor entry).`);
    }
}

// ---------------------------------------------------------------------------
// 2. README Languages table presence (substring scope — see header comment).
// ---------------------------------------------------------------------------

for (const lang of LANGUAGES) {
    if (!readme.includes(lang.displayName)) {
        bad(`README does not mention language displayName "${lang.displayName}".`);
    }
    if (lang.grammarPackage && !readme.includes(lang.grammarPackage)) {
        bad(`README does not mention grammar package "${lang.grammarPackage}" for "${lang.displayName}".`);
    }
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

if (problems.length > 0) {
    console.error('check:langs FAILED — LANGUAGES descriptor is out of sync:\n');
    for (const p of problems) {
        console.error(`  - ${p}`);
    }
    console.error(
        '\nFix: keep src/parser/languages.ts, package.json peerDependencies/' +
        'peerDependenciesMeta, and the README Languages table in sync.',
    );
    process.exit(1);
}

console.log(
    `check:langs OK — ${LANGUAGES.length} languages, ` +
    `${descriptorGrammars.length} grammar peerDeps in parity ` +
    `(${descriptorGrammars.join(', ')}).`,
);
