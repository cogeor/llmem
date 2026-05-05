// tests/arch/webview-shell-parity.test.ts
//
// Loop 01 safety net for the webview shell unification.
//
// Two contracts are pinned here:
//
//   (a) Static and VS Code shells must contain the same mount-point IDs and
//       reference the same canonical asset paths. If a future loop drops or
//       renames an ID in only one host, the parity test fires.
//
//   (b) Cache invalidation in `.artifacts/webview/` actually triggers when
//       the shell hash changes. If a future change breaks the rmSync /
//       hash-recording flow, the cache test fires.
//
// Both contracts close the long-standing CLAUDE.md "delete `.artifacts/webview/`
// by hand" hazard and the `panel.ts` ↔ `index.html` drift the memo flagged.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderShell, type ShellHostHooks } from '../../src/webview/shell';
import { MOUNT_POINTS } from '../../src/webview/shell-assets';
import { invalidateIfStale, writeCachedShellHash } from '../../src/webview/shell-cache';

// ---------------------------------------------------------------------------
// Test 1 — static-mode shell renderer emits all required mount points + the
// previously-missing folder-structure stylesheet and vis-network library.
// ---------------------------------------------------------------------------

test('shell renderer emits all required mount points (static mode)', () => {
    const staticHooks: ShellHostHooks = {
        resolveStyle: (rel) => rel,
        resolveLib: (rel) => rel,
        resolveScript: (rel) => rel,
    };
    const html = renderShell({ hooks: staticHooks, dataScriptUrls: [] });

    // Every canonical mount point ID must appear as `id="..."` in the body.
    for (const id of MOUNT_POINTS) {
        assert.ok(
            html.includes(`id="${id}"`),
            `Static shell missing mount point id="${id}". Render output did not contain that ID. ` +
                `If a layout refactor renamed it, update MOUNT_POINTS in src/webview/shell-assets.ts.`,
        );
    }

    // Loop 01 closed gaps: explicit IDs the VS Code shell was missing.
    assert.ok(html.includes('id="view-toggle"'));
    assert.ok(html.includes('id="design-mode-toggle"'));
    assert.ok(html.includes('id="package-view"'));
    assert.ok(html.includes('id="folder-structure-view"'));

    // The folder-structure stylesheet must be referenced.
    assert.ok(
        html.includes('href="styles/folder-structure.css"'),
        'Static shell must include styles/folder-structure.css',
    );

    // vis-network must be loaded as a script tag.
    assert.ok(
        html.includes('src="libs/vis-network.min.js"'),
        'Static shell must include libs/vis-network.min.js',
    );
});

// ---------------------------------------------------------------------------
// Test 2 — VS Code-mode shell renderer (URL rewriting + CSP + nonce).
// ---------------------------------------------------------------------------

test('shell renderer emits all required mount points (VS Code mode)', () => {
    const csp = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'nonce-TESTNONCE';";
    const vscodeHooks: ShellHostHooks = {
        resolveStyle: (rel) => `vscode-webview://stub/${rel}`,
        resolveLib: (rel) => `vscode-webview://stub/${rel}`,
        resolveScript: (rel) => `vscode-webview://stub/${rel}`,
        csp,
        nonce: 'TESTNONCE',
    };
    const html = renderShell({ hooks: vscodeHooks });

    // Same mount-point set must be present in VS Code mode.
    for (const id of MOUNT_POINTS) {
        assert.ok(
            html.includes(`id="${id}"`),
            `VS Code shell missing mount point id="${id}".`,
        );
    }

    // URL-rewriting hooks must be applied to the canonical asset paths.
    assert.ok(
        html.includes('vscode-webview://stub/styles/folder-structure.css'),
        'VS Code shell must rewrite styles/folder-structure.css through resolveStyle',
    );
    assert.ok(
        html.includes('vscode-webview://stub/libs/vis-network.min.js'),
        'VS Code shell must rewrite libs/vis-network.min.js through resolveLib',
    );

    // The main script tag must carry the nonce.
    assert.ok(
        /<script\s+nonce="TESTNONCE"\s+src="vscode-webview:\/\/stub\/js\/main\.js">/.test(html),
        'VS Code shell main script must carry the per-render nonce',
    );

    // CSP meta tag must be present.
    assert.ok(
        html.includes('<meta http-equiv="Content-Security-Policy"'),
        'VS Code shell must emit a Content-Security-Policy meta tag when csp is provided',
    );
});

// ---------------------------------------------------------------------------
// Test 3 — Static and VS Code shells share the mount-point set. Regression
// alarm if a future loop drops or renames an ID in only one host.
// ---------------------------------------------------------------------------

test('static and VS Code shells share the mount-point set', () => {
    const staticHooks: ShellHostHooks = {
        resolveStyle: (rel) => rel,
        resolveLib: (rel) => rel,
        resolveScript: (rel) => rel,
    };
    const vscodeHooks: ShellHostHooks = {
        resolveStyle: (rel) => `vscode-webview://stub/${rel}`,
        resolveLib: (rel) => `vscode-webview://stub/${rel}`,
        resolveScript: (rel) => `vscode-webview://stub/${rel}`,
        csp: "default-src 'none';",
        nonce: 'NONCE',
    };

    const staticHtml = renderShell({ hooks: staticHooks, dataScriptUrls: [] });
    const vscodeHtml = renderShell({ hooks: vscodeHooks });

    for (const id of MOUNT_POINTS) {
        const inStatic = staticHtml.includes(`id="${id}"`);
        const inVscode = vscodeHtml.includes(`id="${id}"`);
        assert.equal(
            inStatic,
            inVscode,
            `Mount point id="${id}" present in static=${inStatic} but vscode=${inVscode}; ` +
                `drift between hosts violates the loop 01 unification contract.`,
        );
        assert.ok(
            inStatic && inVscode,
            `Mount point id="${id}" missing in both shells; remove from MOUNT_POINTS in ` +
                `src/webview/shell-assets.ts if intentional.`,
        );
    }
});

// ---------------------------------------------------------------------------
// Test 4 — `invalidateIfStale` actually rms the cached destination when the
// recorded shell hash differs from the current hash.
// ---------------------------------------------------------------------------

test('cache invalidation: stale `.artifacts/webview/` removed when shell hash changes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-shell-cache-'));
    try {
        const destinationDir = path.join(tmp, 'webview');
        // Seed a fake cached webview with an OLD hash recorded.
        fs.mkdirSync(destinationDir, { recursive: true });
        fs.mkdirSync(path.join(destinationDir, 'js'), { recursive: true });
        fs.writeFileSync(
            path.join(destinationDir, 'index.html'),
            '<!doctype html><html><body>OLD</body></html>',
            'utf8',
        );
        fs.writeFileSync(
            path.join(destinationDir, 'js', 'main.js'),
            '// old bundle',
            'utf8',
        );
        writeCachedShellHash(destinationDir, 'OLD');

        // Sanity: the seeded files exist.
        assert.ok(fs.existsSync(path.join(destinationDir, 'index.html')));
        assert.ok(fs.existsSync(path.join(destinationDir, 'js', 'main.js')));

        // Hash mismatch -> directory removed.
        const removed = invalidateIfStale(destinationDir, 'NEW');
        assert.equal(removed, true, 'invalidateIfStale must return true when hashes differ');
        assert.equal(
            fs.existsSync(destinationDir),
            false,
            'destinationDir must be rm-ed when the recorded hash differs',
        );

        // Recreate with the NEW hash and confirm a same-hash call is a no-op.
        fs.mkdirSync(destinationDir, { recursive: true });
        fs.writeFileSync(
            path.join(destinationDir, 'index.html'),
            '<!doctype html><html><body>NEW</body></html>',
            'utf8',
        );
        writeCachedShellHash(destinationDir, 'NEW');

        const removedAgain = invalidateIfStale(destinationDir, 'NEW');
        assert.equal(removedAgain, false, 'invalidateIfStale must return false when hashes match');
        assert.ok(
            fs.existsSync(path.join(destinationDir, 'index.html')),
            'destinationDir must be left intact when the hashes match',
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
