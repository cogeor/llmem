// tests/arch/install-namespace.test.ts
//
// Loop 15 (quality-refactor) — install-namespace host-agnostic guard.
//
// `src/install/` holds the MCP-registration adapters for Claude Code,
// Claude Desktop, AND Codex. They write/merge per-client config files and
// MUST stay host-agnostic: an install adapter must not reach into the
// MCP stdio server, the HTTP webview server, or the VS Code extension
// host (`vscode`). Wiring any of those edges in would couple the
// (host-neutral) install surface to one particular runtime.
//
// This test scans every `.ts` file under `src/install/` with the
// TypeScript Compiler API (same approach as `dependencies.test.ts`, so
// `import` strings inside comments/string-literals cannot trip a false
// positive) and asserts none of them import a forbidden target:
//   - `src/http-server`    (relative)            — the HTTP webview server
//     (hoisted to top-level in J2)
//   - `src/mcp/server`     (relative)            — the MCP stdio server
//   - `vscode`             (bare specifier)      — the VS Code extension host
//
// Relative imports are resolved to a path under `src/`; the bare `vscode`
// specifier is matched directly (it never resolves to a `src/` file).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALL_ROOT = path.join(REPO_ROOT, 'src', 'install');

// Forbidden relative targets (matched against the resolved repo-relative
// path of a relative import). Prefixes so `.../server.ts` and
// `.../server/index.ts` both match.
const FORBIDDEN_REL_PREFIXES: readonly string[] = [
  'src/http-server',
  'src/mcp/server',
];

// Forbidden bare specifiers (matched against the raw module specifier).
const FORBIDDEN_BARE: readonly string[] = ['vscode'];

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

function walkDir(root: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walkDir(full, out);
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
  // Unresolved relative import: fall back to the (extension-less) base so a
  // forbidden-prefix match still fires even if the target file is absent.
  return baseResolved;
}

interface Violation {
  readonly from: string;
  readonly specifier: string;
  readonly target: string;
}

function scan(): Violation[] {
  const sources = walkDir(INSTALL_ROOT);
  const violations: Violation[] = [];

  for (const sourceFile of sources) {
    const fromRel = toRepoRel(sourceFile);
    for (const spec of readImportSpecifiers(sourceFile)) {
      // Bare-specifier check (e.g. `vscode`).
      if (!spec.startsWith('.') && !spec.startsWith('/')) {
        if (FORBIDDEN_BARE.includes(spec)) {
          violations.push({ from: fromRel, specifier: spec, target: spec });
        }
        continue;
      }
      // Relative-import check against forbidden src/ prefixes.
      const resolved = resolveRelativeImport(sourceFile, spec);
      if (resolved === null) continue;
      const toRel = toRepoRel(resolved);
      for (const prefix of FORBIDDEN_REL_PREFIXES) {
        if (toRel.startsWith(prefix)) {
          violations.push({ from: fromRel, specifier: spec, target: toRel });
          break;
        }
      }
    }
  }

  return violations;
}

test('install-namespace: no src/install file imports the MCP/HTTP server or vscode', () => {
  const violations = scan();

  if (violations.length > 0) {
    for (const v of violations) {
      // eslint-disable-next-line no-console
      console.error(
        `INSTALL-NAMESPACE VIOLATION  ${v.from} imports "${v.specifier}" (→ ${v.target})\n  ` +
          `Install adapters must stay host-agnostic: ` +
          `no src/mcp/server, no src/http-server, and no vscode edges.`,
      );
    }
    assert.fail(
      `${violations.length} install-namespace violation(s) detected. ` +
        `See console.error above for each offending import.`,
    );
  }
});
