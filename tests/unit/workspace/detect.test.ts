// tests/unit/workspace/detect.test.ts
//
// Pin the resolution priority of `src/workspace/detect.ts::detectWorkspace`:
//   1. explicit argument (throws WorkspaceNotFoundError if nonexistent)
//   2. LLMEM_WORKSPACE env var (same error contract as explicit)
//   3. marker walk-up from cwd
//   4. cwd fallback
//
// The env-var tier was previously honored ONLY by the MCP server's private
// detectWorkspaceRoot(); every CLI command silently ignored it. These tests
// pin the shared walker so `LLMEM_WORKSPACE=... llmem scan` targets the
// pinned workspace, and a mistyped path fails loudly instead of silently
// scanning the cwd-detected workspace.
//
// Every test saves/restores process.env.LLMEM_WORKSPACE via try/finally.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { detectWorkspace } from '../../../src/workspace/detect';
import { WorkspaceNotFoundError } from '../../../src/core/errors';
import { ENV_VARS } from '../../../src/config-defaults';

function makeTempDir(tag: string): string {
    return fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), `llmem-detect-${tag}-`)),
    );
}

/** Run `fn` with LLMEM_WORKSPACE set to `value` (undefined = unset), restoring after. */
function withEnvWorkspace<T>(value: string | undefined, fn: () => T): T {
    const saved = process.env[ENV_VARS.WORKSPACE];
    if (value === undefined) {
        delete process.env[ENV_VARS.WORKSPACE];
    } else {
        process.env[ENV_VARS.WORKSPACE] = value;
    }
    try {
        return fn();
    } finally {
        if (saved === undefined) {
            delete process.env[ENV_VARS.WORKSPACE];
        } else {
            process.env[ENV_VARS.WORKSPACE] = saved;
        }
    }
}

test('detectWorkspace: LLMEM_WORKSPACE env var is respected when no explicit arg', () => {
    const envDir = makeTempDir('env');
    try {
        const detected = withEnvWorkspace(envDir, () => detectWorkspace());
        assert.equal(detected, path.resolve(envDir));
    } finally {
        fs.rmSync(envDir, { recursive: true, force: true });
    }
});

test('detectWorkspace: LLMEM_WORKSPACE pointing at a nonexistent path throws WorkspaceNotFoundError', () => {
    const missing = path.join(os.tmpdir(), 'llmem-detect-does-not-exist-' + process.pid);
    assert.ok(!fs.existsSync(missing), 'precondition: path must not exist');
    withEnvWorkspace(missing, () => {
        assert.throws(
            () => detectWorkspace(),
            WorkspaceNotFoundError,
            'a set-but-nonexistent LLMEM_WORKSPACE must fail loudly, not fall through to auto-detect',
        );
    });
});

test('detectWorkspace: explicit argument beats LLMEM_WORKSPACE', () => {
    const envDir = makeTempDir('env2');
    const explicitDir = makeTempDir('explicit');
    try {
        const detected = withEnvWorkspace(envDir, () => detectWorkspace(explicitDir));
        assert.equal(detected, path.resolve(explicitDir));
    } finally {
        fs.rmSync(envDir, { recursive: true, force: true });
        fs.rmSync(explicitDir, { recursive: true, force: true });
    }
});

test('detectWorkspace: unset env var falls through to marker walk-up (repo root here)', () => {
    // The test process cwd is inside the llmem repo, which has package.json /
    // .git markers — the walk-up must land on an existing ancestor dir and
    // never throw when LLMEM_WORKSPACE is unset.
    const detected = withEnvWorkspace(undefined, () => detectWorkspace());
    assert.ok(fs.existsSync(detected), `detected root must exist: ${detected}`);
    assert.ok(
        fs.existsSync(path.join(detected, 'package.json')) ||
        fs.existsSync(path.join(detected, '.git')),
        `detected root should carry a walk-up marker: ${detected}`,
    );
});

test('detectWorkspace: nonexistent explicit argument still throws WorkspaceNotFoundError', () => {
    const missing = path.join(os.tmpdir(), 'llmem-detect-missing-explicit-' + process.pid);
    assert.ok(!fs.existsSync(missing), 'precondition: path must not exist');
    withEnvWorkspace(undefined, () => {
        assert.throws(() => detectWorkspace(missing), WorkspaceNotFoundError);
    });
});
