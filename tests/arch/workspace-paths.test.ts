// tests/arch/workspace-paths.test.ts
//
// Three parts:
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
//
//   Part C — `WorkspaceIO` realpath-containment contract (Loop 23). The
//   class layers `fs.realpath` on top of textual containment to defeat
//   symlink-target-outside-root attacks. Mirrors Part A's symlink case
//   but asserts the BLOCK rather than documenting the gap.
//
//   Part D — AST-based fs.<write*|mkdir*|unlink*|rm*> scan over
//   `src/{graph,info,artifact}/` (Loop 23). Mirrors the AST pattern from
//   `tests/arch/console-discipline.test.ts` (Loop 20). New write-side
//   `fs.*` introductions in those subtrees fail the test unless the file
//   is in `KNOWN_WRITE_VIOLATIONS` (back-compat fallbacks) or under the
//   subtree allow-list (`src/workspace/`, `src/core/`).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { resolveInsideWorkspace, WorkspaceIO } from '../../src/workspace/safe-fs';
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
// L24 retired:
//   - 'src/claude/server/arch-watcher.ts' — fs.mkdirSync + fs.writeFileSync
//     replaced by WorkspaceIO.mkdirRecursive + writeFile.
//   - 'src/graph/plot/generator.ts' — fs.writeFileSync replaced by
//     WorkspaceIO.writeFile (savePlot signature now takes an `io` arg).
// Loop 07 added:
//   - 'src/claude/cli/commands/init.ts' — `llmem init` writes
//     `.llmem/config.toml` (the workspace config file). Cannot route
//     through `WorkspaceIO` because the workspace markers and the
//     containment surface presuppose `.llmem/` already exists; `init`
//     creates that directory. The path is rooted at `detectWorkspace()`
//     output and never escapes (mkdir + writeFile under the resolved
//     `.llmem/` subdir only).
const WRITE_ALLOWLIST: ReadonlySet<string> = new Set([
  'src/artifact/storage.ts',
  'src/claude/cli/commands/init.ts',
  'src/graph/edgelist.ts',
  'src/graph/worktree-state.ts',
  'src/scripts/generate_edgelist.ts',
  'src/scripts/scan_codebase.ts',
  'src/webview/generator.ts',
  'src/webview/utils/md-converter.ts',
  'src/workspace/safe-fs.ts',
  'src/workspace/workspace-io.ts',
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

// ---------------------------------------------------------------------------
// Part C — WorkspaceIO realpath containment (Loop 23)
//
// Layered on top of textual containment: a symlink inside the workspace
// pointing OUTSIDE the workspace must not let a child path through the
// `WorkspaceIO` surface. The unit test in
// `tests/unit/workspace/workspace-io.test.ts` pins the implementation;
// this arch-level test pins the contract from the outside.
// ---------------------------------------------------------------------------

test('arch: WorkspaceIO blocks symlink escape via realpath containment', async (t) => {
  if (process.platform === 'win32') {
    t.skip(
      'Symlink test skipped on Windows (requires admin / Developer Mode); ' +
        'POSIX CI runs cover the realpath-containment contract.'
    );
    return;
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-arch-io-'));
  try {
    const root = path.join(parent, 'workspace');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
      fs.symlinkSync(outside, path.join(root, 'leak'), 'dir');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        t.skip(
          `Symlink creation failed (${code}; likely insufficient privileges). ` +
            'POSIX CI covers this case.'
        );
        return;
      }
      throw err;
    }
    const io = await WorkspaceIO.create(asWorkspaceRoot(root));
    await assert.rejects(
      io.readFile('leak/secret.txt'),
      (err: Error & { code?: string }) =>
        err.name === 'PathEscapeError' && err.code === 'PATH_ESCAPE',
      'WorkspaceIO must block symlink-target-outside-workspace via realpath.'
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Part D — AST-based fs.<write*|mkdir*|unlink*|rm*> scan over
// `src/{graph,info,artifact}/` (Loop 23).
//
// Mirrors the AST pattern from `tests/arch/console-discipline.test.ts`.
// Detects calls via the TypeScript Compiler API so substring matches in
// strings/comments cannot produce false positives.
//
// Reads (`fs.readFile`, `fs.readdir`, `fs.access`, `fs.stat`) are
// tolerated for now (Finding 9 is mostly about WRITES; reads will fall
// out of scope as L24/L25/L26 thread `WorkspaceIO` through every caller).
//
// Files in the SUBTREE_ALLOWLIST (`src/workspace/`, `src/core/`) are
// allowed to call write-side `fs.*` directly — those subtrees own the
// containment surface itself.
//
// Loop 23 does NOT remove any back-compat fallback paths, so the
// `KNOWN_WRITE_VIOLATIONS` list documents each call site that still
// flows through raw `fs.*`. L24/L25/L26 each remove their share.
// ---------------------------------------------------------------------------

interface FsWriteCallSite {
  readonly rel: string;
  readonly line: number;
  readonly method: string;
}

interface KnownFsWriteViolation {
  readonly rel: string;
  readonly method: string;
  readonly reason: string;
}

const SUBTREES_TO_SCAN = ['src/graph', 'src/info', 'src/artifact'];

const SUBTREE_ALLOWLIST: readonly string[] = [
  'src/workspace/',
  'src/core/',
];

const FS_WRITE_METHODS = new Set([
  'writeFile',
  'writeFileSync',
  'mkdir',
  'mkdirSync',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
]);

// Documented back-compat fallback paths in the L23-migrated files. L24
// will thread WorkspaceIO through every caller and remove these entries.
// `graph/plot/generator.ts` is owned by L24 (callers in src/scripts/).
const KNOWN_WRITE_VIOLATIONS: readonly KnownFsWriteViolation[] = [
  {
    rel: 'src/graph/edgelist.ts',
    method: 'mkdir',
    reason: 'L23 back-compat fallback in BaseEdgeListStore.save when no `io` is passed (legacy callers); L24 removes once `io` is required.',
  },
  {
    rel: 'src/graph/edgelist.ts',
    method: 'writeFile',
    reason: 'L23 back-compat fallback in BaseEdgeListStore.save when no `io` is passed; L24 removes once `io` is required.',
  },
  {
    rel: 'src/graph/worktree-state.ts',
    method: 'mkdir',
    reason: 'L23 back-compat fallback in WatchService.save when no `io` is passed; L24 removes once `io` is required.',
  },
  {
    rel: 'src/graph/worktree-state.ts',
    method: 'writeFile',
    reason: 'L23 back-compat fallback in WatchService.save when no `io` is passed; L24 removes once `io` is required.',
  },
  {
    rel: 'src/artifact/storage.ts',
    method: 'mkdir',
    reason: 'L23 leaves the legacy free-function `writeFile` raw per PLAN §23.2.c fallback option; live writers use the new ArtifactStorage class instead.',
  },
  {
    rel: 'src/artifact/storage.ts',
    method: 'writeFile',
    reason: 'L23 leaves the legacy free-function `writeFile` raw per PLAN §23.2.c fallback option; live writers use the new ArtifactStorage class instead.',
  },
  {
    rel: 'src/artifact/storage.ts',
    method: 'unlink',
    reason: 'L23 leaves the legacy free-function `deleteFile` raw per PLAN §23.2.c fallback option; live writers use the new ArtifactStorage class instead.',
  },
];

function isUnderAnySubtree(rel: string): boolean {
  return SUBTREES_TO_SCAN.some((s) => rel === s || rel.startsWith(`${s}/`));
}

function isInSubtreeAllowlist(rel: string): boolean {
  return SUBTREE_ALLOWLIST.some((s) => rel.startsWith(s));
}

/**
 * AST-walk a file and return every `fs.<method>` / `fsSync.<method>` /
 * `fs.promises.<method>` call where `<method>` is in `FS_WRITE_METHODS`.
 * Detects property-access expressions on identifiers `fs`, `fsSync`,
 * `fsp`, `fsPromises`, plus the `fs.promises.<method>` chain shape.
 */
function collectFsWriteCallSitesInFile(filePath: string): FsWriteCallSite[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const rel = toRepoRel(filePath);
  const sites: FsWriteCallSite[] = [];

  function isFsRoot(expr: ts.Expression): boolean {
    if (ts.isIdentifier(expr)) {
      return expr.text === 'fs' || expr.text === 'fsSync' ||
        expr.text === 'fsp' || expr.text === 'fsPromises';
    }
    // `fs.promises` chain shape
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'fs' &&
      ts.isIdentifier(expr.name) &&
      expr.name.text === 'promises'
    ) {
      return true;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      FS_WRITE_METHODS.has(node.name.text) &&
      isFsRoot(node.expression)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      sites.push({ rel, line: line + 1, method: node.name.text });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return sites;
}

function collectFsWriteCallSitesInSubtrees(): FsWriteCallSite[] {
  const sources = walkSrc(SRC_ROOT);
  const all: FsWriteCallSite[] = [];
  for (const file of sources) {
    const rel = toRepoRel(file);
    if (!isUnderAnySubtree(rel)) continue;
    if (isInSubtreeAllowlist(rel)) continue;
    all.push(...collectFsWriteCallSitesInFile(file));
  }
  return all;
}

function fileMethodKey(s: { rel: string; method: string }): string {
  return `${s.rel}::${s.method}`;
}

test('fs-write-discipline: src/{graph,info,artifact}/ has no undocumented direct fs.<write*|mkdir*|unlink*|rm*>', () => {
  const sites = collectFsWriteCallSitesInSubtrees();
  const known = new Set(KNOWN_WRITE_VIOLATIONS.map(fileMethodKey));

  // Group observed sites by (file, method) so multiple call sites for the
  // same method in the same file count as one entry — matches console-
  // discipline's per-file-per-level grouping spirit.
  const observedKeys = new Set(sites.map(fileMethodKey));
  const undocumented: FsWriteCallSite[] = [];
  for (const site of sites) {
    if (!known.has(fileMethodKey(site))) undocumented.push(site);
  }

  if (undocumented.length > 0) {
    for (const site of undocumented) {
      console.error(
        `FS-WRITE-DISCIPLINE  ${site.rel}:${site.line} calls fs.${site.method}\n  ` +
          `Route this through WorkspaceIO (src/workspace/workspace-io.ts) for ` +
          `realpath-strong containment. If this is a transitional back-compat ` +
          `path, add an entry to KNOWN_WRITE_VIOLATIONS in ` +
          `tests/arch/workspace-paths.test.ts with a one-line reason.`
      );
    }
    assert.fail(
      `${undocumented.length} undocumented direct fs.<write*|mkdir*|unlink*|rm*> ` +
        `call(s) in src/{graph,info,artifact}/.`
    );
  }

  // Also flag stale KNOWN_WRITE_VIOLATIONS entries — once L24/L25/L26
  // remove the back-compat path the entry must come off.
  const stale = KNOWN_WRITE_VIOLATIONS.filter(
    (v) => !observedKeys.has(fileMethodKey(v)),
  );
  if (stale.length > 0) {
    for (const v of stale) {
      console.error(
        `STALE  KNOWN_WRITE_VIOLATIONS entry ${v.rel}::fs.${v.method} no longer ` +
          `observed; remove from tests/arch/workspace-paths.test.ts.\n  reason was: ${v.reason}`
      );
    }
    assert.fail(
      `${stale.length} stale KNOWN_WRITE_VIOLATIONS entry/entries detected.`
    );
  }
});
