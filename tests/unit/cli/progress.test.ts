/**
 * B3 (2026-07-13) — `createScanProgress` rendering: an overwriting status
 * line on TTYs, a dot every 25 files on non-TTY streams, `finish()` closes
 * the row. Fake stream, no real console writes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createScanProgress } from '../../../src/cli/progress';

function fakeStream(isTTY: boolean): { out: string[]; stream: NodeJS.WriteStream } {
    const out: string[] = [];
    const stream = {
        isTTY,
        write: (s: string) => {
            out.push(s);
            return true;
        },
    } as unknown as NodeJS.WriteStream;
    return { out, stream };
}

test('createScanProgress: non-TTY prints a dot every 25 files + closing newline', () => {
    const { out, stream } = fakeStream(false);
    const p = createScanProgress(stream);
    for (let i = 0; i < 60; i++) p.onFile(`f${i}.ts`);
    p.finish();
    assert.deepEqual(out, ['.', '.', '\n'], '60 files → 2 dots, then newline');
});

test('createScanProgress: non-TTY under 25 files writes nothing', () => {
    const { out, stream } = fakeStream(false);
    const p = createScanProgress(stream);
    for (let i = 0; i < 5; i++) p.onFile(`f${i}.ts`);
    p.finish();
    assert.deepEqual(out, [], 'small scans stay silent in CI output');
});

test('createScanProgress: TTY overwrites one status line and clears it', () => {
    const { out, stream } = fakeStream(true);
    const p = createScanProgress(stream);
    p.onFile('src/a.ts');
    p.onFile('src/b.ts');
    p.finish();

    assert.equal(out.length, 3, 'two status writes + one clear');
    assert.ok(out[0].startsWith('\r'), 'status line rewinds with \\r');
    assert.ok(out[0].includes('indexed 1 files'), `first status counts 1: ${JSON.stringify(out[0])}`);
    assert.ok(out[1].includes('indexed 2 files — src/b.ts'), 'second status shows current file');
    assert.ok(/^\r +\r$/.test(out[2]), 'finish blanks the line');
});
