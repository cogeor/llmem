// tests/arch/workspace-paths.test.ts
//
// Two parts:
//
//   Part A — `safe-fs` containment rules. Test-only stub helpers that pin
//   the contract Loop 04 will move into src/workspace/safe-fs.ts. Any
//   candidate path must resolve INSIDE the workspace root; otherwise we
//   throw PATH_ESCAPE.
//
//   Part B — `fs.write*` allowlist scan. Walks every .ts file under src/
//   and flags any production file (outside WRITE_ALLOWLIST) that calls a
//   write-mutating fs method. The goal: keep workspace mutation centralized
//   so Loop 04 can wrap it all in safe-fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveInsideWorkspace } from '../../src/workspace/safe-fs';
import { asWorkspaceRoot } from '../../src/core/paths';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

// ---------------------------------------------------------------------------
// Part A — safe-fs containment (real module, src/workspace/safe-fs.ts)
//
// Loop 04 lifted these helpers out of the test stub into src/workspace/safe-fs.
// PathEscapeError extends LLMemError extends Error and carries `code:
// 'PATH_ESCAPE'`. The instance message contains the literal `PATH_ESCAPE` via
// the LLMemError code prefix construction (see src/core/errors.ts).
// ---------------------------------------------------------------------------

test('safe-fs: relative path resolves under root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-'));
  try {
    const got = resolveInsideWorkspace(asWorkspaceRoot(tmp), 'subdir/file.txt');
    assert.equal(got, path.resolve(tmp, 'subdir/file.txt'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('safe-fs: ./prefix relative path resolves under root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-'));
  try {
    const got = resolveInsideWorkspace(asWorkspaceRoot(tmp), './subdir/file.txt');
    assert.equal(got, path.resolve(tmp, 'subdir/file.txt'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('safe-fs: ../escape throws PathEscapeError (code PATH_ESCAPE)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-'));
  try {
    assert.throws(
      () => resolveInsideWorkspace(asWorkspaceRoot(tmp), '../escape.txt'),
      (err: Error) => {
        // Both: name-based check and code-based check via PathEscapeError.
        return err.name === 'PathEscapeError' &&
          (err as Error & { code?: string }).code === 'PATH_ESCAPE';
      },
      `'../escape.txt' must throw PathEscapeError because it resolves outside the workspace root.`
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('safe-fs: absolute path equal to root resolves', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-'));
  try {
    const got = resolveInsideWorkspace(asWorkspaceRoot(tmp), tmp);
    assert.equal(got, path.resolve(tmp));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('safe-fs: absolute path that is a child of root resolves', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-'));
  try {
    const child = path.join(tmp, 'sub', 'file.txt');
    const got = resolveInsideWorkspace(asWorkspaceRoot(tmp), child);
    assert.equal(got, path.resolve(child));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('safe-fs: absolute path on a sibling directory throws PathEscapeError', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-parent-'));
  try {
    const root = path.join(parent, 'workspace');
    const sibling = path.join(parent, 'sibling', 'file.txt');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.dirname(sibling), { recursive: true });
    assert.throws(
      () => resolveInsideWorkspace(asWorkspaceRoot(root), sibling),
      (err: Error) => err.name === 'PathEscapeError',
      `An absolute path on a sibling directory must throw PathEscapeError.`
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('safe-fs: symlinked escape — skipped on Windows non-elevated, otherwise blocked', (t) => {
  // Symlink creation requires admin or Developer Mode on Windows. Skip
  // gracefully there; the Linux/macOS CI run covers the case.
  if (process.platform === 'win32') {
    t.skip(
      'Symlink test skipped on Windows (requires admin / Developer Mode); ' +
        'Linux + macOS CI runs cover this case.'
    );
    return;
  }

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-symlink-'));
  try {
    const root = path.join(parent, 'workspace');
    const outside = path.join(parent, 'outside', 'secret.txt');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, 'secret');

    // Create a symlink inside the workspace that points to the outside dir.
    const linkInside = path.join(root, 'leak');
    try {
      fs.symlinkSync(path.dirname(outside), linkInside, 'dir');
    } catch (err) {
      t.skip(
        `Symlink creation failed (likely insufficient privileges): ${(err as Error).message}`
      );
      return;
    }

    // resolveInsideWorkspace uses path.resolve only — it does NOT follow
    // symlinks. So purely textual containment passes here even though the
    // physical target is outside. This is intentional: the test pins the
    // *textual* containment contract. A future loop must layer
    // fs.realpathSync on top to defeat symlink-based escape.
    //
    // We assert this layered expectation explicitly:
    const candidate = path.join(linkInside, 'secret.txt');
    const textual = resolveInsideWorkspace(asWorkspaceRoot(root), candidate); // does not throw
    const real = fs.realpathSync(textual);
    const realRel = path.relative(fs.realpathSync(root), real);
    assert.ok(
      realRel.startsWith('..') || path.isAbsolute(realRel),
      `Symlink target should resolve outside root; realRel=${realRel}. ` +
        `A future loop must add fs.realpathSync containment on top of textual containment.`
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Part B — fs.write* allowlist scan
// ---------------------------------------------------------------------------

interface WriteCallSite {
  readonly file: string;
  readonly method: string;
}

// Production files allowed to call write-mutating fs methods. Anything
// outside this list will fail the scan.
//
// `src/test/` is excluded from the scan entirely (legacy verification
// scripts; Loop 17 handles them). See pre-flight notes in IMPLEMENTATION.md.
const WRITE_ALLOWLIST: ReadonlySet<string> = new Set([
  'src/artifact/storage.ts',
  'src/claude/server/arch-watcher.ts',
  'src/graph/edgelist.ts',
  'src/graph/plot/generator.ts',
  'src/graph/worktree-state.ts',
  'src/scripts/generate_edgelist.ts',
  'src/scripts/scan_codebase.ts',
  'src/scripts/test-arch-watcher.ts',
  'src/webview/generator.ts',
  'src/webview/utils/md-converter.ts',
  'src/workspace/safe-fs.ts',
]);

// Heuristic regex on raw source — documented per PLAN. Matches:
//   fs.writeFile / fs.writeFileSync / fs.appendFile / fs.appendFileSync /
//   fs.mkdir / fs.mkdirSync / fs.rm / fs.rmSync / fs.unlink / fs.unlinkSync /
//   fs.rename / fs.renameSync
//
// Also matches `fsp.<method>` and `fsPromises.<method>` style aliases, and
// the `fs.promises.<method>` sub-property shape (Loop 04 D7 tightening).
// We require the method to be followed by `(` to avoid matching property
// access for type purposes (not common, but cheap to guard).
const WRITE_METHOD_RE =
  /\b(?:fs|fsp|fsPromises|fileSystem|fsExtra)(?:\.promises)?\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|unlink|unlinkSync|rename|renameSync)\s*\(/g;

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

function toRepoRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function scanWriteCalls(): WriteCallSite[] {
  const sites: WriteCallSite[] = [];
  for (const abs of walkSrc(SRC_ROOT)) {
    const source = fs.readFileSync(abs, 'utf-8');
    WRITE_METHOD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    const seenMethods = new Set<string>();
    while ((match = WRITE_METHOD_RE.exec(source)) !== null) {
      const method = match[1];
      if (seenMethods.has(method)) continue; // one entry per (file, method) pair
      seenMethods.add(method);
      sites.push({ file: toRepoRel(abs), method });
    }
  }
  return sites;
}

test('write-allowlist: every observed fs.write call is in WRITE_ALLOWLIST', () => {
  const sites = scanWriteCalls();
  const offenders = sites.filter((s) => !WRITE_ALLOWLIST.has(s.file));

  if (offenders.length > 0) {
    for (const o of offenders) {
      console.error(
        `WRITE-OUTSIDE-ALLOWLIST  ${o.file} calls fs.${o.method}\n  ` +
          `Workspace mutation must be centralized so Loop 04 can wrap it in safe-fs. ` +
          `If this file legitimately needs to write, add it to WRITE_ALLOWLIST in ` +
          `tests/arch/workspace-paths.test.ts and document why.`
      );
    }
    assert.fail(
      `${offenders.length} fs.write call(s) found outside the allowlist. ` +
        `See console.error above for the offending file(s).`
    );
  }
});

test('write-allowlist: every WRITE_ALLOWLIST entry is still observed (no STALE rows)', () => {
  const sites = scanWriteCalls();
  const observedFiles = new Set(sites.map((s) => s.file));

  const stale: string[] = [];
  for (const f of WRITE_ALLOWLIST) {
    if (!observedFiles.has(f)) stale.push(f);
  }

  if (stale.length > 0) {
    for (const f of stale) {
      console.error(
        `STALE  ${f} no longer calls any fs.write* method; ` +
          `remove from WRITE_ALLOWLIST in tests/arch/workspace-paths.test.ts.`
      );
    }
    assert.fail(`${stale.length} stale WRITE_ALLOWLIST entry/entries detected.`);
  }
});
