/**
 * CLI Command Registry
 *
 * Defines the CommandSpec interface that every CLI command implements,
 * and exports the REGISTRY array consumed by main.ts to dispatch argv
 * to the right handler.
 *
 * Loop 04 added the `describe` command and the optional `examples` field
 * on `CommandSpec`. Loops 05-07 will add `scan` / `document` / `init` and
 * mark legacy commands `hidden: true`.
 */

import { z } from 'zod';
import type { CliContext } from './context';

export interface CommandSpec<A extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description: string;
    aliases?: string[];
    /** Examples surfaced by `llmem describe` and human help. */
    examples?: { scenario: string; command: string }[];
    args: A;
    hidden?: boolean;
    run(args: z.infer<A>, ctx: CliContext): Promise<void>;
}

import { serveCommand } from './commands/serve';
import { mcpCommand } from './commands/mcp';
import { generateCommand } from './commands/generate';
import { statsCommand } from './commands/stats';
import { describeCommand } from './commands/describe';
import { scanCommand } from './commands/scan';      // Loop 05

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REGISTRY: CommandSpec<any>[] = [
    serveCommand,
    mcpCommand,
    generateCommand,
    statsCommand,
    describeCommand,    // Loop 04
    scanCommand,        // Loop 05
];
