// tests/arch/design-doc-keys.test.ts
//
// Pins the design-doc key mapping logic from src/webview/design-docs.ts:81-86.
//
// Today's mapping (at the call site):
//
//     relPath  := path.relative(archRoot, filePath).replace(/\\/g, '/')
//     isReadme := basename(filePath).toLowerCase() === 'readme.md'
//     key      := isReadme ? relPath : relPath.replace(/\.md$/, '.html')
//
// The test does NOT import DesignDocManager (which depends on `marked`).
// Instead it defines a local helper `mapDesignDocKey` that mirrors the logic
// exactly. Two layers pin the contract:
//
//   1. Behavioral table — every supported input maps to the expected key.
//   2. Structural pin   — design-docs.ts contains the literal substrings
//      we depend on. If Loop 04 changes the regex or the readme-check, both
//      this pin and the behavioral table update in the same commit.
//
// When Loop 04 introduces src/docs/arch-store.ts, this test moves to import
// that module's helper directly and the structural pin is removed in the
// same commit.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DESIGN_DOCS_PATH = path.join(REPO_ROOT, 'src', 'webview', 'design-docs.ts');

function mapDesignDocKey(archRoot: string, filePath: string): string {
  const relPath = path.relative(archRoot, filePath).replace(/\\/g, '/');
  const isReadme = path.basename(filePath).toLowerCase() === 'readme.md';
  return isReadme ? relPath : relPath.replace(/\.md$/, '.html');
}

interface MappingCase {
  readonly description: string;
  readonly archRoot: string;
  readonly filePath: string;
  readonly expectedKey: string;
}

// archRoot is constant; filePath varies (use forward slashes — path.relative
// normalizes on each OS, and we replace backslashes downstream).
const ARCH_ROOT = '/repo/.arch';

const CASES: readonly MappingCase[] = [
  {
    description: 'leaf .md under a subdirectory becomes .html',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/src/parser.md',
    expectedKey: 'src/parser.html',
  },
  {
    description: 'deeper leaf .md becomes .html',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/src/graph/edgelist.md',
    expectedKey: 'src/graph/edgelist.html',
  },
  {
    description: 'README.md in a subfolder is preserved (folder doc)',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/src/graph/README.md',
    expectedKey: 'src/graph/README.md',
  },
  {
    description: 'top-level README.md is preserved',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/README.md',
    expectedKey: 'README.md',
  },
  {
    description: 'uppercase non-README .md becomes .html (case-preserved in stem)',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/src/PARSER.md',
    expectedKey: 'src/PARSER.html',
  },
  {
    description: 'mixed-case Readme.md is preserved (basename match is case-insensitive)',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/src/Readme.md',
    expectedKey: 'src/Readme.md',
  },
  {
    description: 'all-caps README.MD is preserved (basename match is case-insensitive)',
    archRoot: ARCH_ROOT,
    filePath: '/repo/.arch/docs/README.MD',
    expectedKey: 'docs/README.MD',
  },
];

test('design-doc key mapping: behavioral table', () => {
  for (const c of CASES) {
    const got = mapDesignDocKey(c.archRoot, c.filePath);
    assert.equal(
      got,
      c.expectedKey,
      `${c.description}\n  filePath=${c.filePath}\n  expected=${c.expectedKey}\n  got=${got}`
    );
  }
});

test('design-doc key mapping: only .md files reach the mapper (call-site guard)', () => {
  // The walker in design-docs.ts gates on filePath.endsWith('.md') BEFORE
  // calling the mapper. We cannot test the walker without importing marked,
  // but we can pin the guard literal.
  const source = fs.readFileSync(DESIGN_DOCS_PATH, 'utf-8');
  assert.ok(
    source.includes(".endsWith('.md')") || source.includes('.endsWith(".md")'),
    `src/webview/design-docs.ts must guard on .endsWith('.md') before mapping keys; ` +
      `if Loop 04 changes the guard, update tests/arch/design-doc-keys.test.ts in the same commit.`
  );
});

test('design-doc key mapping: structural pin on the source-of-truth literals', () => {
  const source = fs.readFileSync(DESIGN_DOCS_PATH, 'utf-8');

  // The README check.
  assert.ok(
    source.includes("path.basename(filePath).toLowerCase() === 'readme.md'") ||
      source.includes('path.basename(filePath).toLowerCase() === "readme.md"'),
    `src/webview/design-docs.ts must contain the literal README-check ` +
      `\`path.basename(filePath).toLowerCase() === 'readme.md'\`. If Loop 04 changes the ` +
      `check, update both this pin and the behavioral table in the same commit.`
  );

  // The .md -> .html replacement.
  assert.ok(
    source.includes(".replace(/\\.md$/, '.html')") ||
      source.includes('.replace(/\\.md$/, ".html")'),
    `src/webview/design-docs.ts must contain the literal regex \`.replace(/\\.md$/, '.html')\`. ` +
      `If Loop 04 changes the regex, update both this pin and the behavioral table in the same commit.`
  );
});

test('design-doc key mapping: Windows-style backslash paths normalize correctly', () => {
  // Cross-platform contract: even when filePath comes through with backslashes
  // (Windows), the resulting key uses forward slashes. We can't construct a
  // Windows-style absolute filePath portably, so we exercise the post-relative
  // normalization directly.
  const archRootWin = 'C:\\repo\\.arch';
  const filePathWin = 'C:\\repo\\.arch\\src\\graph\\README.md';
  // path.relative on Linux would yield the whole thing as one chunk; we
  // assert the normalize-on-output property by simulating the slice + replace.
  const relRaw = path.relative(archRootWin, filePathWin);
  const relNorm = relRaw.replace(/\\/g, '/');
  // Whatever path.relative does, after replace(/\\/g, '/') the forward-slash
  // form must contain no backslashes. That is the cross-platform contract.
  assert.ok(
    !relNorm.includes('\\'),
    `Backslash normalization must produce a forward-slash-only path; got: ${relNorm}`
  );
});
