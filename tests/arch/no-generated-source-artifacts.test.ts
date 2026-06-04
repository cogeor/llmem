// tests/arch/no-generated-source-artifacts.test.ts
//
// Guards against generated build output ever becoming git-TRACKED under `src/`.
//
// The repo intentionally keeps TypeScript build output (`*.d.ts`,
// `*.d.ts.map`, `*.js`, `*.js.map`, `*.map`) on disk as local artifacts, and
// `.gitignore` already ignores them (see `src/**/*.d.ts`,
// `src/**/*.d.ts.map`). The defect this test catches is one of those files
// slipping into the *tracked* set (e.g. via `git add -f` or a future
// `.gitignore` regression).
//
// Implementation note: we query the GIT INDEX (`git ls-files src`), NOT the
// filesystem. Walking disk would (correctly) find the local build output and
// produce false failures. Only the tracked set matters here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Files that legitimately match the generated-artifact pattern but are
// hand-curated / vendored and therefore allowed to stay tracked.
// Paths are forward-slash, repo-root-relative.
interface AllowEntry {
  readonly path: string;
  readonly reason: string;
}

const ALLOWLIST: readonly AllowEntry[] = [
  {
    path: 'src/webview/libs/vis-network.min.js',
    reason:
      'Vendored third-party visualization library (vis-network). Not a build ' +
      'artifact of this repo; shipped as-is into the webview bundle.',
  },
];

// Matches the generated build-output extensions we never want tracked under
// `src/`: ends with .d.ts, .d.ts.map, .js, .js.map, or .map.
const GENERATED_ARTIFACT = /\.(d\.ts|d\.ts\.map|js|js\.map|map)$/;

function trackedFilesUnderSrc(): string[] {
  const out = execSync('git ls-files src', {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

test('no generated build artifacts are git-tracked under src/', () => {
  const allow = new Set(ALLOWLIST.map((e) => e.path));

  const offenders = trackedFilesUnderSrc().filter(
    (file) => GENERATED_ARTIFACT.test(file) && !allow.has(file)
  );

  if (offenders.length > 0) {
    for (const file of offenders) {
      console.error(
        `TRACKED BUILD ARTIFACT  ${file}\n  ` +
          `Generated output (.d.ts/.d.ts.map/.js/.js.map/.map) must not be ` +
          `committed under src/. Remove it from the index with ` +
          `\`git rm --cached "${file}"\` (the file stays on disk; .gitignore ` +
          `keeps it untracked). If it is a deliberately vendored file, add it ` +
          `to ALLOWLIST in tests/arch/no-generated-source-artifacts.test.ts ` +
          `with a reason.`
      );
    }
    assert.fail(
      `${offenders.length} generated build artifact(s) are git-tracked under src/. ` +
        `See console.error above.`
    );
  }
});
