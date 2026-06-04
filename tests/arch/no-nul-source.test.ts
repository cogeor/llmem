// tests/arch/no-nul-source.test.ts
//
// NUL-byte guard for the source + test trees.
//
// Every `*.ts` / `*.tsx` file under `src/**` and `tests/**` must be free of
// NUL bytes (0x00). A stray NUL usually means a botched encoding conversion,
// a truncated write, or a binary blob that leaked into a text file — all of
// which break editors, diffs, and the TS compiler in confusing ways.
//
// Implementation notes:
//   - Files are read as a raw Buffer (no encoding) so the check sees the
//     exact bytes on disk; `buf.includes(0)` finds the first NUL.
//   - Walk uses the same skip-dir rules as the other architecture tests
//     (node_modules, dist, .artifacts, .arch) for consistency.
//   - Unlike the import-boundary / file-size budgets, this scanner does NOT
//     skip `.test.ts` — we want to scan the test files too.
//   - Paths reported are forward-slash and relative to repo root.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOTS = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'tests')];

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
  // Only TS sources are in scope. Declaration files, emitted JS, and
  // source maps are excluded; `.test.ts` is intentionally NOT skipped.
  if (name.endsWith('.d.ts')) return true;
  if (name.endsWith('.d.ts.map')) return true;
  if (name.endsWith('.js')) return true;
  if (name.endsWith('.js.map')) return true;
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return true;
  return false;
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

function collectSources(): string[] {
  const out: string[] = [];
  for (const root of SCAN_ROOTS) {
    if (!fs.existsSync(root)) continue;
    walkSrc(root, out);
  }
  return out;
}

test('no-nul-source: no src/** or tests/** TS file contains a NUL byte (0x00)', () => {
  const sources = collectSources();
  const offenders: { rel: string; offset: number }[] = [];

  for (const file of sources) {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) {
      offenders.push({ rel: toRepoRel(file), offset: buf.indexOf(0) });
    }
  }

  if (offenders.length > 0) {
    for (const o of offenders) {
      // eslint-disable-next-line no-console
      console.error(
        `NUL-BYTE  ${o.rel}  first NUL at byte offset ${o.offset}\n  ` +
          `Re-save the file as UTF-8 (no NUL bytes); a NUL usually means a ` +
          `bad encoding conversion or a truncated/binary write leaked in.`,
      );
    }
    assert.fail(
      `${offenders.length} file(s) contain a NUL byte (0x00). ` +
        `See console.error above for each offender + the recommended fix.`,
    );
  }
});
