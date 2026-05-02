# Claude Integration

Status: design sketch.
Owners: apps/cli, apps/mcp-server, new `claude/skills/` folder.

## Vision

Three personas, one toolchain:

1. **A user installs LLMem** — `npm i -g @llmem/cli` (or a one-shot installer). One command works.
2. **The user has a CLI** for everyday tasks — open the viewer, scan a repo, link specs, fetch a hosted bundle.
3. **An agent (Claude) drives LLMem on the user's behalf** — through MCP tools and Claude Skills, without the user having to translate every request into a flag.

The current state has the pieces (`bin/llmem`, `src/claude/cli.ts`, `llmem-plugin/`, `.mcp.json`) but they are not coherent. This spec is the coherence pass.

## CLI (`llmem`)

After step 11 of `MIGRATION.md`, `apps/cli` is the canonical entry. Everything else — `bin/llmem`, the `llmem-plugin/dist/cli.bundle.js` — is a generated wrapper around this single source.

### Command surface (v1)

```
llmem init                      # writes .llmem/config.toml, suggests .gitignore entries
llmem scan                      # full scan, populates .artifacts/
llmem watch                     # long-running incremental scan
llmem serve [--port 3000]       # HTTP viewer + watch
llmem open                      # open the local viewer in the default browser
llmem mcp                       # stdio MCP server (for Claude Code / Antigravity)

llmem analyze <path>            # one-shot file/folder info, prints prompt
llmem document <path>           # generate the .arch/{path}.md (calls the LLM)
llmem specs (status|lint|show|touching)   # see design/03
llmem index <language>          # run SCIP indexer (see design/01)

llmem pull <bundle-url>         # fetch a hosted bundle locally (see design/04)
llmem login                     # device-code OAuth against the platform
llmem push                      # upload a local bundle to the platform (paid)
```

Every subcommand is one file under `apps/cli/src/commands/`. None goes over 200 lines. The dispatcher is `apps/cli/src/main.ts` — argument parsing, workspace-root resolution (delegated to `platform-fs.resolveWorkspaceRoot`), command lookup. That's it.

### What `llmem init` does

- Creates `.llmem/config.toml` with the user's choices (languages enabled, parser tiers per design/01, spec roots per design/03).
- Creates `.llmem/.gitignore` so generated state doesn't accidentally land in the repo.
- Suggests adding `.artifacts/` to the project's root `.gitignore`.
- Prints the next 2 commands the user should run. Onboarding hand-holding.

### What `llmem open` does

- If a viewer is already serving, opens it.
- If not, runs `llmem serve` in the background and waits for the port to bind, then opens.
- On Windows, uses `start`; macOS `open`; Linux `xdg-open`. One helper in `platform-fs`.

## MCP server

`apps/mcp-server` is the canonical stdio MCP entry. The current `dist/claude/index.js` is replaced by `dist/apps/mcp-server/index.js` after migration step 11.

The tool surface is the existing one (file_info, folder_info, report_*, inspect_source, open_window) plus the new tools introduced by other specs:

- design/03: `specs_for_file`, `files_for_spec`
- design/01: optional `set_parser_tier(language, tier)` to upgrade a session
- design/04: `pull_bundle(url)` (optional — only for the hosted-platform flow)

Every tool sits in its own file under `packages/platform-mcp/src/tools/` (per `ARCHITECTURE.md`'s file-budget rule). The schema, the validator, and the handler for one tool live in one file; the registrar walks the folder.

## Claude Skills

Claude Skills (`~/.claude/skills/<skill>/SKILL.md`) are the "Claude itself uses LLMem" surface. The user installs LLMem; the skills get the agent to use it without the user needing to spell out every workflow. Ship them in `claude/skills/` in this repo, install via `llmem skills install` which copies (or symlinks) into the user's Claude config.

### Skills to ship in v1

#### `llmem:explore`

- **When to use.** User asks "what is this codebase?", "where is X handled?", "give me the shape of this repo."
- **Workflow.**
  1. Call `folder_info` on the repo root.
  2. For folders that look load-bearing, call `folder_info` recursively.
  3. Read 2–3 key files via `file_info` + `inspect_source`.
  4. Synthesize. Cite folder paths and file:line.
- **Stop conditions.** Do not call `folder_info` more than 8 times in one turn; bail out and ask the user for direction.

#### `llmem:document`

- **When to use.** User asks to document a file or folder.
- **Workflow.**
  1. `file_info` (or `folder_info`) to get the prompt + structural data.
  2. Run the prompt through the LLM (Claude itself).
  3. `report_file_info` (or `report_folder_info`) with the result.
  4. Confirm to the user where the doc was written; offer to commit it.
- **Stop conditions.** If the user did not specify what to document, ask.

#### `llmem:trace-call`

- **When to use.** "Who calls this function?" "What does this function call?"
- **Workflow.** Read the call graph via `inspect_source` on the relevant edges in `call-edgelist.json`, plus `file_info` to confirm signatures. Surface concrete file:line references.
- **Stop conditions.** If the function is in a non-TS language without SCIP indexing (design/01), warn that calls may be incomplete.

#### `llmem:link-spec`

- **When to use.** User says "implement the folder view spec" or similar.
- **Workflow.**
  1. `files_for_spec(<spec>)` to see which files the spec claims to describe.
  2. `file_info` on each.
  3. Cross-check against the spec's prose. Surface drift if any (`drift warnings` from the spec index).
  4. Stay in the file set unless the user expands scope.

#### `llmem:onboard`

- **When to use.** First time in a repo. The user just installed LLMem.
- **Workflow.** Run `llmem scan` if no artifacts exist; open the viewer; pick the top 3 entry-point files via fan-out heuristics; offer to document them.

## Installation story

Goal: under 60 seconds from "never heard of LLMem" to "agent is using it."

```
npm i -g @llmem/cli            # one binary
llmem init                     # writes .llmem/config.toml, .gitignore
llmem skills install           # adds skills into ~/.claude/skills/llmem/
llmem mcp register             # writes the MCP server entry into Claude Code config
llmem serve                    # opens the viewer
```

`llmem mcp register` does the platform-specific config-file writes the README currently asks the user to do by hand:

- Detects Claude Code (`~/.config/claude/config.json`), Claude Desktop (`%APPDATA%\Claude\claude_desktop_config.json`), or Antigravity.
- Writes the `mcpServers.llmem` entry.
- Confirms the path. Refuses to overwrite an existing entry without `--force`.

The README's current "Add to Claude Code config" copy-paste block goes away.

## Architecture placement

- `apps/cli/src/commands/skills.ts` — `llmem skills install / list / uninstall`.
- `apps/cli/src/commands/mcp.ts` — `llmem mcp register / unregister / start`.
- `claude/skills/` — repo folder containing one subfolder per skill, each with a `SKILL.md`. Versioned alongside the code that backs the tools the skill calls.
- `tests/integration/skills/` — at least one round-trip test per skill: instantiate a fake agent loop, confirm the skill flow doesn't infinite-loop and stays under its tool-call budget.

## Open questions

- Skill versioning: do we ship v1, v2, etc. as separate skill folders, or update in place? Probably semver-named folders so the user can pin.
- Should `llmem mcp register` also offer the platform-bound MCP config (auth token + bundle URL) for design/04 users? Yes, but post-v1 — keep the local-only flow simple first.
- Auto-update: `npm i -g` works. Anything fancier (self-update inside `llmem update`) is out of scope.
- Telemetry: opt-in only, off by default. A single boolean in `.llmem/config.toml`. Decide what to collect when we have something worth collecting.
