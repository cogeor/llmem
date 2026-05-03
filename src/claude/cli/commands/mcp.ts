/**
 * `llmem mcp` — start MCP server for Claude Code (stdio mode).
 *
 * Thin delegation to src/claude/index.ts:main. The dynamic import keeps
 * MCP initialization lazy so it doesn't pay for itself on `serve` /
 * `generate` / `stats` startup.
 */

import { z } from 'zod';
import type { CommandSpec } from '../registry';

const mcpArgs = z.object({}); // no args — env vars only (LLMEM_WORKSPACE)

export const mcpCommand: CommandSpec<typeof mcpArgs> = {
    name: 'mcp',
    description: 'Start MCP server for Claude Code (stdio)',
    examples: [
        { scenario: 'Start the MCP stdio server (Claude Code config target)', command: 'llmem mcp' },
    ],
    args: mcpArgs,
    async run() {
        const { main } = await import('../../index');
        await main();
    },
};
