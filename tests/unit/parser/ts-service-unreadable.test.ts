/**
 * D6 (2026-07-13) — the TS file-discovery walk used to swallow stat/readdir
 * failures with a bare `catch { continue }`: an unreadable file or subtree
 * silently vanished from the ts.Program (and therefore from the entire
 * graph) with no trace anywhere. The walk now records each skipped path
 * (`getSkippedUnreadable()`) and warns per occurrence.
 *
 * The service takes an injectable fs seam, so the throwing stat is
 * simulated portably (no platform permission tricks).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { TypeScriptService, type TsServiceFs } from '../../../src/parser/ts-service';

function fixtureWorkspace(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-tssvc-'));
    fs.mkdirSync(path.join(tmp, 'src', 'locked'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'good.ts'), 'export const g = 1;\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'src', 'bad.ts'), 'export const b = 2;\n', 'utf8');
    fs.writeFileSync(path.join(tmp, 'src', 'locked', 'hidden.ts'), 'export const h = 3;\n', 'utf8');
    return tmp;
}

test('a throwing statSync records the skipped path; the rest of the walk survives', () => {
    const tmp = fixtureWorkspace();
    try {
        const badPath = path.join(tmp, 'src', 'bad.ts');
        const seam: TsServiceFs = {
            readdirSync: (d) => fs.readdirSync(d),
            statSync: (p) => {
                if (p === badPath) throw new Error('EACCES simulated');
                return fs.statSync(p);
            },
        };

        const service = new TypeScriptService(tmp, seam);
        const skipped = service.getSkippedUnreadable();
        assert.deepEqual(skipped, [badPath], 'the unreadable file is recorded');

        // The remaining files still made it into the program.
        const program = service.getProgram();
        assert.ok(program, 'program built despite the unreadable file');
        const roots = program!.getRootFileNames().map(f => path.basename(f)).sort();
        assert.ok(roots.includes('good.ts'), `good.ts survives: ${roots.join(', ')}`);
        assert.ok(!roots.includes('bad.ts'), 'bad.ts skipped');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('a throwing readdirSync records the skipped SUBTREE', () => {
    const tmp = fixtureWorkspace();
    try {
        const lockedDir = path.join(tmp, 'src', 'locked');
        const seam: TsServiceFs = {
            readdirSync: (d) => {
                if (d === lockedDir) throw new Error('EACCES simulated');
                return fs.readdirSync(d);
            },
            statSync: (p) => fs.statSync(p),
        };

        const service = new TypeScriptService(tmp, seam);
        assert.deepEqual(service.getSkippedUnreadable(), [lockedDir]);

        const roots = service.getProgram()!.getRootFileNames().map(f => path.basename(f));
        assert.ok(!roots.includes('hidden.ts'), 'locked subtree contents absent');
        assert.ok(roots.includes('good.ts'), 'siblings unaffected');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('clean walk records nothing', () => {
    const tmp = fixtureWorkspace();
    try {
        const service = new TypeScriptService(tmp);
        assert.deepEqual(service.getSkippedUnreadable(), []);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
