// tests/arch/graph-ids.test.ts
//
// Two-part graph-ID safety net:
//
//   Part A — round-trip checks against the contract module src/core/ids.ts.
//   Loop 03 introduced the module; the previous stub helpers were deleted
//   alongside the production-site refactor.
//
//   Part B — parsing-locality scan. Walks every .ts file under src/ and
//   flags any source that uses '::' or '#' as a graph-ID separator outside
//   the contract module.
//
// Allowlist (LITERAL_USE_ALLOWLIST) lists files where '::' or '#' is used
// for something other than graph-ID parsing — e.g. Rust language syntax,
// cosmetic label-wrapping in graph layout, or the contract module itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  makeFileId,
  makeEntityId,
  parseGraphId,
  isExternalModuleId,
} from '../../src/core/ids';
import type {
  FileNode,
  ExternalModuleNode,
  ImportGraphNode,
} from '../../src/graph/types';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

test('graph-ids: makeFileId is identity on repo-relative paths', () => {
  assert.equal(makeFileId('src/foo.ts'), 'src/foo.ts');
  assert.equal(makeFileId('src/graph/edgelist.ts'), 'src/graph/edgelist.ts');
});

test('graph-ids: makeEntityId joins fileId + name with "::"', () => {
  assert.equal(makeEntityId(makeFileId('src/foo.ts'), 'bar'), 'src/foo.ts::bar');
});

test('graph-ids: parseGraphId returns file kind for plain repo paths', () => {
  assert.deepEqual(parseGraphId('src/foo.ts'), { kind: 'file', fileId: 'src/foo.ts' });
});

test('graph-ids: parseGraphId returns entity kind for "fileId::name"', () => {
  const id = makeEntityId(makeFileId('src/foo.ts'), 'bar');
  assert.deepEqual(parseGraphId(id), { kind: 'entity', fileId: 'src/foo.ts', name: 'bar' });
});

test('graph-ids: parseGraphId returns external kind for bare module names', () => {
  assert.deepEqual(parseGraphId('react'), { kind: 'external', module: 'react' });
});

test('graph-ids: ExternalModuleNode kind agrees with parseGraphId.kind for bare specifiers', () => {
  // Loop 16 contract: the runtime ImportGraphNode discriminator (kind:
  // 'external') is computed from parseGraphId. The graph-builder helper
  // and the ids contract module must stay in sync.
  const id = 'react';
  const parsed = parseGraphId(id);
  assert.equal(parsed.kind, 'external');
  // Mirror the shape `makeImportNode` in src/graph/index.ts produces.
  const node: ImportGraphNode = parsed.kind === 'external'
    ? { id, kind: 'external', label: id, module: id }
    : { id, kind: 'file', label: id, path: id, language: 'unknown' };
  assert.equal(node.kind, 'external');
  const external = node as ExternalModuleNode;
  assert.equal(external.module, 'react');
});

test('graph-ids: FileNode kind agrees with parseGraphId.kind for workspace paths', () => {
  // Symmetric to the external test above: a workspace file ID parses as
  // kind: 'file', and the runtime FileNode shape carries the same literal.
  const id = 'src/foo.ts';
  const parsed = parseGraphId(id);
  assert.equal(parsed.kind, 'file');
  // Build the node via the same branch makeImportNode uses. We don't
  // narrow on `parsed.kind === 'external'` here because parseGraphId
  // returned 'file' above and TS would narrow it away; build directly.
  const node: ImportGraphNode = { id, kind: 'file', label: id, path: id, language: 'unknown' };
  assert.equal(node.kind, 'file');
  const file = node as FileNode;
  assert.equal(file.path, 'src/foo.ts');
});

test('graph-ids: entity name with a dot survives the round-trip (split on first "::" only)', () => {
  const id = makeEntityId('src/a.ts', 'foo.bar');
  assert.deepEqual(parseGraphId(id), { kind: 'entity', fileId: 'src/a.ts', name: 'foo.bar' });
});

test('graph-ids: entity name containing "::" — current behavior is documented (undefined contract)', () => {
  // Today: parseGraphId splits on the FIRST '::'. So a name that itself
  // contains '::' will split unexpectedly. This test pins the *current*
  // behavior so Loop 03 can decide whether to escape '::' in names or
  // reject them at construction time.
  const id = makeEntityId('src/a.ts', 'foo::bar');
  // Current behavior: idx is at position 7 (end of "src/a.ts"), so name is
  // "foo::bar" — splitting on FIRST '::' actually preserves the name here.
  // What breaks is when the file portion already has '::' (it cannot today,
  // because file IDs are repo-relative paths and '::' is not legal in
  // file names). Document both shapes.
  assert.deepEqual(parseGraphId(id), { kind: 'entity', fileId: 'src/a.ts', name: 'foo::bar' });

  // Pathological: empty file portion. Pins behavior, does not endorse it.
  assert.deepEqual(parseGraphId('::orphan'), { kind: 'entity', fileId: '', name: 'orphan' });
});

// ---------------------------------------------------------------------------
// Part B — parsing-locality scan
// ---------------------------------------------------------------------------

interface GraphIdViolation {
  readonly file: string;
  readonly reason: string;
}

const KNOWN_VIOLATIONS: readonly GraphIdViolation[] = [];

// Files where '::' or '#' appears for a non-graph-ID reason — or where the
// file IS the contract module. These are NOT violations.
const LITERAL_USE_ALLOWLIST: readonly string[] = [
  'src/core/ids.ts',                              // contract module (Loop 03)
  'src/parser/rust/extractor.ts',                 // Rust path separator '::' is language syntax.
  'src/webview/ui/graph/HierarchicalLayout.ts',   // split(/[\/\\#:]/) — cosmetic label split.
  'src/webview/ui/graph/NodeRenderer.ts',         // split(/[\/\\:#]/) — cosmetic label wrapping.
];

// Detection regexes.
//   - DOUBLE_COLON: any literal '::' or "::" (single or double quote), OR
//     '::' appearing inside a template literal (e.g. ${a}::${b}). This is
//     intentionally broad so it catches both parsing AND construction —
//     today's KNOWN_VIOLATIONS includes both shapes.
//   - HASH_PARSE: literal '#' / "#" used as the argument to a string-method
//     call we expect to find in graph-ID parsers (lastIndexOf, indexOf,
//     split). We don't flag bare '#' (e.g. comment-prefix detection in
//     artifact/service.ts), only the parse-call shape.
const DOUBLE_COLON = /(?:'::'|"::"|::\$\{|\}::)/;
const HASH_PARSE = /\.(?:lastIndexOf|indexOf|split)\(\s*['"]#['"]\s*\)/;
// Concatenation pattern: startsWith(x + '::'), endsWith(... + '::'), etc.
// Already covered by DOUBLE_COLON (which matches the bare '::' literal).

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

function fileFlagsGraphIdParse(absPath: string): boolean {
  const source = fs.readFileSync(absPath, 'utf-8');
  if (DOUBLE_COLON.test(source)) return true;
  if (HASH_PARSE.test(source)) return true;
  return false;
}

function scanLocality(): Set<string> {
  const observed = new Set<string>();
  const allowed = new Set(LITERAL_USE_ALLOWLIST);
  for (const abs of walkSrc(SRC_ROOT)) {
    const rel = toRepoRel(abs);
    if (allowed.has(rel)) continue;
    if (fileFlagsGraphIdParse(abs)) observed.add(rel);
  }
  return observed;
}

test('graph-id locality: every observed parser/builder is documented in KNOWN_VIOLATIONS', () => {
  const observed = scanLocality();
  const known = new Set(KNOWN_VIOLATIONS.map((v) => v.file));

  const undocumented: string[] = [];
  for (const f of observed) {
    if (!known.has(f)) undocumented.push(f);
  }

  if (undocumented.length > 0) {
    for (const f of undocumented) {
      console.error(
        `GRAPH-ID-PARSE  ${f} uses '::' or '#' outside the contract module.\n  ` +
          `Graph-ID construction and parsing live in (future) src/core/ids.ts. ` +
          `If this file genuinely needs the literal for a non-graph-ID reason ` +
          `(e.g. Rust syntax, cosmetic label split), add it to LITERAL_USE_ALLOWLIST ` +
          `in tests/arch/graph-ids.test.ts. Otherwise replace with makeEntityId / parseGraphId.`
      );
    }
    assert.fail(
      `New graph-ID parser/builder(s) detected (${undocumented.length}). ` +
        `See console.error above for the offending file.`
    );
  }
});

test('graph-id locality: every KNOWN_VIOLATIONS entry is still observed (no STALE rows)', () => {
  const observed = scanLocality();
  const stale: GraphIdViolation[] = [];

  for (const v of KNOWN_VIOLATIONS) {
    if (!observed.has(v.file)) stale.push(v);
  }

  if (stale.length > 0) {
    for (const v of stale) {
      console.error(
        `STALE  ${v.file} no longer uses '::'/'#'; ` +
          `remove from KNOWN_VIOLATIONS in tests/arch/graph-ids.test.ts.\n  reason was: ${v.reason}`
      );
    }
    assert.fail(`${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`);
  }
});
