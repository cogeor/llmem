/**
 * CLI Command Registry
 *
 * Defines the CommandSpec interface that every CLI command implements,
 * and exports the REGISTRY array consumed by main.ts to dispatch argv
 * to the right handler.
 *
 * Loop 04 added the `describe` command and the optional `examples` field
 * on `CommandSpec`. C1 (2026-07-13) deleted the legacy `generate` / `stats`
 * commands — their counts live in the health report header now.
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
import { describeCommand } from './commands/describe';
import { scanCommand } from './commands/scan';          // Loop 05
import { documentCommand } from './commands/document';  // Loop 06
import { initCommand } from './commands/init';          // Loop 07
import { installCommand } from './commands/install';    // LI-03
import { findCyclesCommand } from './commands/find-cycles'; // cycle-detection L03
import { healthCommand } from './commands/health'; // health-analysis L02
import { reviewCommand } from './commands/review'; // review-checklist L06

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REGISTRY: CommandSpec<any>[] = [
    serveCommand,
    mcpCommand,
    findCyclesCommand,  // cycle-detection L03
    healthCommand,      // health-analysis L02
    reviewCommand,      // review-checklist L06
    describeCommand,    // Loop 04
    scanCommand,        // Loop 05
    documentCommand,    // Loop 06
    initCommand,        // Loop 07
    installCommand,     // LI-03
];
