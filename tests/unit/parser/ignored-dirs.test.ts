// tests/unit/parser/ignored-dirs.test.ts
//
// Pin `src/parser/config.ts::isIgnoredDir` — the shared directory-walk gate.
//
// IGNORED_FOLDERS matches directory NAMES only, so a virtualenv with a
// nonstandard name (real case: `.venv_diffdock_pp`) was crawled: one scan
// pulled 60k+ site-packages nodes into the import graph. isIgnoredDir adds
// two marker-file checks that identify such dirs regardless of name:
//   - `pyvenv.cfg`   — present in every Python venv (the universal marker)
//   - `CACHEDIR.TAG` — the cachedir.org convention (pip, uv, pytest, cargo)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { isIgnoredDir, IGNORED_FOLDERS } from '../../../src/parser/config';

function makeRoot(): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-igndir-')),
    );
}

test('isIgnoredDir: IGNORED_FOLDERS names are ignored without any marker file', () => {
    const root = makeRoot();
    try {
        // The dir does not even need to exist for the name tier to fire.
        assert.ok(IGNORED_FOLDERS.has('node_modules'), 'precondition');
        assert.equal(isIgnoredDir(root, 'node_modules'), true);
        assert.equal(isIgnoredDir(root, '.venv'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isIgnoredDir: a nonstandard-named dir containing pyvenv.cfg is ignored', () => {
    const root = makeRoot();
    try {
        const venv = path.join(root, 'my_custom_env');
        fs.mkdirSync(venv);
        fs.writeFileSync(path.join(venv, 'pyvenv.cfg'), 'home = /usr/bin\n');
        assert.ok(!IGNORED_FOLDERS.has('my_custom_env'), 'precondition: name not in the set');
        assert.equal(isIgnoredDir(root, 'my_custom_env'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isIgnoredDir: a dir containing CACHEDIR.TAG is ignored', () => {
    const root = makeRoot();
    try {
        const cache = path.join(root, 'some_cache');
        fs.mkdirSync(cache);
        fs.writeFileSync(
            path.join(cache, 'CACHEDIR.TAG'),
            'Signature: 8a477f597d28d172789f06886806bc55\n',
        );
        assert.equal(isIgnoredDir(root, 'some_cache'), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isIgnoredDir: a normal source dir is NOT ignored', () => {
    const root = makeRoot();
    try {
        const src = path.join(root, 'src');
        fs.mkdirSync(src);
        fs.writeFileSync(path.join(src, 'index.ts'), 'export const x = 1;\n');
        assert.equal(isIgnoredDir(root, 'src'), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isIgnoredDir: safe on file entries (marker probe under a file is false)', () => {
    const root = makeRoot();
    try {
        fs.writeFileSync(path.join(root, 'main.ts'), 'export {};\n');
        assert.equal(isIgnoredDir(root, 'main.ts'), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
