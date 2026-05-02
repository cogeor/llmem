// tests/arch/dependencies.test.ts
//
// Import-boundary safety net. Encodes the architectural rules that later loops
// must keep green and catalogues today's known violations so the rules can land
// before the violations are fixed.
//
// Rules (declaration order matters for diagnostics):
//   1. mcp -> extension                       (Loop 04 / 10 fix)
//   2. extension -> scripts                   (fixed in Loop 05)
//   3. scripts -> extension                   (Loop 04 / 05 fix)
//   4. info -> artifact (deprecated module)   (Loop 07 fix)
//   5. extension -> artifact (deprecated)     (Loop 15 fix)
//   6. claude -> extension                    (Loop 04 fix)
//   7. config-defaults -> extension           (Loop 04 fix)
//
// Implementation notes:
//   - Imports are read with the TypeScript Compiler API (no regex on raw
//     source), so `import` strings inside string literals or comments cannot
//     produce false positives.
//   - The scanner walks `src/` and resolves each relative import to a path
//     under `src/`. Bare specifiers (`vscode`, `fs`, ...) are out of scope —
//     they are the browser-purity scanner's job (browser-purity.test.ts).
//   - Paths are forward-slash and relative to repo root.
//   - `src/test/` is excluded — it contains legacy verification scripts that
//     Loop 17 (test consolidation) will delete or migrate. Including them
//     here would catalogue throwaway code.

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
  readonly reason: string;
}

const RULES: readonly BoundaryRule[] = [
  {
    id: 'mcp -> extension',
    fromPrefix: 'src/mcp/',
    toPrefix: 'src/extension/',
    reason: 'MCP layer must not depend on VS Code extension wiring.',
  },
  {
    id: 'extension -> scripts',
    fromPrefix: 'src/extension/',
    toPrefix: 'src/scripts/',
    reason: 'Extension must not pull in standalone scripts (no app/lib inversion).',
  },
  {
    id: 'scripts -> extension',
    fromPrefix: 'src/scripts/',
    toPrefix: 'src/extension/',
    reason: 'Scripts are CLI surfaces; they must not depend on extension config wiring.',
  },
  {
    id: 'info -> artifact (deprecated)',
    fromPrefix: 'src/info/',
    toPrefix: 'src/artifact/',
    reason: 'src/artifact is deprecated; info layer should use the new edge-list path.',
  },
  {
    id: 'extension -> artifact (deprecated)',
    fromPrefix: 'src/extension/',
    toPrefix: 'src/artifact/',
    reason: 'src/artifact is deprecated; extension should use the new edge-list path.',
  },
  {
    id: 'claude -> extension',
    fromPrefix: 'src/claude/',
    toPrefix: 'src/extension/',
    reason: 'Claude server must not depend on VS Code extension wiring.',
  },
  {
    id: 'config-defaults -> extension',
    fromPrefix: 'src/config-defaults.ts',
    toPrefix: 'src/extension/',
    reason: 'config-defaults is a leaf module; it must not import extension wiring.',
  },
];

// Each entry is paired with the loop that fixes it. When a loop lands its
// fix, that row must be deleted from this list — otherwise the test will
// fail with "STALE", which is the exact signal the next reviewer needs.
const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    from: 'src/mcp/tools.ts',
    to: 'src/extension/config.ts',
    reason: 'Imports getConfig runtime; Loop 10 (mcp split) drops it',
  },
  {
    from: 'src/scripts/scan_codebase.ts',
    to: 'src/extension/config.ts',
    reason: 'getConfig+loadConfig runtime; Loop 09/10 moves runtime out of extension/',
  },
  {
    from: 'src/scripts/generate_webview.ts',
    to: 'src/extension/config.ts',
    reason: 'getConfig+loadConfig runtime; Loop 09/10 moves runtime out of extension/',
  },
  {
    from: 'src/info/mcp.ts',
    to: 'src/artifact/storage.ts',
    reason: 'info -> deprecated artifact; Loop 07 (app-document-file) fixes',
  },
  {
    from: 'src/info/mcp.ts',
    to: 'src/artifact/service.ts',
    reason: 'info -> deprecated artifact; Loop 07 (app-document-file) fixes',
  },
  {
    from: 'src/extension/hot-reload.ts',
    to: 'src/artifact/service.ts',
    reason:
      'getSupportedExtensions still lives in artifact/service; Loop 15 (parser-support-truth) moves it',
  },
];

function toRepoRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipDir(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.artifacts' ||
    name === '.arch' ||
    name === 'test' // src/test/: legacy verification scripts; Loop 17 cleans up.
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

test('import-boundary scanner: every observed violation is documented in KNOWN_VIOLATIONS', () => {
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
        `BOUNDARY VIOLATION  ${key}  (rule: ${rule.id})\n  ${rule.reason}\n  ` +
          `If this is a deliberate transitional state, add it to KNOWN_VIOLATIONS in tests/arch/dependencies.test.ts ` +
          `with a "Loop NN fixes it" reason.`
      );
    }
    assert.fail(
      `New import-boundary violation(s) detected (${undocumented.length}). ` +
        `See console.error above for the rule and offending file.`
    );
  }
});

test('import-boundary scanner: every KNOWN_VIOLATIONS entry is still observed (no STALE rows)', () => {
  const { observed } = scanViolations();
  const stale: KnownViolation[] = [];

  for (const v of KNOWN_VIOLATIONS) {
    const key = `${v.from} -> ${v.to}`;
    if (!observed.has(key)) stale.push(v);
  }

  if (stale.length > 0) {
    for (const v of stale) {
      console.error(
        `STALE  ${v.from} -> ${v.to} no longer present; ` +
          `remove from KNOWN_VIOLATIONS in tests/arch/dependencies.test.ts.\n  reason was: ${v.reason}`
      );
    }
    assert.fail(`${stale.length} stale KNOWN_VIOLATIONS entry/entries detected.`);
  }
});
