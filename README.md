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

To use it from an agent (Claude Code / Antigravity / Claude Desktop), add this to your MCP config:

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

> [!IMPORTANT]
> Spec generation needs the graph to be computed first. Toggle the folder you want documented (or one of its parents) in the explorer before calling `folder_info`.

## Languages

| Language | Extensions | Import graph | Call graph |
|---|---|:---:|:---:|
| TypeScript | `.ts`, `.tsx` | ✅ | ✅ |
| JavaScript | `.js`, `.jsx` | ✅ | ✅ |
| Python | `.py` | ✅ | — |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, … | ✅ | — |
| Rust | `.rs` | ✅ | — |
| R | `.R`, `.r` | ✅ | — |

TypeScript and JavaScript work out of the box. For the others, install the matching tree-sitter grammar:

```bash
npm install -g tree-sitter-python tree-sitter-cpp tree-sitter-rust @davisvaughan/tree-sitter-r
```

Call graphs are TypeScript/JavaScript-only today. Everything else gets import edges.

## Configuration

Three settings, all optional:

| Setting | Default | What it controls |
|---|---|---|
| `artifactRoot` | `.artifacts` | Where edge lists and the generated webview live |
| `maxFilesPerFolder` | `20` | Cap on files included per folder analysis |
| `maxFileSizeKB` | `512` | Skip files larger than this |

To point the MCP server at a specific project, set `LLMEM_WORKSPACE`:

```json
{
  "mcpServers": {
    "llmem": {
      "command": "npx",
      "args": ["-y", "@cogeor/llmem", "mcp"],
      "env": { "LLMEM_WORKSPACE": "/absolute/path/to/your/project" }
    }
  }
}
```

VS Code reads the same three settings from `.vscode/settings.json` under the `llmem.*` namespace (e.g. `llmem.artifactRoot`).

## VS Code / Antigravity extension

The extension isn't on the marketplace yet. To build the VSIX from source, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, repo layout, and the test suite.

## License

MIT — see [LICENSE](LICENSE).
