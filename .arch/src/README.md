# src/

The `src/` directory contains the core implementation of LLMem.

## Module Overview

| Module | Purpose |
|--------|---------|
| `claude/` | Claude Code CLI plugin and graph server |
| `extension/` | VS Code/Antigravity extension integration |
| `mcp/` | MCP server with tool definitions |
| `graph/` | Edge list storage for import/call relationships |
| `parser/` | Multi-language code analysis (TS Compiler + Tree-sitter) |
| `info/` | Documentation generation for files and folders |
| `webview/` | Interactive graph visualization UI |
| `artifact/` | Legacy shadow filesystem (deprecated) |
| `scripts/` | Build and development utilities |

## Architecture

```
User → MCP Agent (Claude/Antigravity) → MCP Server
                                          ↓
                                    Parser Layer
                                    (TS Compiler / Tree-sitter)
                                          ↓
                                    Graph Layer
                                    (Edge Lists)
                                          ↓
                                    Info Layer
                                    (Documentation prompts)
                                          ↓
                                    .arch/ Storage
```

## Key Files

| File | Description |
|------|-------------|
| `mcp/tools.ts` | MCP tool definitions |
| `graph/edgelist.ts` | Edge list storage |
| `parser/registry.ts` | Language adapter registry |
| `claude/cli.ts` | CLI commands |
| `extension/extension.ts` | VS Code entry point |

## Platforms

- **Claude Code**: Uses `claude/` for CLI and graph server
- **VS Code/Antigravity**: Uses `extension/` for IDE integration

Both share the core modules: `mcp/`, `graph/`, `parser/`, `info/`.
