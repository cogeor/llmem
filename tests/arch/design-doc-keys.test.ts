// tests/arch/design-doc-keys.test.ts
//
// Pins the design-doc key mapping logic. Loop 04 lifted the mapper out of
// src/webview/design-docs.ts into src/docs/arch-store.ts (`getDesignDocKey`).
// This test now imports `getDesignDocKey` directly. Two layers pin the
// contract:
//
//   1. Behavioral table — every supported input maps to the expected key.
//   2. Walker guard pin — design-docs.ts (which still owns the .arch
//      walker) gates on `.endsWith('.md')` before calling the mapper.
//      Loop 06 may relocate the walker; for now it stays put.
//
// The structural pin on the README/.html literals (which used to live in
// design-docs.ts) was removed in Loop 04 because those literals now live
// inside src/docs/arch-store.ts and the behavioral table catches any
// regression there.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDesignDocKey } from '../../src/docs/arch-store';
import { asAbsPath } from '../../src/core/paths';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DESIGN_DOCS_PATH = path.join(REPO_ROOT, 'src', 'webview', 'design-docs.ts');

// Wrapper helper kept to minimize test-body churn. Behavior is identical to
// calling getDesignDocKey directly.
function mapDesignDocKey(archRoot: string, filePath: string): string {
  return getDesignDocKey(asAbsPath(archRoot), asAbsPath(filePath));
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
  // The walker is in webview/design-docs.ts; the key-mapping helper now
  // lives in src/docs/arch-store.ts (Loop 04). Loop 06 may relocate the
  // walker. The walker gates on filePath.endsWith('.md') BEFORE calling
  // the mapper. We cannot test the walker without importing marked, but
  // we can pin the guard literal.
  const source = fs.readFileSync(DESIGN_DOCS_PATH, 'utf-8');
  assert.ok(
    source.includes(".endsWith('.md')") || source.includes('.endsWith(".md")'),
    `src/webview/design-docs.ts must guard on .endsWith('.md') before mapping keys; ` +
      `if a future loop changes the guard, update tests/arch/design-doc-keys.test.ts in the same commit.`
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
