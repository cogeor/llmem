/**
 * Integration test for `bin/llmem describe [--json]`.
 *
 * Loop 04 contract:
 *   1. `describe` (no flags) exits 0 and lists every non-hidden REGISTRY
 *      command name in stdout.
 *   2. `describe --json` exits 0 and emits valid JSON parseable as the
 *      DescribeOutput shape (version / binary / commands).
 *   3. The JSON validates against an in-test meta-schema (Zod) — every
 *      command has at least one example, every command has a non-empty
 *      description, every command's args is a JSON-schema object.
 *   4. Every non-hidden REGISTRY command name appears in the JSON, and no
 *      orphan commands appear that are not in REGISTRY.
 *   5. No orphan flag: every property in `cmd.args.properties` exists in
 *      the corresponding REGISTRY entry's Zod schema shape.
 *   6. The spawned-process JSON output deep-equals the in-process
 *      `buildDescribeOutput()` return value (modulo serialization).
 *
 * Cross-platform notes:
 * - `spawn('node', [BIN, ...])` rather than `spawn(BIN, ...)`. On Windows
 *   the npm `.cmd` wrapper would otherwise be invoked; calling `node`
 *   explicitly bypasses it and tests the actual JS shim.
 * - Stdout is normalized via `.replace(/\r\n/g, '\n')` before any string
 *   assertion or `JSON.parse` (Windows `node` may emit `\r\n` line
 *   endings into pipes).
 * - `FORCE_COLOR=0` in the spawn env so the structured logger doesn't
 *   inject ANSI codes if `describe` ever logs through it (it currently
 *   doesn't, but defensive).
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { z } from 'zod';

import { REGISTRY } from '../../../src/claude/cli/registry';
import { buildDescribeOutput } from '../../../src/claude/cli/commands/describe';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'llmem');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'claude', 'cli', 'main.js');

function ensureBuilt(): void {
    if (!fs.existsSync(DIST_MAIN)) {
        throw new Error(
            `Expected ${DIST_MAIN} to exist. Run \`npm run build:claude\` before \`npm run test:integration\`.`,
        );
    }
}

function normalizeStdout(s: string): string {
    return s.replace(/\r\n/g, '\n');
}

function spawnDescribe(extraArgs: string[] = []): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync('node', [BIN, 'describe', ...extraArgs], {
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
    });
    return {
        stdout: normalizeStdout(result.stdout ?? ''),
        stderr: normalizeStdout(result.stderr ?? ''),
        status: result.status,
    };
}

// -----------------------------------------------------------------------------
// Meta-schema (defined in the test, not imported from source — this is the
// regression catcher for source-side schema drift).
// -----------------------------------------------------------------------------
const ExampleSchema = z.object({
    scenario: z.string().min(1),
    command: z.string().min(1),
});
const CommandEntrySchema = z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    args: z.object({}).passthrough(),
    examples: z.array(ExampleSchema).min(1),
});
const DescribeOutputSchema = z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+/),
    binary: z.literal('llmem'),
    commands: z.array(CommandEntrySchema).min(1),
});

test('bin/llmem describe (no flags) exits 0 and lists every non-hidden command name', () => {
    ensureBuilt();
    const { stdout, stderr, status } = spawnDescribe();
    assert.equal(status, 0, `expected exit 0, got ${status}; stderr=${stderr}`);

    for (const cmd of REGISTRY) {
        if (cmd.hidden) continue;
        assert.match(stdout, new RegExp(`\\b${cmd.name}\\b`), `human tree mentions '${cmd.name}'`);
    }
    // Forward-compat: when a command is hidden, it must NOT appear. In loop 04
    // none are hidden, so this loop is a no-op iteration; loop 07 will exercise it.
    for (const cmd of REGISTRY) {
        if (!cmd.hidden) continue;
        assert.ok(!stdout.includes(cmd.name), `hidden command '${cmd.name}' must not appear`);
    }
});

test('bin/llmem describe --json exits 0 and emits valid JSON', () => {
    ensureBuilt();
    const { stdout, stderr, status } = spawnDescribe(['--json']);
    assert.equal(status, 0, `expected exit 0, got ${status}; stderr=${stderr}`);
    assert.doesNotThrow(() => JSON.parse(stdout));
});

test('bin/llmem describe --json output validates against meta-schema', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout);
    DescribeOutputSchema.parse(parsed);
});

test('every non-hidden REGISTRY command appears in describe --json (no missing, no orphan)', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as { commands: { name: string }[] };

    const expected = REGISTRY.filter(c => !c.hidden).map(c => c.name).sort();
    const actual = parsed.commands.map(c => c.name).sort();
    assert.deepEqual(actual, expected);
});

test('no orphan flags — every cmd.args.properties key matches the REGISTRY Zod shape', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const parsed = JSON.parse(stdout) as {
        commands: { name: string; args: { properties?: Record<string, unknown> } }[];
    };

    for (const describedCmd of parsed.commands) {
        const registryEntry = REGISTRY.find(c => c.name === describedCmd.name);
        assert.ok(registryEntry, `described command '${describedCmd.name}' has a REGISTRY entry`);
        const argsSchema = registryEntry.args;
        assert.ok(
            argsSchema instanceof z.ZodObject,
            `REGISTRY entry '${describedCmd.name}' uses a ZodObject schema`,
        );
        const shape = (argsSchema as z.ZodObject<z.ZodRawShape>).shape;
        const shapeKeys = new Set(Object.keys(shape));
        const propKeys = Object.keys(describedCmd.args.properties ?? {});
        for (const key of propKeys) {
            assert.ok(
                shapeKeys.has(key),
                `flag '${key}' on command '${describedCmd.name}' exists in the Zod shape`,
            );
        }
    }
});

test('spawned describe --json deep-equals in-process buildDescribeOutput()', () => {
    ensureBuilt();
    const { stdout, status } = spawnDescribe(['--json']);
    assert.equal(status, 0);
    const fromSpawn = JSON.parse(stdout);
    const fromInProcess = JSON.parse(JSON.stringify(buildDescribeOutput()));
    assert.deepEqual(fromSpawn, fromInProcess);
});
