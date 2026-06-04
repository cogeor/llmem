// tests/arch/layer-matrix.test.ts
//
// Broad layer-matrix import-boundary safety net. Encodes the TARGET layering
// the codebase is migrating toward (the "quality-refactor" arc) and catalogues
// today's known violations behind a PHASE-TAGGED allowlist so the rules can
// land before each violation is burned down.
//
// This file is intentionally SEPARATE from dependencies.test.ts:
//   - dependencies.test.ts gates a small set of already-clean boundaries
//     (mcp/extension/scripts/claude/config-defaults/artifact).
//   - layer-matrix.test.ts gates the broader application/graph/parser/info
//     matrix that still has open violations to retire.
//
// Layer matrix (fromPrefix !-> toPrefix):
//   - src/application/ must NOT import webview/extension/mcp/http-server/cli/scripts
//   - src/graph/       must NOT import parser
//   - src/parser/      must NOT import application/graph/webview/mcp/http-server/cli/extension
//   - src/info/        must NOT import application
//
// src/cli/ and src/http-server/ are top-level platform/presentation surfaces
// (peers of src/mcp and src/extension). They MAY import inward layers
// (application, graph, parser, ...) but inward layers must NOT import them —
// the same boundary the CLI and HTTP server had before J1/J2 hoisted them to
// their new top-level paths (J1 for cli, J2 for http-server).
//
// Implementation notes (mirrors dependencies.test.ts):
//   - Imports are read with the TypeScript Compiler API (no regex on raw
//     source), including dynamic `import()` calls — info/cli.ts reaches into
//     application via `await import('../application/document-file')`.
//   - The scanner walks `src/` and resolves each relative import to a path
//     under `src/`. Bare specifiers (`vscode`, `fs`, ...) are out of scope.
//   - Paths are forward-slash and relative to repo root.
//
// Each KNOWN_VIOLATIONS row carries a `phase` tag (the loop id that retires it)
// and a reason. The two tests below enforce (a) every observed violation is
// documented and (b) no allowlist row is stale.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

interface BoundaryRule {
  readonly id: string;
  readonly fromPrefix: string;
  readonly toPrefix: string;
  readonly reason: string;
}

interface KnownViolation {
  readonly from: string;
  readonly to: string;
  readonly phase: string;
  readonly reason: string;
}

const RULES: readonly BoundaryRule[] = [
  // src/application/ must not depend on outer surfaces.
  {
    id: 'application -> webview',
    fromPrefix: 'src/application/',
    toPrefix: 'src/webview/',
    reason: 'Application core must not depend on the webview surface.',
  },
  {
    id: 'application -> extension',
    fromPrefix: 'src/application/',
    toPrefix: 'src/extension/',
    reason: 'Application core must not depend on VS Code extension wiring.',
  },
  {
    id: 'application -> mcp',
    fromPrefix: 'src/application/',
    toPrefix: 'src/mcp/',
    reason: 'Application core must not depend on the MCP surface.',
  },
  {
    id: 'application -> http-server',
    fromPrefix: 'src/application/',
    toPrefix: 'src/http-server/',
    reason: 'Application core must not depend on the HTTP webview server surface (top-level platform surface since J2).',
  },
  {
    id: 'application -> cli',
    fromPrefix: 'src/application/',
    toPrefix: 'src/cli/',
    reason: 'Application core must not depend on the CLI surface (top-level platform surface since J1).',
  },
  {
    id: 'application -> scripts',
    fromPrefix: 'src/application/',
    toPrefix: 'src/scripts/',
    reason: 'Application core must not depend on standalone CLI scripts.',
  },
  {
    id: 'application -> viewer-generator',
    fromPrefix: 'src/application/',
    toPrefix: 'src/viewer-generator/',
    reason: 'Application core must not depend on the viewer/static-graph generator surface (a presentation-side use-case consumed BY cli/http-server; formerly the web launcher).',
  },
  // src/graph/ must not depend on the parser layer.
  {
    id: 'graph -> parser',
    fromPrefix: 'src/graph/',
    toPrefix: 'src/parser/',
    reason: 'Graph layer must not depend on the parser layer.',
  },
  {
    id: 'graph -> viewer-generator',
    fromPrefix: 'src/graph/',
    toPrefix: 'src/viewer-generator/',
    reason: 'Graph layer must not depend on the viewer/static-graph generator surface (formerly the web launcher); the generator depends on graph, not vice versa.',
  },
  // src/parser/ must not depend on anything above it.
  {
    id: 'parser -> application',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/application/',
    reason: 'Parser layer must not depend on the application core.',
  },
  {
    id: 'parser -> graph',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/graph/',
    reason: 'Parser layer must not depend on the graph layer.',
  },
  {
    id: 'parser -> webview',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/webview/',
    reason: 'Parser layer must not depend on the webview surface.',
  },
  {
    id: 'parser -> mcp',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/mcp/',
    reason: 'Parser layer must not depend on the MCP surface.',
  },
  {
    id: 'parser -> http-server',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/http-server/',
    reason: 'Parser layer must not depend on the HTTP webview server surface (top-level platform surface since J2).',
  },
  {
    id: 'parser -> cli',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/cli/',
    reason: 'Parser layer must not depend on the CLI surface (top-level platform surface since J1).',
  },
  {
    id: 'parser -> extension',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/extension/',
    reason: 'Parser layer must not depend on VS Code extension wiring.',
  },
  {
    id: 'parser -> viewer-generator',
    fromPrefix: 'src/parser/',
    toPrefix: 'src/viewer-generator/',
    reason: 'Parser layer must not depend on the viewer/static-graph generator surface (formerly the web launcher).',
  },
  // src/info/ must not depend on the application core.
  {
    id: 'info -> application',
    fromPrefix: 'src/info/',
    toPrefix: 'src/application/',
    reason: 'Info layer must not depend on the application core.',
  },
];

// Phase-tagged allowlist of CURRENT violations, derived empirically from the
// scanner (see IMPLEMENTATION.md log). Each row's `phase` is the loop id that
// retires it. The stale-row test below guarantees rows are removed once fixed.
const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  // Phase 12 retired: graph/index no longer imports parser/config (it reads the
  // persisted node.callGraph capability), and the parser→graph bridge moved to
  // src/application/artifact-converter.ts (application may import both layers).
];

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
      if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
        specs.push(ref.expression.text);
      }
    } else if (ts.isCallExpression(node)) {
      // dynamic import(): SyntaxKind.ImportKeyword as expression
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
  // Bare specifiers (no leading '.' / '/'): out of scope for boundary scanner.
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;

  const importerDir = path.dirname(importerFile);
  const baseResolved = path.resolve(importerDir, specifier);

  // Try the candidates TS would: exact, .ts, .tsx, /index.ts, /index.tsx.
  const candidates = [
    baseResolved,
    `${baseResolved}.ts`,
    `${baseResolved}.tsx`,
    path.join(baseResolved, 'index.ts'),
    path.join(baseResolved, 'index.tsx'),
  ];

  for (const c of candidates) {
    try {
      const stat = fs.statSync(c);
      if (stat.isFile()) return c;
    } catch {
      // continue
    }
  }
  return null;
}

function scanViolations(): { observed: Set<string>; details: Map<string, BoundaryRule> } {
  const sources = walkSrc(SRC_ROOT);
  const observed = new Set<string>();
  const details = new Map<string, BoundaryRule>();

  for (const sourceFile of sources) {
    const fromRel = toRepoRel(sourceFile);
    const specs = readImportSpecifiers(sourceFile);

    for (const spec of specs) {
      const resolved = resolveRelativeImport(sourceFile, spec);
      if (resolved === null) continue; // bare or unresolved
      const toRel = toRepoRel(resolved);
      if (!toRel.startsWith('src/')) continue;

      for (const rule of RULES) {
        const matchesFrom =
          rule.fromPrefix.endsWith('/')
            ? fromRel.startsWith(rule.fromPrefix)
            : fromRel === rule.fromPrefix;
        const matchesTo = toRel.startsWith(rule.toPrefix);
        if (matchesFrom && matchesTo) {
          const key = `${fromRel} -> ${toRel}`;
          observed.add(key);
          if (!details.has(key)) details.set(key, rule);
          break; // first matching rule wins (declaration order)
        }
      }
    }
  }

  return { observed, details };
}

test('layer-matrix scanner: every observed violation is documented in KNOWN_VIOLATIONS', () => {
  const { observed, details } = scanViolations();
  const known = new Set(KNOWN_VIOLATIONS.map((v) => `${v.from} -> ${v.to}`));

  const undocumented: string[] = [];
  for (const key of observed) {
    if (!known.has(key)) undocumented.push(key);
  }

  if (undocumented.length > 0) {
    for (const key of undocumented) {
      const rule = details.get(key)!;
      console.error(
        `LAYER-MATRIX VIOLATION  ${key}  (rule: ${rule.id})\n  ${rule.reason}\n  ` +
          `If this is a deliberate transitional state, add it to KNOWN_VIOLATIONS in ` +
          `tests/arch/layer-matrix.test.ts with a phase tag and reason.`
      );
    }
    assert.fail(
      `New layer-matrix violation(s) detected (${undocumented.length}). ` +
        `See console.error above for the rule and offending file.`
    );
  }
});

test('layer-matrix scanner: every KNOWN_VIOLATIONS entry is still observed (no STALE rows)', () => {
  const { observed } = scanViolations();
  const stale: KnownViolation[] = [];

  for (const v of KNOWN_VIOLATIONS) {
    const key = `${v.from} -> ${v.to}`;
    if (!observed.has(key)) stale.push(v);
  }

  if (stale.length > 0) {
    for (const v of stale) {
      console.error(
        `STALE  ${v.from} -> ${v.to} no longer present (phase ${v.phase}); ` +
          `remove from KNOWN_VIOLATIONS in tests/arch/layer-matrix.test.ts.\n  reason was: ${v.reason}`
      );
    }
    assert.fail(`${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`);
  }
});
