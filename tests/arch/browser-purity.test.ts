// tests/arch/browser-purity.test.ts
//
// Browser-purity safety net for `src/webview/ui/**`. Anything that runs in
// the webview iframe must not directly import Node-only or extension-only
// modules. We do not chase transitive imports — only the direct edge — but
// every direct edge is asserted against an explicit allowlist.
//
// Forbidden bare specifiers:
//   - Exactly: fs, path, os, crypto, stream, net, http, https, child_process,
//     worker_threads, vscode, ws, chokidar
//   - Anything matching /^node:/  (e.g. node:fs)
//   - Anything matching /^tree-sitter/
//   - Anything matching /^fs-extra/
//   - First segment === '@modelcontextprotocol'
//
// Forbidden relative resolutions (resolve target relative to importer; check
// it does not land inside any of these directories):
//   - src/parser/, src/mcp/, src/extension/, src/claude/, src/scripts/,
//     src/artifact/, src/info/, src/graph/
//
// Allowed: other paths under src/webview/ui/ and other src/webview/* paths
// that don't pull node deps. We don't follow transitive imports.
//
// Today's known violations live in MCP_FORBIDDEN_KNOWN_VIOLATIONS. Adding
// any new browser-impure import will fail this test until the violation is
// added to the list with a "Loop NN fixes it" reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBVIEW_UI_ROOT = path.join(REPO_ROOT, 'src', 'webview', 'ui');

interface BrowserViolation {
  readonly from: string;
  // For bare-specifier violations, `to` is the bare specifier itself (e.g. 'fs',
  // 'node:path'). For relative violations, `to` is the resolved repo-relative
  // file path (e.g. 'src/parser/config.ts').
  readonly to: string;
  readonly reason: string;
}

const FORBIDDEN_BARE_EXACT: readonly string[] = [
  'fs',
  'path',
  'os',
  'crypto',
  'stream',
  'net',
  'http',
  'https',
  'child_process',
  'worker_threads',
  'vscode',
  'ws',
  'chokidar',
];

const FORBIDDEN_RELATIVE_PREFIXES: readonly string[] = [
  'src/parser/',
  'src/mcp/',
  'src/extension/',
  'src/claude/',
  'src/scripts/',
  'src/artifact/',
  'src/info/',
  'src/graph/',
];

const KNOWN_VIOLATIONS: readonly BrowserViolation[] = [
  // Loop 12 cleared the Worktree.ts -> parser/config violation: the
  // parsability bit (`isSupported`) is now precomputed server-side in
  // `src/webview/worktree.ts::generateWorkTree` and travels with each file
  // node in the worktree JSON. Browser code reads `node.isSupported` and
  // never imports parser/config.

  // Loop 13: webview UI now consumes the loop-08 folder-artifact types
  // (`FolderTreeData`, `FolderEdgelistData`) for the upcoming PackageView
  // (loops 14-16). All imports below are TYPE-ONLY (`import type`) so
  // esbuild elides them from the browser bundle — the runtime contract is
  // a manual `schemaVersion` equality check inside `staticDataProvider.ts`
  // because runtime-importing the schemas would pull node-only `path`
  // (used inside `folder-tree.ts::folderOf` / `folder-edges.ts::folderOf`)
  // into the browser bundle. A future loop that splits the schema-only
  // surface out of `folder-tree.ts` / `folder-edges.ts` (so the schemas
  // don't co-live with the node-using builders) lets the static provider
  // upgrade from manual gate to `Schema.parse` and clears these rows.
  {
    from: 'src/webview/ui/services/dataProvider.ts',
    to: 'src/graph/folder-tree.ts',
    reason: 'Loop 13: type-only import of FolderTreeData for the DataProvider interface; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/services/dataProvider.ts',
    to: 'src/graph/folder-edges.ts',
    reason: 'Loop 13: type-only import of FolderEdgelistData for the DataProvider interface; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/services/staticDataProvider.ts',
    to: 'src/graph/folder-tree.ts',
    reason: 'Loop 13: type-only import of FolderTreeData (the runtime gate is a manual schemaVersion check); future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/services/staticDataProvider.ts',
    to: 'src/graph/folder-edges.ts',
    reason: 'Loop 13: type-only import of FolderEdgelistData (the runtime gate is a manual schemaVersion check); future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/services/vscodeDataProvider.ts',
    to: 'src/graph/folder-tree.ts',
    reason: 'Loop 13: type-only import of FolderTreeData for the postMessage stub; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/services/vscodeDataProvider.ts',
    to: 'src/graph/folder-edges.ts',
    reason: 'Loop 13: type-only import of FolderEdgelistData for the postMessage stub; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/types.ts',
    to: 'src/graph/folder-tree.ts',
    reason: 'Loop 13: type-only import of FolderTreeData for the Window.FOLDER_TREE augmentation; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/types.ts',
    to: 'src/graph/folder-edges.ts',
    reason: 'Loop 13: type-only import of FolderEdgelistData for the Window.FOLDER_EDGES augmentation; future schema-split loop fixes it.',
  },
  {
    from: 'src/webview/ui/components/PackageView.ts',
    to: 'src/graph/folder-tree.ts',
    reason: 'Loop 14: type-only import of FolderTreeData / FolderNode for the PackageView component (cards rendered from the loaded tree); future schema-split loop fixes it.',
  },
];

function toRepoRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return true;
  if (name.endsWith('.test.ts')) return true;
  return !name.endsWith('.ts');
}

function walkUi(root: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkUi(full, out);
    } else if (entry.isFile() && !shouldSkipFile(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function readImportSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const m = (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
      if (m && ts.isStringLiteral(m)) specs.push(m.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (
        ts.isExternalModuleReference(ref) &&
        ref.expression &&
        ts.isStringLiteral(ref.expression)
      ) {
        specs.push(ref.expression.text);
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length >= 1) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) specs.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return specs;
}

function resolveRelativeImport(importerFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const importerDir = path.dirname(importerFile);
  const baseResolved = path.resolve(importerDir, specifier);
  const candidates = [
    baseResolved,
    `${baseResolved}.ts`,
    `${baseResolved}.tsx`,
    path.join(baseResolved, 'index.ts'),
    path.join(baseResolved, 'index.tsx'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // continue
    }
  }
  return null;
}

function isForbiddenBare(spec: string): boolean {
  if (FORBIDDEN_BARE_EXACT.includes(spec)) return true;
  if (/^node:/.test(spec)) return true;
  if (/^tree-sitter/.test(spec)) return true;
  if (/^fs-extra/.test(spec)) return true;
  if (spec.split('/')[0] === '@modelcontextprotocol') return true;
  return false;
}

interface ObservedKey {
  readonly from: string;
  readonly to: string;
}

function scanWebviewUi(): ObservedKey[] {
  const observed: ObservedKey[] = [];
  if (!fs.existsSync(WEBVIEW_UI_ROOT)) return observed;

  const files = walkUi(WEBVIEW_UI_ROOT);
  for (const sourceFile of files) {
    const fromRel = toRepoRel(sourceFile);
    const specs = readImportSpecifiers(sourceFile);

    for (const spec of specs) {
      // Bare specifier?
      const isRelative = spec.startsWith('.') || spec.startsWith('/');
      if (!isRelative) {
        if (isForbiddenBare(spec)) {
          observed.push({ from: fromRel, to: spec });
        }
        continue;
      }

      const resolved = resolveRelativeImport(sourceFile, spec);
      if (resolved === null) continue;
      const toRel = toRepoRel(resolved);
      for (const prefix of FORBIDDEN_RELATIVE_PREFIXES) {
        if (toRel.startsWith(prefix)) {
          observed.push({ from: fromRel, to: toRel });
          break;
        }
      }
    }
  }
  return observed;
}

test('browser purity: every observed import into Node/extension territory is documented', () => {
  const observed = scanWebviewUi();
  const known = new Set(KNOWN_VIOLATIONS.map((v) => `${v.from}::${v.to}`));

  const undocumented: ObservedKey[] = [];
  for (const o of observed) {
    if (!known.has(`${o.from}::${o.to}`)) undocumented.push(o);
  }

  if (undocumented.length > 0) {
    for (const o of undocumented) {
      const isBare = !o.to.includes('/');
      const arrow = isBare
        ? `imports forbidden bare specifier '${o.to}'`
        : `imports forbidden ${o.to}`;
      console.error(
        `BROWSER-IMPURE  ${o.from} ${arrow}\n  ` +
          `Webview UI must be browser-safe. If this is a transitional state, add it to ` +
          `KNOWN_VIOLATIONS in tests/arch/browser-purity.test.ts with a "Loop NN fixes it" reason.`
      );
    }
    assert.fail(
      `New browser-impure import(s) detected (${undocumented.length}). ` +
        `See console.error above for the offending file.`
    );
  }
});

test('browser purity: every KNOWN_VIOLATIONS entry is still observed (no STALE rows)', () => {
  const observed = scanWebviewUi();
  const observedKeys = new Set(observed.map((o) => `${o.from}::${o.to}`));

  const stale: BrowserViolation[] = [];
  for (const v of KNOWN_VIOLATIONS) {
    if (!observedKeys.has(`${v.from}::${v.to}`)) stale.push(v);
  }

  if (stale.length > 0) {
    for (const v of stale) {
      console.error(
        `STALE  ${v.from} no longer imports ${v.to}; ` +
          `remove from KNOWN_VIOLATIONS in tests/arch/browser-purity.test.ts.\n  reason was: ${v.reason}`
      );
    }
    assert.fail(`${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`);
  }
});
