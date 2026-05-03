// tests/unit/core/paths.test.ts
//
// Loop 22 — pin the contract of toAbs / toRel / assertContained.
// All assertions are pure-string: no temp dirs, no fs, no symlinks.
// Bases are derived via path.resolve so the tests pass on Windows
// and POSIX without hard-coded drive letters or root slashes.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import {
    asAbsPath,
    asWorkspaceRoot,
    assertContained,
    toAbs,
    toRel,
} from '../../../src/core/paths';

// A synthetic "workspace" root, OS-aware. Not a real directory.
const BASE = path.resolve('llmem-paths-test');
const PARENT = path.dirname(BASE);

test('toAbs: relative input resolves against base', () => {
    const root = asWorkspaceRoot(BASE);
    const got = toAbs('sub/x.txt', root);
    assert.equal(got, path.resolve(BASE, 'sub/x.txt'));
});

test('toAbs: absolute input is re-branded as-is (modulo normalization)', () => {
    const root = asWorkspaceRoot(BASE);
    const abs = path.resolve(BASE, 'sub/x.txt');
    const got = toAbs(abs, root);
    assert.equal(got, path.resolve(BASE, 'sub/x.txt'));
});

test('toAbs: ./prefix resolves identically to bare relative', () => {
    const root = asWorkspaceRoot(BASE);
    const dotForm = toAbs('./sub/x.txt', root);
    const bareForm = toAbs('sub/x.txt', root);
    assert.equal(dotForm, bareForm);
});

test('toRel: returns the relative form for a contained child', () => {
    const root = asWorkspaceRoot(BASE);
    const child = toAbs('sub/x.txt', root);
    const rel = toRel(child, root);
    assert.equal(rel, path.join('sub', 'x.txt'));
});

test('toRel: throws PathEscapeError when target escapes base', () => {
    const root = asWorkspaceRoot(BASE);
    const outside = asAbsPath(path.resolve(PARENT, 'outside.txt'));
    assert.throws(
        () => toRel(outside, root),
        (err: Error & { code?: string }) => {
            assert.equal(err.name, 'PathEscapeError');
            assert.equal(err.code, 'PATH_ESCAPE');
            return true;
        },
    );
});

test('assertContained: returns void for a contained child', () => {
    const root = asWorkspaceRoot(BASE);
    const child = toAbs('sub/x.txt', root);
    // Must not throw.
    assert.equal(assertContained(child, root), undefined);
});

test('assertContained: throws for ../ escape', () => {
    const root = asWorkspaceRoot(BASE);
    const escapee = asAbsPath(path.resolve(BASE, '..', 'escape.txt'));
    assert.throws(
        () => assertContained(escapee, root),
        (err: Error & { code?: string }) => {
            assert.equal(err.name, 'PathEscapeError');
            assert.equal(err.code, 'PATH_ESCAPE');
            return true;
        },
    );
});

test('assertContained: handles trailing-slash variants on parent', () => {
    const rootWithSep = asWorkspaceRoot(BASE + path.sep);
    const child = toAbs('x.txt', rootWithSep);
    // Must not throw — trailing slash on parent must not break containment.
    assert.equal(
        assertContained(child, asWorkspaceRoot(BASE)),
        undefined,
    );
});

test('assertContained: sibling of root is a hard escape', () => {
    // parent/<workspace>/... vs parent/<sibling>/<child> — same parent dir,
    // distinct workspace folders. The sibling's child must not pass
    // textual containment for the workspace.
    const workspaceDir = path.join(PARENT, 'workspace');
    const siblingChild = path.join(PARENT, 'sibling', 'child.txt');
    const root = asWorkspaceRoot(workspaceDir);
    const offender = asAbsPath(siblingChild);
    assert.throws(
        () => assertContained(offender, root),
        (err: Error & { code?: string }) => {
            assert.equal(err.name, 'PathEscapeError');
            assert.equal(err.code, 'PATH_ESCAPE');
            return true;
        },
    );
});

test('type-discipline: branded types are not interchangeable at compile time', () => {
    // The runtime body is a no-op; the value of this test is the
    // ts-expect-error directives below, which fail tsc if the brand
    // distinctions ever erode.

    const root = asWorkspaceRoot(BASE);
    const rel = toRel(toAbs('sub/x.txt', root), root); // RelPath
    const abs = toAbs('sub/x.txt', root); // AbsPath

    // RelPath cannot be passed where AbsPath is expected.
    // @ts-expect-error — RelPath is not assignable to AbsPath
    const _x: typeof abs = rel;

    // string cannot be passed where AbsPath is expected (no implicit cast).
    // @ts-expect-error — plain string is not assignable to AbsPath
    const _y: typeof abs = 'plain-string';

    // assertContained's `child` must be AbsPath, not RelPath. Verify at
    // the type level only — don't actually call the function (it would
    // throw at runtime, since rel is escape-shaped relative).
    type AssertContainedChild = Parameters<typeof assertContained>[0];
    // @ts-expect-error — RelPath is not assignable to AbsPath in assertContained
    const _z: AssertContainedChild = rel;

    // Silence unused-locals.
    void _x;
    void _y;
    void _z;

    assert.ok(true);
});
