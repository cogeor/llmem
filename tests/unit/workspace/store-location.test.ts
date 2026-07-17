// tests/unit/workspace/store-location.test.ts
//
// Pin `src/workspace/store-location.ts` (P1 portable store):
//   - resolveGlobalStoreRoot: <base>/llmem/store/<name>-<hash8>/graph with
//     hash stability, basename sanitization, win32 case-folding, both
//     platform base branches (via injected seams — process.platform is
//     never mutated), the LLMEM_STORE_DIR base override, and realpath
//     canonicalization for existing directories.
//   - resolveArtifactRootPrecedence: --artifact-root flag >
//     LLMEM_ARTIFACT_ROOT > --store global / LLMEM_STORE=global > default
//     (undefined), with an explicit --store repo beating LLMEM_STORE=global.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    resolveGlobalStoreRoot,
    resolveArtifactRootPrecedence,
    type StoreSeams,
} from '../../../src/workspace/store-location';

const HOME = path.resolve(path.sep, 'home', 'u');

const posixSeams = (env: NodeJS.ProcessEnv = {}): StoreSeams => ({
    platform: 'linux',
    env,
    homedir: () => HOME,
});

const win32Seams = (env: NodeJS.ProcessEnv = {}): StoreSeams => ({
    platform: 'win32',
    env,
    homedir: () => HOME,
});

/** A host-native absolute path that does NOT exist (realpath falls back to resolve). */
function ghostWorkspace(basename: string): string {
    return path.resolve(os.tmpdir(), 'llmem-store-loc-nonexistent', basename);
}

function sha8(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
}

test('resolveGlobalStoreRoot: POSIX layout under $XDG_CACHE_HOME, sha256 hash8 of the resolved path', () => {
    const ws = ghostWorkspace('myproj');
    const cache = path.resolve(path.sep, 'xdg', 'cache');
    const got = resolveGlobalStoreRoot(ws, posixSeams({ XDG_CACHE_HOME: cache }));
    assert.equal(
        got,
        path.join(cache, 'llmem', 'store', `myproj-${sha8(ws)}`, 'graph'),
    );
});

test('resolveGlobalStoreRoot: POSIX falls back to ~/.cache without XDG_CACHE_HOME', () => {
    const ws = ghostWorkspace('myproj');
    const got = resolveGlobalStoreRoot(ws, posixSeams({}));
    assert.ok(
        got.startsWith(path.join(HOME, '.cache', 'llmem', 'store')),
        `expected ~/.cache base, got ${got}`,
    );
});

test('resolveGlobalStoreRoot: win32 uses %LOCALAPPDATA% and case-folds the path before hashing', () => {
    const ws = ghostWorkspace('MyProj');
    const local = path.resolve(path.sep, 'users', 'u', 'appdata', 'local');
    const got = resolveGlobalStoreRoot(ws, win32Seams({ LOCALAPPDATA: local }));
    // Hash of the LOWERCASED path; name lowercased+sanitized.
    assert.equal(
        got,
        path.join(local, 'llmem', 'store', `myproj-${sha8(ws.toLowerCase())}`, 'graph'),
    );
    // Different input casing keys to the SAME store on win32.
    assert.equal(
        resolveGlobalStoreRoot(ws.toUpperCase(), win32Seams({ LOCALAPPDATA: local })),
        got,
    );
});

test('resolveGlobalStoreRoot: win32 falls back to ~/AppData/Local without LOCALAPPDATA', () => {
    const ws = ghostWorkspace('myproj');
    const got = resolveGlobalStoreRoot(ws, win32Seams({}));
    assert.ok(
        got.startsWith(path.join(HOME, 'AppData', 'Local', 'llmem', 'store')),
        `expected ~/AppData/Local base, got ${got}`,
    );
});

test('resolveGlobalStoreRoot: POSIX hashing is case-SENSITIVE (no folding)', () => {
    const local = { XDG_CACHE_HOME: path.resolve(path.sep, 'c') };
    const a = resolveGlobalStoreRoot(ghostWorkspace('CaseA'), posixSeams(local));
    const b = resolveGlobalStoreRoot(ghostWorkspace('casea'), posixSeams(local));
    assert.notEqual(a, b, 'distinct POSIX casings must key to distinct stores');
});

test('resolveGlobalStoreRoot: LLMEM_STORE_DIR overrides the platform base on both platforms', () => {
    const ws = ghostWorkspace('myproj');
    const base = path.resolve(os.tmpdir(), 'llmem-store-base-override');
    for (const seams of [
        posixSeams({ LLMEM_STORE_DIR: base, XDG_CACHE_HOME: '/ignored' }),
        win32Seams({ LLMEM_STORE_DIR: base, LOCALAPPDATA: 'C:\\ignored' }),
    ]) {
        const got = resolveGlobalStoreRoot(ws, seams);
        assert.ok(
            got.startsWith(path.join(base, 'llmem', 'store')),
            `expected LLMEM_STORE_DIR base, got ${got}`,
        );
    }
});

test('resolveGlobalStoreRoot: hash is stable across calls and independent of base', () => {
    const ws = ghostWorkspace('stable');
    const a = resolveGlobalStoreRoot(ws, posixSeams({ XDG_CACHE_HOME: '/c1' }));
    const b = resolveGlobalStoreRoot(ws, posixSeams({ XDG_CACHE_HOME: '/c2' }));
    assert.equal(path.basename(path.dirname(a)), path.basename(path.dirname(b)));
    assert.equal(a, resolveGlobalStoreRoot(ws, posixSeams({ XDG_CACHE_HOME: '/c1' })));
});

test('resolveGlobalStoreRoot: basename sanitized to [a-z0-9-]', () => {
    const ws = ghostWorkspace('My Proj_2.0 (beta)');
    const got = resolveGlobalStoreRoot(ws, posixSeams({ XDG_CACHE_HOME: '/c' }));
    const storeDir = path.basename(path.dirname(got));
    assert.match(storeDir, /^my-proj-2-0-beta-[0-9a-f]{8}$/);
});

test('resolveGlobalStoreRoot: existing directories are canonicalized via realpath', () => {
    const tmp = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-store-real-')),
    );
    try {
        fs.mkdirSync(path.join(tmp, 'sub'));
        const seams = posixSeams({ XDG_CACHE_HOME: '/c' });
        // `<tmp>/sub/..` must key identically to `<tmp>` itself.
        assert.equal(
            resolveGlobalStoreRoot(path.join(tmp, 'sub', '..'), seams),
            resolveGlobalStoreRoot(tmp, seams),
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// resolveArtifactRootPrecedence
// ---------------------------------------------------------------------------

const WS = ghostWorkspace('prec');
const SEAMS = posixSeams({ XDG_CACHE_HOME: path.resolve(path.sep, 'cache') });
const GLOBAL = resolveGlobalStoreRoot(WS, SEAMS);

test('precedence: --artifact-root flag beats everything', () => {
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            flagArtifactRoot: '/flag/root',
            envArtifactRoot: '/env/root',
            flagStore: 'global',
            envStore: 'global',
            seams: SEAMS,
        }),
        '/flag/root',
    );
});

test('precedence: LLMEM_ARTIFACT_ROOT beats --store global and LLMEM_STORE', () => {
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            envArtifactRoot: '/env/root',
            flagStore: 'global',
            envStore: 'global',
            seams: SEAMS,
        }),
        '/env/root',
    );
});

test('precedence: --store global resolves the per-user store', () => {
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            flagStore: 'global',
            seams: SEAMS,
        }),
        GLOBAL,
    );
});

test('precedence: LLMEM_STORE=global applies when no store flag is given', () => {
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            envStore: 'global',
            seams: SEAMS,
        }),
        GLOBAL,
    );
});

test('precedence: explicit --store repo beats LLMEM_STORE=global (default applies)', () => {
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            flagStore: 'repo',
            envStore: 'global',
            seams: SEAMS,
        }),
        undefined,
    );
});

test('precedence: no flags/env → undefined (default .llmem/graph); junk LLMEM_STORE ignored', () => {
    assert.equal(
        resolveArtifactRootPrecedence({ workspaceRoot: WS, seams: SEAMS }),
        undefined,
    );
    assert.equal(
        resolveArtifactRootPrecedence({
            workspaceRoot: WS,
            envStore: 'banana',
            seams: SEAMS,
        }),
        undefined,
    );
});
