// tests/unit/claude/web-launcher.test.ts
//
// Loop 21 — pin the new asset-resolution chain in `web-launcher.ts`.
// Before Loop 21 the launcher computed its asset directory from
// `__dirname`, which broke under ts-node because `__dirname` for
// `src/claude/web-launcher.ts` resolves to `<repo-parent>/dist/webview`
// — one level above the repo root, where nothing exists. Loop 21
// replaced that with an injected `assetRoot` option plus a discovery
// chain (workspaceRoot → cwd-walk-up to find `package.json` with
// `name === 'llmem'` → src/webview dev fallback).
//
// These tests exercise the resolution-order logic by writing fixture
// directories under `os.tmpdir()` and (where needed) stubbing
// `process.cwd` so the cwd-walk-up lands inside the fixture rather
// than the real repo. The launcher's full graph-generation path is
// intentionally NOT exercised here — that's an integration concern
// (see `tests/integration/arch-watcher.test.ts`).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveAssetRoot, findRepoRoot } from '../../../src/claude/web-launcher';

/** Create a tmp dir and return its absolute path. */
function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-launcher-asset-'));
}

/** Best-effort cleanup; tests should not crash if a tmp tree leaks. */
function rm(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Write `<dir>/index.html` (and any parent dirs). */
function writeIndex(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const indexPath = path.join(dir, 'index.html');
    fs.writeFileSync(indexPath, '<!doctype html><html></html>');
    return indexPath;
}

/** Run `fn` with `process.cwd` returning `cwd`. Restores on exit. */
function withCwd<T>(cwd: string, fn: () => T): T {
    const original = process.cwd;
    process.cwd = () => cwd;
    try {
        return fn();
    } finally {
        process.cwd = original;
    }
}

test('resolveAssetRoot: explicit assetRoot wins when index.html exists', () => {
    const tmp = mkTmp();
    try {
        const fixture = path.join(tmp, 'fixture-assets');
        writeIndex(fixture);

        // Even with a workspaceRoot whose dist/webview is missing, the
        // explicit assetRoot must take precedence.
        const resolved = resolveAssetRoot({
            workspaceRoot: tmp,
            assetRoot: fixture,
        });
        assert.equal(resolved, fixture);
    } finally {
        rm(tmp);
    }
});

test('resolveAssetRoot: workspaceRoot/dist/webview wins when assetRoot is omitted', () => {
    const tmp = mkTmp();
    try {
        const wsAssets = path.join(tmp, 'dist', 'webview');
        writeIndex(wsAssets);

        // Bury process.cwd somewhere unrelated so the repo-walk-up
        // probe (step 3) cannot accidentally satisfy the resolution —
        // the workspaceRoot probe (step 2) must be what wins.
        const cwdSandbox = path.join(tmp, 'unrelated-cwd');
        fs.mkdirSync(cwdSandbox, { recursive: true });

        const resolved = withCwd(cwdSandbox, () =>
            resolveAssetRoot({ workspaceRoot: tmp }),
        );
        assert.equal(resolved, wsAssets);
    } finally {
        rm(tmp);
    }
});

test('resolveAssetRoot: repo-walk-up from cwd lands on <repoRoot>/dist/webview', () => {
    const tmp = mkTmp();
    try {
        // Construct a fake repo: package.json with name="llmem" and a
        // populated dist/webview. process.cwd points into a subdir so
        // findRepoRoot has to walk up to find it.
        const repoRoot = path.join(tmp, 'fake-repo');
        fs.mkdirSync(repoRoot, { recursive: true });
        fs.writeFileSync(
            path.join(repoRoot, 'package.json'),
            JSON.stringify({ name: 'llmem', version: '0.0.0' }),
        );
        const repoDist = path.join(repoRoot, 'dist', 'webview');
        writeIndex(repoDist);

        const nestedCwd = path.join(repoRoot, 'a', 'b', 'c');
        fs.mkdirSync(nestedCwd, { recursive: true });

        // Workspace dir exists but has no dist/webview, so step 2 fails
        // and step 3 (repo walk-up) is exercised.
        const ws = path.join(tmp, 'unrelated-workspace');
        fs.mkdirSync(ws, { recursive: true });

        const resolved = withCwd(nestedCwd, () => {
            // Sanity: findRepoRoot itself should locate the fake repo.
            const found = findRepoRoot();
            assert.equal(found, repoRoot, 'findRepoRoot should locate the fake repo');
            return resolveAssetRoot({ workspaceRoot: ws });
        });
        assert.equal(resolved, repoDist);
    } finally {
        rm(tmp);
    }
});

test('resolveAssetRoot: throws an error that does NOT mention __dirname when nothing resolves', () => {
    const tmp = mkTmp();
    try {
        // Workspace exists but has no dist/webview. process.cwd lands
        // in a directory tree with no llmem package.json above it, so
        // the repo-walk-up fallback fails too. assetRoot is given but
        // points at a directory that does not contain index.html.
        const ws = path.join(tmp, 'workspace');
        fs.mkdirSync(ws, { recursive: true });
        const bogusAsset = path.join(tmp, 'no-such-assets');

        // Place cwd at the tmp root — there is no package.json with
        // name="llmem" walking up from /tmp/llmem-launcher-asset-XXX,
        // so findRepoRoot returns null.
        const cwdSandbox = path.join(tmp, 'cwd-sandbox');
        fs.mkdirSync(cwdSandbox, { recursive: true });

        const err = withCwd(cwdSandbox, () => {
            try {
                resolveAssetRoot({ workspaceRoot: ws, assetRoot: bogusAsset });
                return null;
            } catch (e) {
                return e instanceof Error ? e : new Error(String(e));
            }
        });

        assert.ok(err, 'resolveAssetRoot should have thrown');
        assert.ok(
            !err.message.includes('__dirname'),
            `error must not reference __dirname; got: ${err.message}`,
        );
        // The error should mention every probed path.
        assert.ok(
            err.message.includes(bogusAsset),
            `error should list the bogus assetRoot; got: ${err.message}`,
        );
        assert.ok(
            err.message.includes('build:webview'),
            `error should hint at "npm run build:webview"; got: ${err.message}`,
        );
    } finally {
        rm(tmp);
    }
});
