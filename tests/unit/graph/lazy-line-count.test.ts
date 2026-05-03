// tests/unit/graph/lazy-line-count.test.ts
//
// Loop 16 — pin the line-count helpers against a deterministic fixture so
// the wrong-vs-right counts diverge by orders of magnitude.
//
// The pre-Loop-16 bug: `sf.getEnd()` returned a CHARACTER offset (the
// absolute byte position of the source-file end), not a line count, and
// was being summed into `totalCodebaseLines` against a 10000-line
// threshold. Even tiny TS projects tripped lazy mode on every load.
//
// Fixture: tests/fixtures/lazy-line-count/sample.ts. Pinned line count
// computed at fixture-creation time. If a future contributor modifies the
// fixture, this number must be updated.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { countFileLines } from '../../../src/parser/line-counter';

const FIXTURE = path.resolve(
    __dirname,
    '../../fixtures/lazy-line-count/sample.ts',
);

// Pinned: see the fixture file's header comment. 29 lines total, including
// the trailing newline-only "line" produced by `split('\n')`.
const EXPECTED_LINES = 29;

test('lazy-line-count: countFileLines matches the pinned fixture line count', () => {
    const lines = countFileLines(FIXTURE);
    assert.equal(lines, EXPECTED_LINES);
});

test('lazy-line-count: bug regression — sf.getEnd() and getLineStarts().length disagree by orders of magnitude', () => {
    const fileText = fs.readFileSync(FIXTURE, 'utf-8');
    const sf = ts.createSourceFile(
        'sample.ts',
        fileText,
        ts.ScriptTarget.Latest,
        true,
    );
    const charOffset = sf.getEnd();
    const lineCount = sf.getLineStarts().length;
    // Pin the divergence: charOffset must be at least 10x the line count.
    // For our fixture, charOffset is ~637 and lineCount is 29.
    assert.ok(
        charOffset > lineCount * 10,
        `expected sf.getEnd() (${charOffset}) >> getLineStarts().length (${lineCount}); ` +
            `if this fails, the bug's signature has changed and the test must be re-pinned.`,
    );
});

test('lazy-line-count: sf.getLineStarts().length agrees with countFileLines on the fixture', () => {
    const fileText = fs.readFileSync(FIXTURE, 'utf-8');
    const sf = ts.createSourceFile(
        'sample.ts',
        fileText,
        ts.ScriptTarget.Latest,
        true,
    );
    // Cross-implementation invariant: both methods count the same lines.
    // The broken sf.getEnd() does not — see the regression test above.
    assert.equal(sf.getLineStarts().length, countFileLines(FIXTURE));
});

test('lazy-line-count: countFileLines of an empty file is 0 (not 1 from "".split)', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llmem-empty-'));
    const empty = path.join(dir, 'empty.ts');
    fs.writeFileSync(empty, '');
    try {
        assert.equal(countFileLines(empty), 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('lazy-line-count: countFileLines of an unreadable path returns 0', () => {
    const result = countFileLines('/nonexistent/path/that/does/not/exist.ts');
    assert.equal(result, 0);
});
