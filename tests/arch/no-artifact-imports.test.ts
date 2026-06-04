// tests/arch/no-artifact-imports.test.ts
//
// Guards the deletion of the deprecated `src/artifact` module (Loop 13).
//
// `src/artifact` was a legacy, fully-unused subsystem (file-based artifact
// tree + free-function storage surface) superseded by the edge-list path.
// Loop 13 deleted it. This test fails if ANY production source file under
// `src/` re-introduces an import that resolves under `src/artifact/`, and
// (belt-and-suspenders) if the directory itself reappears on disk.
//
// Implementation notes:
//   - Imports are read with the TypeScript Compiler API (no regex on raw
//     source), so `import` strings inside string literals or comments
//     cannot produce false positives. This mirrors the scanner in
//     `tests/arch/dependencies.test.ts` (walkSrc + readImportSpecifiers +
//     resolveRelativeImport).
//   - Only relative imports are resolved; bare specifiers are out of scope.
//   - Paths are forward-slash and relative to repo root.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ARTIFACT_PREFIX = 'src/artifact/';

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
  if (!fs.existsSync(root)) return out;
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
  // Bare specifiers (no leading '.' / '/'): out of scope.
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

test('no-artifact-imports: the deleted src/artifact directory does not exist', () => {
  assert.equal(
    fs.existsSync(path.join(SRC_ROOT, 'artifact')),
    false,
    'src/artifact is deleted/deprecated (Loop 13) — do not re-create it. ' +
      'The edge-list path supersedes the legacy artifact subsystem.'
  );
});

test('no-artifact-imports: no src file imports from src/artifact', () => {
  const sources = walkSrc(SRC_ROOT);
  const offenders: string[] = [];

  for (const sourceFile of sources) {
    const fromRel = toRepoRel(sourceFile);
    for (const spec of readImportSpecifiers(sourceFile)) {
      const resolved = resolveRelativeImport(sourceFile, spec);
      if (resolved === null) continue; // bare or unresolved
      const toRel = toRepoRel(resolved);
      if (toRel === 'src/artifact' || toRel.startsWith(ARTIFACT_PREFIX)) {
        offenders.push(`${fromRel}  imports  '${spec}'  -> ${toRel}`);
      }
    }
  }

  if (offenders.length > 0) {
    for (const o of offenders) {
      console.error(`ARTIFACT-IMPORT  ${o}`);
    }
    assert.fail(
      `${offenders.length} import(s) of src/artifact found. ` +
        `src/artifact is deleted/deprecated (Loop 13) — do not re-import it. ` +
        `Use the edge-list path instead. See console.error above for the offending file(s).`
    );
  }
});
