// Remove ONLY gitignored TypeScript build emit under src/ (.js, .js.map,
// .d.ts, .d.ts.map). It never touches git-tracked source files: the
// candidate list comes from `git ls-files -o -i --exclude-standard`, which
// lists only untracked-and-ignored paths. Used by `npm run clean`.

const fs = require('fs');
const cp = require('child_process');

const EMIT_RE = /\.(d\.ts|d\.ts\.map|js|js\.map)$/;

const ignored = cp
    .execSync('git ls-files -o -i --exclude-standard -- src', { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);

let removed = 0;
for (const rel of ignored) {
    if (EMIT_RE.test(rel)) {
        fs.rmSync(rel, { force: true });
        removed++;
    }
}

console.log(`clean-src-emit: removed ${removed} gitignored build file(s) under src/`);
