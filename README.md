# LLMem

See your codebase as a graph of imports and function calls. Have an agent generate spec docs for any folder in seconds.

Built as an MCP server so Claude Code / Antigravity can use it as native tools — or run it standalone with the live-reloading web viewer.

![Spec doc and import graph side-by-side for src/parser](images/graph-preview.png)

> [!NOTE]
> Alpha. Built solo as a hobby project since December 2025 and will stay free and open-source. Bug reports, suggestions, and curious questions all welcome — open a GitHub issue or find me at [costasnotes.ch](https://www.costasnotes.ch).

## Quickstart

```bash
npm install -g @cogeor/llmem
cd path/to/your/project
llmem serve
```

Your browser opens at `http://localhost:5757`. Click circles in the left tree to add files to the graph; the view live-reloads as you edit.

To use it from an agent (Claude Code / Codex / Claude Desktop), let LLMem wire itself up:

```bash
llmem install
```

`llmem install` detects the agents you have installed, adds llmem to each one's MCP config, and tells you to restart the agent. Target a single client by name — `llmem install claude` or `llmem install codex` — and preview before touching anything:

```bash
llmem install --dry-run   # show what would be written, change nothing
llmem install --print      # print the config snippets to paste by hand
```

<details>
<summary>Configure manually</summary>

If you'd rather edit the config yourself, add an entry under `mcpServers`. The recommended form runs the globally installed binary (offline-safe — no network at launch):

```json
{
  "mcpServers": {
    "llmem": {
      "command": "llmem",
      "args": ["mcp"]
    }
  }
}
```

That assumes `npm i -g @cogeor/llmem`. If you can't install globally, fall back to `npx` (note: this re-resolves the package over the network on every launch):

```json
{
  "mcpServers": {
    "llmem": {
      "command": "npx",
      "args": ["-y", "@cogeor/llmem", "mcp"]
    }
  }
}
```

</details>

### Registering with your agent

`llmem install` supports these clients today:

| Client | Supported | Notes |
|---|:---:|---|
| Claude Code | yes | Uses the native `claude mcp add` when the CLI is on PATH; otherwise merges a project-local `.mcp.json`. |
| Codex | yes | Merges `[mcp_servers.llmem]` into `~/.codex/config.toml`. |
| Claude Desktop | yes | Registered via the install command's `claude-desktop` target; Desktop has no launch directory, so set a workspace (see [Configuration](#configuration)). |

> [!TIP]
> `llmem serve` (the web viewer) and `llmem mcp` (the agent-facing MCP server) are independent processes. You can run both, just one, or neither — they don't depend on each other.

## Spec docs for any folder

LLMem can generate per-folder and per-file spec docs into a parallel `.arch/` tree next to your source. The flow is two MCP calls:

1. Agent calls `folder_info { path: "src/parser" }` → LLMem returns the folder's structure and an enrichment prompt.
2. Agent runs the prompt through its LLM, then calls `report_folder_info` with the response.
3. LLMem writes `.arch/src/parser/README.md`.

Per-file follows the same pattern: `file_info` → LLM → `report_file_info` writes `.arch/src/parser/<file>.md`.

Without an MCP-aware agent, the same pipeline runs from the shell:

```bash
llmem document src/parser --prompt-only      # prints the LLM prompt
llmem document src/parser --content-file -   # reads LLM JSON from stdin, writes the doc
```

### MCP tools

| Tool | What it does |
|---|---|
| `folder_info` ↔ `report_folder_info` | Two-call pair: folder structure + prompt → enriched doc at `.arch/{folder}/README.md` |
| `file_info` ↔ `report_file_info` | Two-call pair: file structure + prompt → enriched doc at `.arch/{file}.md` |
| `open_window` | Returns a `file://` URL to a static snapshot of the graph (for agents that can open links) |

`folder_info` scans the folder on demand and refreshes any stale edges before generating the summary — no manual step needed. The first `folder_info` on a large folder does a one-time full parse; subsequent calls are incremental (a stat-walk + diff, re-parsing only what changed). Pass `refresh: "skip"` to bypass the freshness check entirely for back-to-back same-turn calls on a folder you just refreshed; `file_info` accepts the same `refresh` argument.

## Languages

This table is the user-facing view of the single source of truth — the `LANGUAGES` descriptor in `src/parser/languages.ts`. `npm run check:langs` asserts the rows here stay in sync with that descriptor and with the grammar peer dependencies in `package.json`.

| Language | Extensions | Grammar package | Call graph |
|---|---|---|:---:|
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx` | built-in (TS compiler API) | semantic |
| Python | `.py` | `tree-sitter-python` | heuristic [^pycg] |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`, `.hxx` | `tree-sitter-cpp` | import-only |
| Rust | `.rs` | `tree-sitter-rust` | import-only |
| R | `.r`, `.R` | `@davisvaughan/tree-sitter-r` | import-only |

TypeScript and JavaScript work out of the box (no grammar, no toolchain). For the others, install the matching tree-sitter grammar:

```bash
npm install -g tree-sitter-python tree-sitter-cpp tree-sitter-rust @davisvaughan/tree-sitter-r
```

Call graphs come in two flavours: **semantic** (TypeScript/JavaScript — resolved through the TS compiler) and **heuristic** (Python — see below). Every other language contributes import edges only.

[^pycg]: **Python call edges are heuristic** — they are name-matched (a call to `foo()` or `self.foo()` links to a same-name function/method), so they aid navigation and summaries but may miss dynamic dispatch (`getattr`, callables passed as arguments), decorators/metaclasses/properties, and same-name collisions across files. Cross-file edges resolve only when the call's base name matches an imported specifier that maps to a workspace file; bare package imports may resolve to a module node rather than the precise function. Heuristic nodes are badged in the viewer and the folder-summary prompt carries a caveat. It is great for navigation and summaries, **not a soundness tool**.

> [!NOTE]
> The grammar packages are **optional** native dependencies. npm installs a prebuilt binary for your Node ABI when one is published; otherwise it compiles the grammar with node-gyp, which needs a C/C++ toolchain (build-essential / Xcode CLT / MSVC Build Tools). If a grammar fails to build, LLMem still runs — that language is simply skipped until the toolchain is available and you reinstall.

## Configuration

All optional:

| Setting | Default | What it controls |
|---|---|---|
| `artifactRoot` | `.artifacts` | Where edge lists and the generated webview live |
| `maxFileSizeKB` | `512` | Skip files larger than this when scanning |
| `maxFileLines` | `2000` | Skip files with more than this many lines when scanning |
| `maxFilesPerFolder` | `20` | Viewer/context **display** heuristic only — caps how many files a folder summary lists for readability |

### What caps the graph scan (and what doesn't)

The graph scan caps are **file size** (`maxFileSizeKB`), **line count** (`maxFileLines`), the **folder ignore list** (`node_modules`, `.git`, etc.), and a **generated-file denylist**. The denylist drops files matching `*.min.*`, `*.bundle.*`, `*.generated.*`, and `*.d.ts` — typical build output / graph noise.

`maxFilesPerFolder` is **not** a graph scan cap. It only trims how many files a folder summary displays; it never silently truncates the graph. More generally, **any cap that excludes content is surfaced in the summary's coverage notes by name** (the exact paths dropped) — nothing is ever dropped silently.

> [!NOTE]
> `.d.ts` is on the denylist **by default** because declaration files are usually generated noise. But declaration files can be the public API of a TypeScript package — this is a documented, droppable entry. If you need them in the graph, treat the denylist as a known caveat.

`LLMEM_WORKSPACE` is **optional** for project-aware agents. Claude Code and Codex launch the MCP server from your project directory, so llmem auto-detects the workspace — you don't need to set anything. Set `LLMEM_WORKSPACE` only for Claude Desktop (which has no launch directory) or to pin the server to one specific project:

```json
{
  "mcpServers": {
    "llmem": {
      "command": "llmem",
      "args": ["mcp"],
      "env": { "LLMEM_WORKSPACE": "/absolute/path/to/your/project" }
    }
  }
}
```

VS Code reads the same settings from `.vscode/settings.json` under the `llmem.*` namespace (e.g. `llmem.artifactRoot`).

## VS Code / Antigravity extension

The extension isn't on the marketplace yet. To build the VSIX from source, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, repo layout, and the test suite.

## License

MIT — see [LICENSE](LICENSE).
