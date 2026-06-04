// tests/unit/application/ensure-gitignored.test.ts
//
// Loop PH-05 — pin the idempotent, append-only .gitignore maintenance helper:
//   (1) git repo, no .gitignore  -> 'created' with the block + .llmem/
//   (2) second call              -> 'present' no-op (no duplicate)
//   (2b) pre-existing .llmem / .llmem/ (with/without slash) -> left untouched
//   (3) no .git                  -> 'not-git', no file written
//   (4) append-only              -> user content preserved verbatim, block at END
//
// Uses real temp workspaces (os.tmpdir + fs.mkdtempSync); each cleans up.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureGitignored } from '../../../src/application/ensure-gitignored';
import { WorkspaceIO } from '../../../src/workspace/workspace-io';
import { asWorkspaceRoot } from '../../../src/core/paths';

function mkTmp(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-gi-')));
}

function rm(p: string): void {
    fs.rmSync(p, { recursive: true, force: true });
}

function gitInit(root: string): void {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
}

function read(root: string): string {
    return fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
}

function exists(root: string, rel: string): boolean {
    return fs.existsSync(path.join(root, rel));
}

async function ioFor(root: string): Promise<WorkspaceIO> {
    return WorkspaceIO.create(asWorkspaceRoot(root));
}

// ---------------------------------------------------------------------------
// (1) git repo, no .gitignore -> created with the block
// ---------------------------------------------------------------------------

test('ensureGitignored (1) git repo + no .gitignore -> creates with block', async () => {
    const root = mkTmp();
    try {
        gitInit(root);
        const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        assert.equal(res.action, 'created');
        const content = read(root);
        assert.match(content, /# LLMem \(generated\)/);
        assert.match(content, /^\.llmem\/$/m);
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (2) second call is a no-op (no duplicate)
// ---------------------------------------------------------------------------

test('ensureGitignored (2) second call -> present, no duplicate', async () => {
    const root = mkTmp();
    try {
        gitInit(root);
        await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        assert.equal(res.action, 'present');
        const content = read(root);
        const occurrences = content.split(/\r?\n/).filter((l) => l.trim() === '.llmem/').length;
        assert.equal(occurrences, 1, 'exactly one .llmem/ line');
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (2b) pre-existing .llmem OR .llmem/ entry left untouched
// ---------------------------------------------------------------------------

for (const seedEntry of ['.llmem', '.llmem/']) {
    test(`ensureGitignored (2b) pre-existing "${seedEntry}" -> present, untouched`, async () => {
        const root = mkTmp();
        try {
            gitInit(root);
            const seeded = `node_modules\n${seedEntry}\n`;
            fs.writeFileSync(path.join(root, '.gitignore'), seeded);
            const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
            assert.equal(res.action, 'present');
            assert.equal(read(root), seeded, 'file is byte-for-byte unchanged');
        } finally {
            rm(root);
        }
    });
}

// ---------------------------------------------------------------------------
// (3) no .git -> not-git, no file written
// ---------------------------------------------------------------------------

test('ensureGitignored (3) no .git -> not-git, no file written', async () => {
    const root = mkTmp();
    try {
        const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        assert.equal(res.action, 'not-git');
        assert.equal(exists(root, '.gitignore'), false, '.gitignore must not exist');
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (4) append-only: user content preserved verbatim, block appended at the END
// ---------------------------------------------------------------------------

test('ensureGitignored (4) append-only preserves user content; block at end', async () => {
    const root = mkTmp();
    try {
        gitInit(root);
        const userContent = 'node_modules\n*.log\n';
        fs.writeFileSync(path.join(root, '.gitignore'), userContent);
        const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        assert.equal(res.action, 'appended');
        const content = read(root);
        assert.ok(content.startsWith(userContent), 'user lines preserved verbatim at the start');
        // Block is at the END, after the user content.
        const idxUser = content.indexOf('*.log');
        const idxBlock = content.indexOf('# LLMem (generated)');
        assert.ok(idxBlock > idxUser, 'block appended after user content');
        assert.match(content, /^\.llmem\/$/m);
    } finally {
        rm(root);
    }
});

// ---------------------------------------------------------------------------
// (5) .git as a FILE (worktree/submodule) also counts as a git repo
// ---------------------------------------------------------------------------

test('ensureGitignored (5) .git file (worktree) counts -> created', async () => {
    const root = mkTmp();
    try {
        fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
        const res = await ensureGitignored(asWorkspaceRoot(root), await ioFor(root));
        assert.equal(res.action, 'created');
        assert.match(read(root), /^\.llmem\/$/m);
    } finally {
        rm(root);
    }
});
