// tests/contracts/package-identity.test.ts
//
// A-grade #1 — package identity is dual-published and must stay consistent.
//
// LLMem ships TWO artifacts from one package.json (see .github/workflows/
// publish.yml — `publish-vscode` runs `vsce publish`, `publish-npm` runs
// `npm publish`):
//
//   * VS Code extension (VSIX): VS Code reads `package.json#main` and calls
//     its `activate`/`deactivate`. So `main` must point at the extension
//     entry, and the extension's runtime dependency tree must ship in the
//     VSIX (it requires dist/mcp/server.js at activation).
//
//   * npm package: Node resolves `require('@cogeor/llmem')` through the
//     `exports` map (which takes precedence over `main`), so the npm import
//     surface is the MCP stdio server. The `bin.llmem` CLI shim and the
//     `files` whitelist must cover the npm runtime.
//
// The regrade's issue #1 was that `main` pointed at the MCP entry while
// `.vscodeignore` excluded `dist/mcp/**` from the VSIX — i.e. the published
// extension activated a runtime surface that was not in the package. This
// test pins the resolved identity so that conflict cannot silently return.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readPkg(): Record<string, any> {
    return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
}

function readRepoFile(rel: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

test('package-identity: VSIX entry — `main` is the extension activation module', () => {
    const pkg = readPkg();
    assert.equal(
        pkg.main,
        './dist/extension/extension.js',
        'package.json#main must be the VS Code extension entry (VS Code activates `main`).',
    );

    // The entry source must actually export the activation lifecycle, or the
    // VSIX loads but never activates.
    const entry = readRepoFile('src/extension/extension.ts');
    assert.match(
        entry,
        /export\s+(?:async\s+)?function\s+activate\b/,
        'src/extension/extension.ts must export `activate` (the VSIX entry).',
    );
    assert.match(
        entry,
        /export\s+(?:async\s+)?function\s+deactivate\b/,
        'src/extension/extension.ts must export `deactivate`.',
    );
});

test('package-identity: npm entry — `exports` resolves to the MCP stdio server', () => {
    const pkg = readPkg();
    assert.equal(
        pkg.exports?.['.'],
        './dist/mcp/main.js',
        "package.json#exports['.'] must be the MCP server bundle (the npm import surface).",
    );
    assert.equal(pkg.bin?.llmem, 'bin/llmem', 'bin.llmem must be the CLI shim.');
});

test('package-identity: npm `files` covers both standalone runtime bundles', () => {
    const pkg = readPkg();
    const files: string[] = pkg.files ?? [];
    for (const required of ['dist/cli/main.js', 'dist/mcp/main.js']) {
        assert.ok(
            files.includes(required),
            `package.json#files must ship ${required} for the npm package.`,
        );
    }
    assert.ok(
        files.some((f) => f.startsWith('dist/webview/')),
        'package.json#files must ship the webview assets.',
    );
});

test('package-identity: VSIX does not exclude the extension dependency tree', () => {
    // The extension entry requires dist/mcp/server.js (and the rest of the MCP
    // server dist tree) at activation. A blanket `dist/mcp/**` ignore line
    // shipped a broken VSIX — guard against its return.
    const ignore = readRepoFile('.vscodeignore');
    const lines = ignore
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));
    assert.ok(
        !lines.includes('dist/mcp/**') && !lines.includes('dist/mcp/'),
        '.vscodeignore must not exclude dist/mcp/** — the extension entry requires it at activation.',
    );
});
