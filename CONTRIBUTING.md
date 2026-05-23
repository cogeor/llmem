# Contributing to LLMem

Thank you for your interest in contributing. This document covers the development workflow, build process, testing, and pull request guidelines.

## Prerequisites

- Node.js v20 or later (matches `engines.node` in `package.json`)
- npm v8 or later
- Git

## Getting Started

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/llmem.git
   cd llmem
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build:all
   ```

## Build Commands

| Command | Description |
|---------|-------------|
| `npm run build:all` | Build VS Code extension + Claude CLI |
| `npm run build:vscode` | Build VS Code extension only |
| `npm run build:claude` | Build Claude CLI only |
| `npm run compile` | TypeScript compilation only |
| `npm run watch` | Watch mode for TypeScript |
| `npm run package` | Create `cogeor-llmem-<version>.vsix` |
| `npm run serve` | Build + start the graph server |

The webview cache (`.artifacts/webview/`) is invalidated automatically — see `src/webview/shell-cache.ts`. No manual cleanup needed.

## Testing

Run the test suite with:

```bash
npm test
```

Tests use the built-in Node.js test runner (`node --test`). Test files follow the `**/*.test.ts` naming convention.

When adding new functionality, include tests alongside the source file.

## Linting

Run ESLint:

```bash
npm run lint
```

All code must pass linting before submission. Fix lint errors before opening a pull request.

## Running in Development

- **VS Code / Antigravity**: Press <kbd>F5</kbd> to launch an Extension Development Host with the extension loaded.
- **Claude CLI from a checkout**: `node ./bin/llmem serve` (graph server) and `node ./bin/llmem mcp` (MCP stdio server) — they're independent processes.

## Repo Layout

| Directory | What's inside |
|---|---|
| `src/extension` | VS Code / Antigravity extension entry points |
| `src/claude` | CLI plugin, graph HTTP server, MCP entrypoint |
| `src/mcp` | MCP tool handlers (`file_info`, `report_*`, `open_window`, …) |
| `src/application` | Pipeline glue used by both CLI and MCP |
| `src/parser` | TypeScript Compiler API + tree-sitter adapters |
| `src/graph` | Edge-list stores for imports and calls |
| `src/info` | Structural info extraction for docs |
| `src/webview` | Graph + spec viewer UI (bundled via esbuild) |
| `src/artifact` | `.arch/` shadow filesystem |
| `src/workspace` | Workspace IO with realpath containment |
| `tests/unit` | Pure-function unit tests |
| `tests/contracts` | Schema / snapshot tests |
| `tests/arch` | Architectural invariant tests |
| `tests/integration` | End-to-end tests (CLI shim, MCP stdio, HTTP routes) |

See `CLAUDE.md` for a detailed architecture overview.

## Workspace Root Detection

The MCP server figures out which directory to operate on via this priority order:

1. Explicit `LLMEM_WORKSPACE` environment variable
2. Stored extension context (when running inside the VS Code extension)
3. Walk up from `cwd` looking for `.git`, `package.json`, `.arch`, `.artifacts`, or `.llmem`
4. Fall back to `cwd`

Set `LLMEM_WORKSPACE` explicitly when in doubt — particularly in CI or test harnesses.

## Pull Request Guidelines

1. **One concern per PR** — keep changes focused. Separate refactoring from feature work.

2. **Branch from `main`**:
   ```bash
   git checkout -b feat/your-feature-name
   ```

3. **Commit messages** — use conventional commits:
   - `feat(scope): description` — new feature
   - `fix(scope): description` — bug fix
   - `docs(scope): description` — documentation only
   - `refactor(scope): description` — code restructure, no behavior change
   - `test(scope): description` — tests only
   - `chore(scope): description` — build, tooling, dependencies

4. **Before opening a PR**:
   - Run `npm run build` and confirm it succeeds
   - Run `npm test` and confirm all tests pass
   - Run `npm run lint` and fix any issues

5. **PR description** — explain what the change does and why. Include steps to reproduce any bug being fixed.

6. **Breaking changes** — call them out clearly in the PR description. Update `CLAUDE.md` if architecture changes.

## Reporting Issues

Open a GitHub issue with:
- A clear title describing the problem
- Steps to reproduce
- Expected vs actual behavior
- Node.js and OS version
- Whether you are using Claude Code, VS Code, or Antigravity
