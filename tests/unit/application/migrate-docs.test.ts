// tests/unit/application/migrate-docs.test.ts
//
// Loop VS-B3 — pin the one-time docs migration (.arch -> .llmem/docs):
//   (1) NO-LEGACY          -> 'none', no throw
//   (2) LEGACY-ONLY        -> 'migrated', files moved, .arch removed; idempotent
//   (3) NEW-ONLY           -> 'none', no spurious .arch created
//   (4) BOTH-PRESENT       -> 'conflict-skipped', nothing clobbered, .arch kept
//   Safety: .artifacts/ is never mutated.
//
// Tests use real temp workspaces (os.tmpdir + fs.mkdtempSync); each cleans up
// in finally.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { migrateDocs } from '../../../src/application/migrate-docs';

const DOCS_DIR = '.llmem/docs';
const LEGACY_DIR = '.arch';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-migrate-'));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

function seed(root: string, rel: string, content: string): void {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
}

function read(root: string, rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf-8');
}

function exists(root: string, rel: string): boolean {
    return fs.existsSync(path.join(root, rel));
}

// ---------------------------------------------------------------------------
// (1) NO-LEGACY
// ---------------------------------------------------------------------------

test('migrateDocs (1) NO-LEGACY: neither folder -> none, no throw', async () => {
    const root = mkTmp();
    try {
        const res = await migrateDocs(root);
        assert.equal(res.action, 'none');
        assert.equal(exists(root, LEGACY_DIR), false);
        assert.equal(exists(root, DOCS_DIR), false);
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (2) LEGACY-ONLY
// ---------------------------------------------------------------------------

test('migrateDocs (2) LEGACY-ONLY: moves .arch -> .llmem/docs; idempotent', async () => {
    const root = mkTmp();
    try {
        seed(root, `${LEGACY_DIR}/src/foo.md`, 'FOO');
        seed(root, `${LEGACY_DIR}/README.md`, 'ROOT');
        // .artifacts cache must survive untouched.
        seed(root, '.artifacts/import-edgelist.json', '{}');

        const res = await migrateDocs(root);
        assert.equal(res.action, 'migrated');

        assert.equal(read(root, `${DOCS_DIR}/src/foo.md`), 'FOO');
        assert.equal(read(root, `${DOCS_DIR}/README.md`), 'ROOT');
        assert.equal(exists(root, LEGACY_DIR), false);

        // .artifacts untouched.
        assert.equal(read(root, '.artifacts/import-edgelist.json'), '{}');

        // Second init is an idempotent no-op; files intact.
        const res2 = await migrateDocs(root);
        assert.equal(res2.action, 'none');
        assert.equal(read(root, `${DOCS_DIR}/src/foo.md`), 'FOO');
        assert.equal(read(root, `${DOCS_DIR}/README.md`), 'ROOT');
        assert.equal(exists(root, LEGACY_DIR), false);
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (3) NEW-ONLY
// ---------------------------------------------------------------------------

test('migrateDocs (3) NEW-ONLY: only .llmem/docs -> none, no spurious .arch', async () => {
    const root = mkTmp();
    try {
        seed(root, `${DOCS_DIR}/README.md`, 'NEW');

        const res = await migrateDocs(root);
        assert.equal(res.action, 'none');
        assert.equal(exists(root, LEGACY_DIR), false);
        assert.equal(read(root, `${DOCS_DIR}/README.md`), 'NEW');
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (4) BOTH-PRESENT CONFLICT
// ---------------------------------------------------------------------------

test('migrateDocs (4) BOTH-PRESENT: conflict-skipped, nothing clobbered', async () => {
    const root = mkTmp();
    try {
        seed(root, `${DOCS_DIR}/README.md`, 'NEW');
        seed(root, `${LEGACY_DIR}/README.md`, 'OLD');
        seed(root, `${LEGACY_DIR}/src/new.md`, 'NEWFILE');
        seed(root, '.artifacts/call-edgelist.json', '{}');

        const res = await migrateDocs(root);
        assert.equal(res.action, 'conflict-skipped');

        // Existing dest file UNCHANGED (not clobbered by OLD).
        assert.equal(read(root, `${DOCS_DIR}/README.md`), 'NEW');
        // Policy (b): both trees untouched — no merge of .arch/src/new.md.
        assert.equal(exists(root, `${DOCS_DIR}/src/new.md`), false);
        // Legacy tree left for the user.
        assert.equal(read(root, `${LEGACY_DIR}/README.md`), 'OLD');
        assert.equal(read(root, `${LEGACY_DIR}/src/new.md`), 'NEWFILE');

        // .artifacts untouched.
        assert.equal(read(root, '.artifacts/call-edgelist.json'), '{}');
    } finally {
        rm(root);
    }
});
