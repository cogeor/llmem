/**
 * `llmem install [client...]` — register the llmem MCP server with one or more
 * agent clients (Claude Code, Codex, Claude Desktop).
 *
 * Thin command: parse args → resolve the target client list → dispatch the
 * per-client adapters → summarize. The real fs writes live in the adapters
 * (LI-04/LI-05/LI-07), reached through the `ADAPTERS` registry; this command
 * only orchestrates them and renders the summary.
 *
 * Resolution:
 *   - Positional client names present → validate each against the known set
 *     ({claude, codex, claude-desktop}); an unknown name is a hard error
 *     (exit 1, listing the valid names).
 *   - No positionals → run detection over every registered adapter and target
 *     each PRESENT client. None detected → print the manual setup snippets and
 *     exit 0 (the user can paste them by hand).
 *
 * Write-free flags:
 *   - `--print`: emit copy-pasteable config snippets and exit 0. Stdout is
 *     kept clean (no banner) so the snippets are paste-safe. Shows BOTH the
 *     offline-safe `llmem mcp` form (recommended) AND the network-dependent
 *     `npx -y @cogeor/llmem mcp` form, explicitly labeled.
 *   - `--dry-run`: print what WOULD be written (the invocation diff /
 *     adapter snippet) and exit 0, touching nothing.
 *   Both short-circuit BEFORE any adapter write — zero fs writes.
 */

import { z } from 'zod';

import { detectWorkspace } from '../../workspace';
import { ADAPTERS } from '../../install';
import { buildPayload } from '../../install/registration';
import type { ClientAdapter, ClientId, Payload, ApplyOpts } from '../../install/types';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

// ============================================================================
// Known clients
// ============================================================================

/** The full set of client ids the user may name as a positional. Adapters for
 *  these land across LI-04/LI-05/LI-07; the set is the validation source even
 *  before every adapter is registered. */
const KNOWN_CLIENTS: ClientId[] = ['claude', 'codex', 'claude-desktop'];

// ============================================================================
// Args
// ============================================================================

const installArgs = z.object({
    scope: z.enum(['user', 'project', 'local']).default('user')
        .describe('Config scope to target: user (cross-machine default), project, or local.'),
    workspace: z.string().optional()
        .describe('Workspace root to pin as LLMEM_WORKSPACE in the registration (auto-detected if omitted).'),
    dryRun: z.boolean().default(false)
        .describe('Print what would be written and exit 0 without touching any file.'),
    print: z.boolean().default(false)
        .describe('Print copy-pasteable config snippets (both forms) and exit 0; writes nothing.'),
    force: z.boolean().default(false)
        .describe('Overwrite an existing llmem registration of the same name.'),
    // Captures the positional client names main.ts collects into `flagMap._`.
    // Surfaced in `describe --json` as an internal flag so the contract test
    // (which asserts every property has a `description`) keeps passing.
    _: z.array(z.string()).optional()
        .describe('(internal) Positional client names routed by the dispatcher.'),
});

// ============================================================================
// Manual snippet rendering
// ============================================================================

/**
 * Render the recommended (offline-safe) and fallback (npx, network-dependent)
 * MCP launch snippets for a payload. Returned as a single block; the npx form
 * is explicitly labeled as requiring the network.
 */
function renderManualSnippets(workspace?: string): string {
    const globalPayload: Payload = { command: 'llmem', args: ['mcp'] };
    const npxPayload: Payload = { command: 'npx', args: ['-y', '@cogeor/llmem', 'mcp'] };
    if (workspace) {
        const env = { LLMEM_WORKSPACE: workspace };
        globalPayload.env = { ...env };
        npxPayload.env = { ...env };
    }
    const lines: string[] = [];
    lines.push('# Recommended (offline-safe; requires a global `llmem` install):');
    lines.push(JSON.stringify({ command: globalPayload.command, args: globalPayload.args, ...(globalPayload.env ? { env: globalPayload.env } : {}) }, null, 2));
    lines.push('');
    lines.push('# Fallback (network-dependent; fetches @cogeor/llmem via npx each run):');
    lines.push(JSON.stringify({ command: npxPayload.command, args: npxPayload.args, ...(npxPayload.env ? { env: npxPayload.env } : {}) }, null, 2));
    return lines.join('\n');
}

// ============================================================================
// Command spec
// ============================================================================

export const installCommand: CommandSpec<typeof installArgs> = {
    name: 'install',
    description: 'Register the llmem MCP server with your agent client(s) (Claude Code, Codex, Claude Desktop).',
    examples: [
        { scenario: 'Auto-detect installed clients and register llmem', command: 'llmem install' },
        { scenario: 'Print copy-pasteable config snippets (writes nothing)', command: 'llmem install --print' },
        { scenario: 'Register only Claude Code, overwriting any existing entry', command: 'llmem install claude --force' },
    ],
    args: installArgs,
    async run(args) {
        const positionals = (args._ ?? []).filter((p) => p.length > 0);

        // ----- Resolve workspace (only auto-detect/validate when pinned) -----
        // When --workspace is passed we resolve+validate it (detectWorkspace
        // throws WorkspaceNotFoundError on a missing explicit path, which
        // main() turns into exit 1); otherwise we leave it unset so the
        // payload carries no LLMEM_WORKSPACE.
        const workspace = args.workspace ? detectWorkspace(args.workspace) : undefined;
        const workspaceDisplay = workspace ? workspace.replaceAll('\\', '/') : undefined;

        // ----- Resolve the target adapter list -----
        // `autoDetected` records whether the list came from detection (no
        // positionals) vs. explicit naming — only the auto-detect path falls
        // back to the manual-snippet "nothing here" message.
        let targets: ClientAdapter[];
        let autoDetected = false;
        if (positionals.length > 0) {
            // Validate every named client against the known set (exit 1 on any
            // unknown name — this runs before the write-free flags so a typo
            // never silently "succeeds" under --print/--dry-run).
            const unknown = positionals.filter((p) => !KNOWN_CLIENTS.includes(p as ClientId));
            if (unknown.length > 0) {
                throw new CliError(
                    `Error: unknown client(s): ${unknown.join(', ')}. ` +
                    `Valid clients: ${KNOWN_CLIENTS.join(', ')}.`,
                    1,
                );
            }
            const wanted = new Set(positionals);
            targets = ADAPTERS.filter((a) => wanted.has(a.id));
        } else {
            // Auto-detect: target every present client.
            autoDetected = true;
            const present: ClientAdapter[] = [];
            for (const adapter of ADAPTERS) {
                const result = await adapter.detect(process.env);
                if (result.present) present.push(adapter);
            }
            targets = present;
        }

        // ----- Build the launch payload (no fs writes) -----
        const payload = await buildPayload({ workspace: workspaceDisplay });

        // ----- Write-free short-circuit: --print -----
        // Must run BEFORE any banner so stdout stays paste-safe. Prefer adapter
        // snippets when targets are known; otherwise emit the generic both-form
        // manual snippets (no banner).
        if (args.print) {
            const out = targets.length > 0
                ? targets.map((a) => `# ${a.label}\n${a.snippet(payload)}`).join('\n\n')
                : renderManualSnippets(workspaceDisplay);
            process.stdout.write(out + '\n');
            return; // exit 0 — write-free
        }

        // ----- Write-free short-circuit: --dry-run -----
        if (args.dryRun) {
            console.log('Dry run — no files will be written.');
            if (targets.length === 0) {
                console.log('');
                console.log('No target clients. Manual setup snippets:');
                console.log('');
                console.log(renderManualSnippets(workspaceDisplay));
            } else {
                for (const adapter of targets) {
                    console.log('');
                    console.log(`# ${adapter.label}`);
                    console.log(adapter.snippet(payload));
                }
            }
            return; // exit 0 — write-free
        }

        // ----- No target clients (auto-detect found nothing) -----
        // Print the manual snippets and exit cleanly so the user can paste them.
        if (targets.length === 0) {
            if (autoDetected) {
                console.log('No agent clients detected. Add llmem to your client config manually:');
            } else {
                console.log('No adapter is available for the named client(s) yet. ' +
                    'Add llmem to your client config manually:');
            }
            console.log('');
            console.log(renderManualSnippets(workspaceDisplay));
            return; // exit 0 — nothing to install
        }

        // ----- Apply to each target adapter -----
        const opts: ApplyOpts = {
            force: args.force,
            scope: args.scope,
            ...(workspace ? { workspace } : {}),
        };

        let anyError = false;
        for (const adapter of targets) {
            try {
                const result = await adapter.apply(payload, opts);
                const detail = result.detail.replaceAll('\\', '/');
                switch (result.status) {
                    case 'added':
                    case 'replaced':
                        console.log(`✓ ${adapter.label}: ${result.status} (${detail})`);
                        break;
                    case 'skipped':
                        console.log(`- ${adapter.label}: skipped (${detail})`);
                        break;
                    case 'error':
                        anyError = true;
                        console.error(`✗ ${adapter.label}: error (${detail})`);
                        break;
                }
            } catch (err) {
                anyError = true;
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`✗ ${adapter.label}: error (${msg.replaceAll('\\', '/')})`);
            }
        }

        console.log('');
        console.log('Restart your agent to load llmem.');

        // Per-adapter errors were already printed (✗ lines); signal exit 1.
        if (anyError) throw new CliError('', 1);
    },
};
