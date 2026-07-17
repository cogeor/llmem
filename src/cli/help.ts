/**
 * LLMem CLI — help-text formatting (global page + per-command page).
 *
 * Split out of `arg-parser.ts` (B2) to keep both files under the 250-line
 * CLI layer budget. `printHelp` is the registry-driven global page;
 * `printCommandHelp` renders one command's flags from the SAME
 * zod-to-json-schema walk `describe --json` uses (schema-info.ts), so the
 * human and agent surfaces cannot drift.
 */

import { REGISTRY, type CommandSpec } from './registry';
import { commandFlagInfo } from './schema-info';

export function printHelp(): void {
    // Loop 07: now registry-driven; visible commands listed dynamically.
    // See `describe.ts:printHumanTree` for the matching JSON-driven listing —
    // both surfaces filter `hidden`, so the two cannot drift.
    //
    // Per-command flags live in `llmem <command> --help` (B2) and `describe`;
    // this page carries the command list, the global flags, examples, and
    // the env vars.
    const visibleCommands = REGISTRY.filter(c => !c.hidden);
    const longest = visibleCommands.reduce((m, c) => Math.max(m, c.name.length), 0);
    const cmdLines = visibleCommands
        .map(c => `  ${c.name.padEnd(longest + 2)} ${c.description}`)
        .join('\n');

    console.log(`
LLMem — dependency graphs, health reports, and AI architecture review

USAGE:
  llmem <command> [OPTIONS]
  llmem <command> --help     Show the flags of one command

COMMANDS:
${cmdLines}

OPTIONS:
  --help, -h             Show this help
  --version, -V          Print the package version

EXAMPLES:
  llmem                  Open the interactive graph viewer (serve is the default)
  llmem health           Write and print the codebase health report
  llmem review src/      Recall the architecture-review checklist for a subtree
  llmem install          Register the MCP server with Claude Code / Codex

ENVIRONMENT:
  LLMEM_WORKSPACE        Workspace root directory
  LLMEM_ARTIFACT_ROOT    Artifact store directory; absolute paths may live
                         outside the workspace (default: .llmem/graph;
                         --artifact-root wins over the env var)
`);
}

/**
 * Command-scoped help (B2): description, flags introspected from the Zod
 * schema (same source as `describe --json` — cannot drift), and examples.
 */
export function printCommandHelp(cmd: CommandSpec): void {
    const lines: string[] = [''];
    lines.push(`llmem ${cmd.name} — ${cmd.description}`);
    lines.push('');
    lines.push('USAGE:');
    lines.push(`  llmem ${cmd.name} [OPTIONS]`);

    const flags = commandFlagInfo(cmd);
    if (flags.length > 0) {
        lines.push('');
        lines.push('OPTIONS:');
        const rendered = flags.map(f => {
            const val = f.type === 'boolean' ? '' : ` <${f.type}>`;
            const def =
                f.defaultValue !== undefined ? ` (default: ${String(f.defaultValue)})` : '';
            return { left: `--${f.flag}${val}`, right: `${f.description}${def}` };
        });
        const width = rendered.reduce((m, r) => Math.max(m, r.left.length), 0);
        for (const r of rendered) {
            lines.push(`  ${r.left.padEnd(width + 2)}${r.right}`.trimEnd());
        }
    }

    if (cmd.examples && cmd.examples.length > 0) {
        lines.push('');
        lines.push('EXAMPLES:');
        for (const ex of cmd.examples) {
            lines.push(`  # ${ex.scenario}`);
            lines.push(`  ${ex.command}`);
        }
    }
    lines.push('');
    console.log(lines.join('\n'));
}
