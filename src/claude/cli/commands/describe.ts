/**
 * `llmem describe` — machine-readable command schema.
 *
 * Walks REGISTRY (skipping `hidden: true`), emits either a human-readable
 * tree (default) or a stable JSON document (`--json`). The JSON shape is
 * the agent integration surface for design/06; the human path is a
 * registry-driven mirror of `--help` so drift between the two is impossible.
 *
 * Loop 04 introduces this command. Loop 07 may merge it with `printHelp`
 * in main.ts; for now they live separately.
 */

import { z } from 'zod';
import type { CommandSpec } from '../registry';
import { REGISTRY } from '../registry';

// Same idiom as src/mcp/server.ts:26-28 — `require` keeps TypeScript's deep
// type inference from blowing up `compile:claude` against zod-to-json-schema.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { zodToJsonSchema } = require('zod-to-json-schema');

// Repo-root package.json. Path is relative to dist/claude/cli/commands/
// (compile output) — `../../../../package.json` from src/claude/cli/commands/
// resolves to the same file at runtime because tsconfig.claude.json keeps
// the rootDir/outDir symmetry.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const PACKAGE_VERSION: string = require('../../../../package.json').version as string;

const describeArgs = z.object({
    json: z.boolean().default(false),
});

interface DescribedCommand {
    name: string;
    description: string;
    args: unknown;          // zod-to-json-schema output — typed loosely on purpose
    examples: { scenario: string; command: string }[];
}

interface DescribeOutput {
    version: string;
    binary: 'llmem';
    commands: DescribedCommand[];
}

export function buildDescribeOutput(): DescribeOutput {
    const commands: DescribedCommand[] = [];
    for (const cmd of REGISTRY) {
        if (cmd.hidden) continue;
        commands.push({
            name: cmd.name,
            description: cmd.description,
            args: zodToJsonSchema(cmd.args),
            examples: cmd.examples ?? [],
        });
    }
    return { version: PACKAGE_VERSION, binary: 'llmem', commands };
}

/**
 * Stable, deterministic JSON serializer. Sorts object keys recursively so
 * snapshot diffs and `jq` output are reproducible across runs and Node
 * versions. Arrays preserve order (their order is meaningful — REGISTRY
 * order survives).
 */
export function stableStringify(value: unknown, indent = 2): string {
    const seen = new WeakSet<object>();
    const visit = (v: unknown): unknown => {
        if (v === null || typeof v !== 'object') return v;
        if (seen.has(v as object)) throw new Error('cycle in describe output');
        seen.add(v as object);
        if (Array.isArray(v)) return v.map(visit);
        const sortedKeys = Object.keys(v as Record<string, unknown>).sort();
        const out: Record<string, unknown> = {};
        for (const k of sortedKeys) out[k] = visit((v as Record<string, unknown>)[k]);
        return out;
    };
    return JSON.stringify(visit(value), null, indent);
}

function printHumanTree(out: DescribeOutput): void {
    // Header line: binary + version (mirrors the JSON top-level fields).
    console.log(`${out.binary} ${out.version}`);
    console.log('');
    console.log('COMMANDS:');
    for (const cmd of out.commands) {
        console.log(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
    }
    console.log('');
    // Per-command flag summary. We pull flag names + descriptions from the
    // JSON-schema'd args.properties — same source the JSON output uses, so
    // human and JSON paths cannot drift.
    for (const cmd of out.commands) {
        const argsSchema = cmd.args as {
            properties?: Record<string, { description?: string; type?: string }>;
            required?: string[];
        };
        const props = argsSchema.properties ?? {};
        const propNames = Object.keys(props);
        if (propNames.length === 0) continue;
        console.log(`  ${cmd.name}:`);
        for (const p of propNames.sort()) {
            const desc = props[p].description ?? `<${props[p].type ?? 'unknown'}>`;
            console.log(`    --${p}    ${desc}`);
        }
        console.log('');
    }
}

export const describeCommand: CommandSpec<typeof describeArgs> = {
    name: 'describe',
    description: 'Print the machine-readable command schema (--json) or a human tree.',
    examples: [
        { scenario: 'Print the human-readable command tree', command: 'llmem describe' },
        { scenario: 'Emit the full JSON schema for agent integration', command: 'llmem describe --json' },
    ],
    args: describeArgs,
    async run(args) {
        const out = buildDescribeOutput();
        if (args.json) {
            // Stable, sorted-key JSON + single trailing \n (no os.EOL).
            process.stdout.write(stableStringify(out) + '\n');
            return;
        }
        printHumanTree(out);
    },
};
