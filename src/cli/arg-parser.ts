/**
 * LLMem CLI — argv parsing and flag coercion.
 *
 * Split out of `main.ts` (loop 20, phase 15) so the entry shell stays under
 * the 250-line platform budget. This module holds the cohesive "argv →
 * typed flags + command" group: the trivial argv tokenizer, the
 * kebab→camel flag normalizer, and the Zod-aware string→number coercion.
 * Help-text formatting moved to `./help` (B2, same budget reason).
 */

import { z } from 'zod';

import { REGISTRY, type CommandSpec } from './registry';
import { CliError } from './errors';

/**
 * Trivial argv → flag-map parser. ~50 lines, no external dep.
 *
 * Rules:
 *  - First positional that matches a `name` or `alias` in REGISTRY selects the command.
 *  - Remaining positionals collected into `_` array.
 *  - `--foo bar` → `{ foo: 'bar' }` (when `bar` doesn't start with `-`).
 *  - `--foo=bar` → `{ foo: 'bar' }`.
 *  - `--foo` followed by another flag or end of argv → `{ foo: true }`.
 *  - `--no-foo` → `{ foo: false }`.
 *  - Short aliases (-p, -w, -r, -o, -v, -h) handled inline below to match the
 *    old cli.ts:46-100 behavior verbatim.
 *  - Numeric coercion: deferred to Zod via `z.coerce.*` in command schemas, OR
 *    we can emit numbers when the value parses cleanly. We take the simpler
 *    route and emit the raw string; then we coerce at validate time below
 *    using a per-schema pre-process step (see dispatcher).
 */
export interface ParsedArgv {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    command: CommandSpec<any> | null;
    flagMap: Record<string, unknown>;
    helpRequested: boolean;
    versionRequested: boolean;
}

const SHORT_ALIASES: Record<string, string> = {
    p: 'port',
    w: 'workspace',
    r: 'regenerate',
    o: 'open',
    v: 'verbose',
    V: 'version',
    h: 'help',
};

function findCommand(name: string): CommandSpec | undefined {
    return REGISTRY.find(c => c.name === name || (c.aliases && c.aliases.includes(name)));
}

/**
 * Normalize a long-flag key to the camelCase form used in Zod schemas.
 *
 * `--prompt-only` → `promptOnly`. Single-word flags pass through. Used so
 * commands can declare schemas with conventional camelCase identifiers
 * (`promptOnly: z.boolean()`) while users type kebab-case on the CLI
 * (`--prompt-only`). Loop 06 introduces this when the `document` command
 * adds the first multi-word flag.
 */
function kebabToCamel(key: string): string {
    return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function parseArgv(argv: string[]): ParsedArgv {
    const flagMap: Record<string, unknown> = {};
    const positional: string[] = [];
    let helpRequested = false;
    let versionRequested = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        // Long flags
        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=');
            if (eqIdx !== -1) {
                const rawKey = arg.slice(2, eqIdx);
                const value = arg.slice(eqIdx + 1);
                if (rawKey === 'help') { helpRequested = true; continue; }
                flagMap[kebabToCamel(rawKey)] = value;
                continue;
            }
            const rawKey = arg.slice(2);
            if (rawKey === 'help') { helpRequested = true; continue; }
            if (rawKey === 'version') { versionRequested = true; continue; }
            if (rawKey.startsWith('no-')) {
                flagMap[kebabToCamel(rawKey.slice(3))] = false;
                continue;
            }
            const key = kebabToCamel(rawKey);
            // Look ahead for a value. Special case: bare `-` is the
            // conventional stdin sentinel and IS a value, not a flag.
            const next = argv[i + 1];
            if (next !== undefined && (next === '-' || !next.startsWith('-'))) {
                flagMap[key] = next;
                i++;
            } else {
                flagMap[key] = true;
            }
            continue;
        }

        // Short flags
        if (arg.startsWith('-') && arg.length > 1) {
            const short = arg.slice(1);
            const long = SHORT_ALIASES[short];
            if (long === 'help') { helpRequested = true; continue; }
            if (long === 'version') { versionRequested = true; continue; }
            if (long === undefined) {
                throw new CliError(
                    `Unknown option: ${arg}\nUse --help for usage information`,
                    1,
                );
            }
            const next = argv[i + 1];
            if (next !== undefined && (next === '-' || !next.startsWith('-'))) {
                flagMap[long] = next;
                i++;
            } else {
                flagMap[long] = true;
            }
            continue;
        }

        // Positional
        positional.push(arg);
    }

    // Resolve command from first positional that matches REGISTRY
    let command: CommandSpec | null = null;
    const remaining: string[] = [];
    for (const p of positional) {
        if (command === null) {
            const match = findCommand(p);
            if (match) { command = match; continue; }
        }
        remaining.push(p);
    }
    if (remaining.length > 0) {
        flagMap._ = remaining;
    }

    return { command, flagMap, helpRequested, versionRequested };
}

/**
 * Coerce raw string flag values into the types expected by a Zod schema.
 *
 * The argv parser emits everything as `string | boolean | string[]`. Zod's
 * `z.number()` won't accept a string, and `safeParse` will fail with a type
 * error. To keep the per-command schemas simple (they read like the old
 * `parseArgs` result), we walk the schema shape and coerce string→number for
 * any number field. This matches today's `parseInt(args[++i], 10)` behavior
 * (cli.ts:52). Validation (NaN, range) is then handled by Zod cleanly.
 */
export function coerceForSchema(
    schema: z.ZodTypeAny,
    flagMap: Record<string, unknown>,
): Record<string, unknown> {
    // Unwrap ZodObject if wrapped (we only support object roots in this CLI)
    if (!(schema instanceof z.ZodObject)) return flagMap;
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const out: Record<string, unknown> = { ...flagMap };
    for (const [key, field] of Object.entries(shape)) {
        if (!(key in out)) continue;
        const raw = out[key];
        if (typeof raw !== 'string') continue;

        // Drill through optional/default wrappers to find the inner type
        let inner: z.ZodTypeAny = field as z.ZodTypeAny;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        while ((inner as any)._def && (inner as any)._def.innerType) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            inner = (inner as any)._def.innerType;
        }

        if (inner instanceof z.ZodNumber) {
            const n = Number(raw);
            // Hand the number to Zod; if Number(raw) → NaN, Zod will produce
            // a clear error message that we surface in the dispatcher below.
            out[key] = isNaN(n) ? raw : n;
        }
    }
    return out;
}
