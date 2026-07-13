/**
 * Zod-schema → flag-info introspection shared by the help surfaces.
 *
 * B2 (2026-07-13): `llmem <command> --help` renders a command-scoped help
 * page from the SAME source `describe --json` uses (zod-to-json-schema over
 * the command's args), so human help and the agent schema cannot drift.
 */

import type { CommandSpec } from './registry';

// Same idiom as describe.ts / src/mcp/server.ts — `require` keeps
// TypeScript's deep type inference from blowing up `compile:vscode`
// against zod-to-json-schema.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { zodToJsonSchema } = require('zod-to-json-schema');

/** One CLI flag derived from a command's Zod args schema. */
export interface FlagInfo {
    /** Schema key (camelCase), e.g. `failOn`. */
    key: string;
    /** The flag the user types (kebab-case, no dashes prefix), e.g. `fail-on`. */
    flag: string;
    /** Display type: `string`/`number`/`boolean` or the enum values joined by `|`. */
    type: string;
    description: string;
    defaultValue?: unknown;
}

/** camelCase schema key → the kebab-case flag the user actually types. */
export function camelToKebab(key: string): string {
    return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

interface JsonSchemaProp {
    type?: string;
    enum?: unknown[];
    description?: string;
    default?: unknown;
}

/**
 * Flags of a command, sorted by flag name. The internal `_` positional
 * catch-all is omitted — it is dispatcher plumbing, not a flag.
 */
export function commandFlagInfo(cmd: CommandSpec): FlagInfo[] {
    const schema = zodToJsonSchema(cmd.args) as {
        properties?: Record<string, JsonSchemaProp>;
    };
    const props = schema.properties ?? {};
    return Object.keys(props)
        .filter((key) => key !== '_')
        .sort()
        .map((key) => {
            const p = props[key];
            const type = Array.isArray(p.enum)
                ? p.enum.map(String).join('|')
                : (p.type ?? 'value');
            return {
                key,
                flag: camelToKebab(key),
                type,
                description: p.description ?? '',
                defaultValue: p.default,
            };
        });
}
