/**
 * Webview asset-root discovery for the web launcher (Loop 15 split).
 *
 * Carved verbatim from the former `web-launcher.ts` monolith: the
 * package-root walk-ups (`findRepoRoot` / `findInstalledPackageRoot` /
 * the shared `findLlmemPackageRoot`), the `__testHooks` override seam, and
 * `resolveAssetRoot` (the priority-ordered probe that locates the directory
 * containing `index.html` / `main.js` / `styles/` / `libs/`).
 *
 * Re-exported through the `web-launcher.ts` barrel so existing import sites
 * keep working unchanged.
 */

import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../common/logger';

const log = createLogger('web-launcher');

/**
 * Walk up from `process.cwd()` looking for a `package.json` whose
 * `name === '@cogeor/llmem'`. Returns the first match's directory or `null` if
 * we hit the filesystem root without finding one.
 *
 * Used by `resolveAssetRoot` as a fallback when neither an explicit
 * `assetRoot` nor a `<workspaceRoot>/dist/webview` is available.
 */
export function findRepoRoot(): string | null {
    return findLlmemPackageRoot(process.cwd());
}

/**
 * Walk up from this file's directory looking for a `package.json` whose
 * `name === '@cogeor/llmem'`. Reliably finds the install root when llmem is run
 * from a global npm install (where cwd is the user's repo, not ours).
 *
 * In dev (ts-node) this resolves up from `<repo>/src/...` → `<repo>`.
 * In compiled CommonJS this resolves up from `<install>/dist/...` → `<install>`.
 * For global npm installs `<install>` is e.g.
 * `<global>/lib/node_modules/llmem`, whose `package.json` carries
 * `name === '@cogeor/llmem'` so the walk-up matches.
 *
 * Returns null if the walk hits the filesystem root without finding it.
 */
export function findInstalledPackageRoot(): string | null {
    // CommonJS — `__dirname` is universal. (tsconfig.base.json sets
    // `module: commonjs`.) If the project ever switches to ESM, swap to
    // `path.dirname(fileURLToPath(import.meta.url))`.
    return findLlmemPackageRoot(__dirname);
}

/**
 * Test seam: `resolveAssetRoot` calls through these references rather
 * than the exported helpers directly so unit tests can override either
 * walk-up. Setting both to functions returning `null` lets tests
 * exercise the "nothing resolves" failure path even when running from
 * inside the real llmem checkout (where `__dirname` would otherwise
 * always find a valid `dist/webview`).
 *
 * Production code should never touch these — use the exported helpers.
 */
export const __testHooks = {
    findRepoRoot: (): string | null => findRepoRoot(),
    findInstalledPackageRoot: (): string | null => findInstalledPackageRoot(),
};

/**
 * Shared walk-up: starting from `from`, climb the directory tree looking
 * for a `package.json` whose `name === '@cogeor/llmem'`. Returns the first
 * match's directory or `null` on filesystem-root miss.
 */
function findLlmemPackageRoot(from: string): string | null {
    let current = from;
    const root = path.parse(current).root;

    while (current !== root) {
        const pkgPath = path.join(current, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                if (pkg && pkg.name === '@cogeor/llmem') {
                    return current;
                }
            } catch {
                // ignore parse failures, keep walking
            }
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

/**
 * Resolve the directory containing webview assets.
 *
 * Priority order:
 *   1. `options.assetRoot` if set and `<assetRoot>/index.html` exists.
 *   2. `<options.workspaceRoot>/dist/webview/index.html`.
 *   3. `<repoRoot>/dist/webview/index.html` (repo found via cwd walk-up;
 *      canonical path for dev workflows where the user is editing llmem
 *      itself, so cwd-relative resolution stays primary).
 *   4. `<installedRoot>/dist/webview/index.html` (install dir found via
 *      `__dirname` walk-up; this is the global-npm-install path — cwd is
 *      the user's repo, not ours, so the cwd walk in (3) misses).
 *   5. `<repoRoot>/src/webview/index.html` (development fallback; warns).
 *
 * Throws "Webview assets not found" listing every probed path if none
 * resolved. The error deliberately omits any compile-time directory
 * reference — that carries no diagnostic value under the new model.
 */
export function resolveAssetRoot(opts: { workspaceRoot?: string; assetRoot?: string }): string {
    const probed: string[] = [];

    // 1. Explicit assetRoot wins.
    if (opts.assetRoot) {
        const indexPath = path.join(opts.assetRoot, 'index.html');
        probed.push(`assetRoot: ${indexPath}`);
        if (fs.existsSync(indexPath)) {
            return opts.assetRoot;
        }
    }

    // 2. Workspace-root-relative dist/webview.
    if (opts.workspaceRoot) {
        const wsAssets = path.join(opts.workspaceRoot, 'dist', 'webview');
        const wsIndex = path.join(wsAssets, 'index.html');
        probed.push(`workspaceRoot: ${wsIndex}`);
        if (fs.existsSync(wsIndex)) {
            return wsAssets;
        }
    }

    // 3. Repo-root walk-up from cwd → dist/webview. Canonical path for
    // dev (running llmem from its own checkout).
    const repoRoot = __testHooks.findRepoRoot();
    if (repoRoot) {
        const repoDist = path.join(repoRoot, 'dist', 'webview');
        const repoDistIndex = path.join(repoDist, 'index.html');
        probed.push(`repoRoot/dist: ${repoDistIndex}`);
        if (fs.existsSync(repoDistIndex)) {
            return repoDist;
        }
    } else {
        probed.push('repoRoot: <not found> (no package.json with name="@cogeor/llmem" walking up from process.cwd())');
    }

    // 4. Install-root walk-up from `__dirname` → dist/webview. Catches
    // the global-npm-install case: cwd is the user's repo, but our
    // compiled `web-launcher.js` lives under the install dir.
    const installedRoot = __testHooks.findInstalledPackageRoot();
    if (installedRoot) {
        const installDist = path.join(installedRoot, 'dist', 'webview');
        const installDistIndex = path.join(installDist, 'index.html');
        probed.push(`installedRoot/dist: ${installDistIndex}`);
        if (fs.existsSync(installDistIndex)) {
            return installDist;
        }
    } else {
        probed.push('installedRoot: <not found> (no package.json with name="@cogeor/llmem" walking up from this module\'s install location)');
    }

    // 5. Development fallback: src/webview (no index.html check —
    // the webview generator can render directly from source). Warn
    // because this means the dev hasn't run `npm run build:webview`.
    if (repoRoot) {
        const repoSrc = path.join(repoRoot, 'src', 'webview');
        probed.push(`repoRoot/src: ${repoSrc}`);
        if (fs.existsSync(repoSrc)) {
            log.warn(
                'Using src/webview fallback (development only). Run "npm run build:webview" to generate dist/webview.',
                { assetRoot: repoSrc },
            );
            return repoSrc;
        }
    }

    throw new Error(
        `Webview assets not found. Probed (in order):\n` +
        probed.map((p) => `  - ${p}`).join('\n') + '\n' +
        `Pass an explicit \`assetRoot\` option or run "npm run build:webview" to generate dist/webview.`,
    );
}
