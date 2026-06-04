// Release pack smoke: build, `npm pack`, install the tarball into an
// isolated temp project + temp HOME, then exercise the package's CLI/MCP
// surface exactly as a user would receive it.
//
// This is deliberately a SOURCE-tree-independent smoke: everything runs
// against the INSTALLED package (node_modules/@cogeor/llmem) so a regression
// that drops a files[] entry, breaks the chokidar import, or reintroduces a
// mandatory native tree-sitter build will FAIL here even though the existing
// `build` CI job (which only compiles + tests the source tree) stays green.
//
// Run: node scripts/pack-smoke.js

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const NPM = IS_WIN ? 'npm.cmd' : 'npm';
const PKG_NAME = '@cogeor/llmem';

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

let stepNum = 0;
function step(msg) {
    stepNum += 1;
    console.log(`\n=== [${stepNum}] ${msg} ===`);
}
function info(msg) { console.log(`  ${msg}`); }
function ok(msg) { console.log(`  OK: ${msg}`); }
function skip(msg) { console.log(`  SKIP: ${msg}`); }

function fail(msg) {
    console.error(`\nSMOKE FAILED: ${msg}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {
        stdio: 'inherit',
        shell: IS_WIN, // npm.cmd needs a shell on Windows
        ...opts,
    });
    if (res.error) throw res.error;
    return res.status;
}

function runCapture(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {
        encoding: 'utf8',
        shell: IS_WIN,
        ...opts,
    });
    if (res.error) throw res.error;
    return res;
}

// ---------------------------------------------------------------------------
// Temp dir / cleanup bookkeeping
// ---------------------------------------------------------------------------

const cleanup = [];
function rmrf(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    // 1a. Full build so every bundle the tarball's files[] references exists.
    //     The tarball ships dist/webview/** (from `build` = build:vscode) AND
    //     dist/claude/cli/main.js + dist/claude/index.js. The claude bundles
    //     are produced by `build:claude` (esbuild) — NOT compile:claude, whose
    //     narrow tsconfig rootDir cannot emit the CLI's cross-tree imports
    //     (see src/scripts/build_claude.ts). So we run both `build` and
    //     `build:claude`; `build:all` would invoke the broken compile:claude.
    step('Build (npm run build + npm run build:claude)');
    if (run(NPM, ['run', 'build'], { cwd: REPO_ROOT }) !== 0) {
        fail('npm run build failed');
    }
    if (run(NPM, ['run', 'build:claude'], { cwd: REPO_ROOT }) !== 0) {
        fail('npm run build:claude failed');
    }
    // Verify the CLI/MCP entry points the tarball ships actually exist.
    for (const rel of ['dist/claude/cli/main.js', 'dist/claude/index.js']) {
        if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
            fail(`expected build output missing: ${rel}`);
        }
    }
    ok('build produced dist/claude/cli/main.js + dist/claude/index.js');

    // 1b. npm pack → tarball.
    step('npm pack');
    const packRes = runCapture(NPM, ['pack', '--silent'], { cwd: REPO_ROOT });
    if (packRes.status !== 0) {
        console.error(packRes.stdout);
        console.error(packRes.stderr);
        fail('npm pack failed');
    }
    // `npm pack` prints the tarball filename on the last non-empty stdout line.
    const lines = (packRes.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let tarballName = lines.reverse().find(l => l.endsWith('.tgz'));
    if (!tarballName) {
        // Fallback: locate the freshest .tgz in the repo root.
        const tgz = fs.readdirSync(REPO_ROOT)
            .filter(f => f.endsWith('.tgz'))
            .map(f => ({ f, m: fs.statSync(path.join(REPO_ROOT, f)).mtimeMs }))
            .sort((a, b) => b.m - a.m);
        if (tgz.length === 0) fail('could not locate produced .tgz');
        tarballName = tgz[0].f;
    }
    const tarballPath = path.resolve(REPO_ROOT, tarballName);
    cleanup.push(() => rmrf(tarballPath));
    ok(`tarball: ${tarballName}`);

    // 1c. Temp project + temp HOME (isolate from global/user config).
    step('Create temp project + temp HOME');
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-smoke-'));
    cleanup.push(() => rmrf(tmpBase));
    const tempHome = path.join(tmpBase, 'home');
    const tempProj = path.join(tmpBase, 'proj');
    fs.mkdirSync(tempHome, { recursive: true });
    fs.mkdirSync(tempProj, { recursive: true });

    // Isolated env: HOME/USERPROFILE (+ APPDATA/LOCALAPPDATA on win32) point at
    // the temp HOME so no user/global npm or app config leaks in.
    const childEnv = {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
    };
    if (IS_WIN) {
        childEnv.APPDATA = path.join(tempHome, 'AppData', 'Roaming');
        childEnv.LOCALAPPDATA = path.join(tempHome, 'AppData', 'Local');
        fs.mkdirSync(childEnv.APPDATA, { recursive: true });
        fs.mkdirSync(childEnv.LOCALAPPDATA, { recursive: true });
    }
    // Minimal package.json so `npm i` has a project to install into.
    fs.writeFileSync(
        path.join(tempProj, 'package.json'),
        JSON.stringify({ name: 'llmem-smoke-consumer', version: '0.0.0', private: true }, null, 2),
    );
    ok(`temp project: ${tempProj}`);
    info(`temp HOME: ${tempHome}`);

    // 1d. Install the tarball. tree-sitter is an optionalDependency (PH-02), so
    //     even if npm tries and fails to build it (no C toolchain), the install
    //     still completes — that's the whole point of this assertion. We do NOT
    //     pass --ignore-optional; we let npm attempt it and tolerate failure.
    step('Install tarball into temp project');
    const installStatus = run(
        NPM,
        ['i', tarballPath, '--no-audit', '--no-fund'],
        { cwd: tempProj, env: childEnv },
    );
    if (installStatus !== 0) {
        fail('npm i <tarball> failed (install must succeed even without a C toolchain)');
    }
    const installedRoot = path.join(tempProj, 'node_modules', '@cogeor', 'llmem');
    if (!fs.existsSync(installedRoot)) {
        fail(`installed package not found at ${installedRoot}`);
    }
    // Resolve the bin we will invoke as `node <bin-js>` (avoids .cmd shim issues
    // and keeps it portable). bin/llmem is a Node shim that requires
    // dist/claude/cli/main.js.
    const binJs = path.join(installedRoot, 'bin', 'llmem');
    if (!fs.existsSync(binJs)) {
        fail(`installed bin missing: ${binJs} (files[] regression?)`);
    }
    // Sanity-check the bundles the bin needs are actually shipped.
    for (const rel of ['dist/claude/cli/main.js', 'dist/claude/index.js']) {
        if (!fs.existsSync(path.join(installedRoot, rel))) {
            fail(`tarball missing ${rel} (files[] regression?)`);
        }
    }
    ok('tarball installed; bin + dist entry points present');

    // Helper: invoke the installed CLI as `node <bin-js> ...`.
    const NODE = process.execPath;
    function cli(args, opts = {}) {
        // shell:false — NODE is an absolute path that may contain spaces
        // ("C:\Program Files\nodejs\node.exe"); a shell would mis-split it.
        return runCapture(NODE, [binJs, ...args], {
            cwd: tempProj,
            env: childEnv,
            shell: false,
            ...opts,
        });
    }

    // 2a. describe — exit 0. Capture the command list for the install
    //     soft-dependency check below.
    let describeOut = '';
    step('llmem describe');
    {
        const r = cli(['describe']);
        if (r.status !== 0) {
            console.error(r.stdout);
            console.error(r.stderr);
            fail('llmem describe exited non-zero');
        }
        if (!/COMMANDS:/.test(r.stdout)) {
            console.error(r.stdout);
            fail('llmem describe did not print a command tree');
        }
        describeOut = r.stdout;
        ok('describe exited 0 and printed commands');
    }

    // 2b. serve --no-open --port 0 — bind ephemeral, print ready, then kill.
    step('llmem serve --no-open --port 0');
    await smokeServe(NODE, binJs, tempProj, childEnv);

    // 2c. scan a tiny .ts fixture — exit 0, edge lists written. This must work
    //     with NO tree-sitter grammar installed (TS support is built-in).
    step('llmem scan (tiny .ts fixture)');
    {
        const fixtureSrc = path.join(tempProj, 'fixture', 'src');
        fs.mkdirSync(fixtureSrc, { recursive: true });
        fs.writeFileSync(
            path.join(fixtureSrc, 'a.ts'),
            "export function add(x: number, y: number): number { return x + y; }\n",
        );
        fs.writeFileSync(
            path.join(fixtureSrc, 'b.ts'),
            "import { add } from './a';\nexport const two = add(1, 1);\n",
        );
        const fixtureRoot = path.join(tempProj, 'fixture');
        const r = cli(['scan', '--workspace', fixtureRoot], { cwd: fixtureRoot });
        if (r.status !== 0) {
            console.error(r.stdout);
            console.error(r.stderr);
            fail('llmem scan exited non-zero');
        }
        const importEdges = path.join(fixtureRoot, '.artifacts', 'import-edgelist.json');
        const callEdges = path.join(fixtureRoot, '.artifacts', 'call-edgelist.json');
        if (!fs.existsSync(importEdges)) fail(`scan did not write ${importEdges}`);
        if (!fs.existsSync(callEdges)) fail(`scan did not write ${callEdges}`);
        ok('scan exited 0 and wrote import-edgelist.json + call-edgelist.json');
    }

    // 2d. mcp handshake — initialize + tools/list over stdio.
    step('llmem mcp (stdio handshake: initialize + tools/list)');
    await smokeMcp(NODE, binJs, tempProj, childEnv);

    // 2e. install --dry-run --print — SOFT dependency (lands in a later plan,
    //     LI). The CLI's unknown-command path prints help and exits 0, so an
    //     exit-code check alone is not enough — the authoritative signal is
    //     whether `install` is a registered command in `describe`'s output.
    step('llmem install --dry-run --print (soft dependency)');
    {
        const registered = /\binstall\b/.test(describeOut);
        if (!registered) {
            skip('llmem install not yet implemented — skipping; re-enable once LI lands');
        } else {
            const r = cli(['install', '--dry-run', '--print']);
            if (r.status !== 0) {
                console.error(r.stdout);
                console.error(r.stderr);
                fail('llmem install --dry-run --print exited non-zero');
            }
            ok('llmem install --dry-run --print exited 0');
        }
    }

    console.log('\nSMOKE PASSED: all package surfaces green.');
}

// ---------------------------------------------------------------------------
// serve: spawn, wait for ready line on stdout/stderr, then kill.
// ---------------------------------------------------------------------------

function smokeServe(node, binJs, cwd, env) {
    return new Promise((resolve) => {
        const child = spawn(node, [binJs, 'serve', '--no-open', '--port', '0'], {
            cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let out = '';
        let settled = false;
        // Server logs ("LLMem Graph Server ready" / "Server running") go to
        // stderr via the structured logger; serve.ts status lines go to stdout.
        // Watch both.
        const onData = (d) => {
            out += d.toString();
            if (!settled && /(Server running|Graph Server ready|Server listening|http:\/\/127\.0\.0\.1:\d+)/i.test(out)) {
                settled = true;
                ok('serve bound and printed a ready line');
                kill();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                console.error(out);
                kill();
                fail('serve did not print a ready line within timeout');
            }
        }, 30000);

        function kill() {
            clearTimeout(timer);
            try {
                if (IS_WIN) {
                    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
                } else {
                    child.kill('SIGINT');
                    // Hard-kill fallback if it ignores SIGINT.
                    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
                }
            } catch { /* already gone */ }
        }

        child.on('exit', () => resolve());
        child.on('error', (e) => {
            if (!settled) { settled = true; clearTimeout(timer); fail(`serve spawn error: ${e.message}`); }
            resolve();
        });
    });
}

// ---------------------------------------------------------------------------
// mcp: spawn stdio server, send initialize + tools/list JSON-RPC, assert tools.
// ---------------------------------------------------------------------------

function smokeMcp(node, binJs, cwd, env) {
    return new Promise((resolve) => {
        const child = spawn(node, [binJs, 'mcp'], {
            cwd,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let buf = '';
        let stderr = '';
        let settled = false;
        let sentList = false;
        const EXPECTED = ['file_info', 'folder_info', 'open_window'];

        function send(obj) {
            child.stdin.write(JSON.stringify(obj) + '\n');
        }

        function finish(failMsg) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
                else child.kill('SIGTERM');
            } catch { /* gone */ }
            if (failMsg) {
                console.error(stderr);
                fail(failMsg);
            }
            resolve();
        }

        child.stderr.on('data', (d) => { stderr += d.toString(); });

        child.stdout.on('data', (d) => {
            buf += d.toString();
            // Process complete newline-delimited JSON-RPC frames.
            let idx;
            while ((idx = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }

                // initialize response → request tools/list.
                if (msg.id === 1 && msg.result && !sentList) {
                    sentList = true;
                    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
                    continue;
                }
                // tools/list response → assert tool names.
                if (msg.id === 2 && msg.result) {
                    const tools = (msg.result.tools || []).map(t => t.name);
                    const missing = EXPECTED.filter(n => !tools.includes(n));
                    if (missing.length > 0) {
                        finish(`tools/list missing expected tools: ${missing.join(', ')} (got: ${tools.join(', ')})`);
                        return;
                    }
                    ok(`mcp handshake ok; tools/list returned ${tools.length} tools incl. ${EXPECTED.join('/')}`);
                    finish();
                    return;
                }
            }
        });

        child.on('error', (e) => finish(`mcp spawn error: ${e.message}`));
        child.on('exit', (code) => {
            if (!settled) finish(`mcp server exited (code ${code}) before completing handshake`);
        });

        const timer = setTimeout(() => finish('mcp handshake timed out'), 30000);

        // Kick off the handshake.
        send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'llmem-pack-smoke', version: '0.0.0' },
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

(async () => {
    try {
        await main();
    } finally {
        // Best-effort cleanup of temp dirs + tarball.
        for (const fn of cleanup.reverse()) {
            try { fn(); } catch { /* ignore */ }
        }
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
