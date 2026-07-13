/**
 * `llmem mcp` — start the MCP server (stdio mode).
 *
 * Thin delegation to src/mcp/main.ts:main. The dynamic import keeps
 * MCP initialization lazy so it doesn't pay for itself on `serve` /
 * `generate` / `stats` startup.
 */

import { z } from 'zod';
import type { CommandSpec } from '../registry';

const mcpArgs = z.object({}).strict(); // no args — env vars only (LLMEM_WORKSPACE)

export const mcpCommand: CommandSpec<typeof mcpArgs> = {
    name: 'mcp',
    description: 'Start the MCP server (stdio)',
    examples: [
        { scenario: 'Start the MCP stdio server (MCP client config target)', command: 'llmem mcp' },
    ],
    args: mcpArgs,
    async run() {
        const { main } = await import('../../mcp/main');
        await main();
    },
};
