/**
 * CLI Command Registry
 *
 * Defines the CommandSpec interface that every CLI command implements,
 * and exports the REGISTRY array consumed by main.ts to dispatch argv
 * to the right handler.
 *
 * Loop 01 introduces only the four legacy commands (serve, mcp, generate,
 * stats). Subsequent loops add describe, scan, document, init, schema and
 * mark legacy commands `hidden: true`.
 */

import { z } from 'zod';
import type { CliContext } from './context';

export interface CommandSpec<A extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string;
    description: string;
    aliases?: string[];
    args: A;
    hidden?: boolean;
    run(args: z.infer<A>, ctx: CliContext): Promise<void>;
}

import { serveCommand } from './commands/serve';
import { mcpCommand } from './commands/mcp';
import { generateCommand } from './commands/generate';
import { statsCommand } from './commands/stats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REGISTRY: CommandSpec<any>[] = [
    serveCommand,
    mcpCommand,
    generateCommand,
    statsCommand,
];
