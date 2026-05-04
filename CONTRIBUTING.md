# Contributing to LLMem

Thank you for your interest in contributing. This document covers the development workflow, build process, testing, and pull request guidelines.

## Prerequisites

- Node.js v18 or later
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
   npm run build
   ```

## Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Full build: compile TypeScript and build webview |
| `npm run compile` | TypeScript compilation only |
| `npm run watch` | Watch mode for TypeScript (auto-recompile on save) |
| `npm run package` | Create `.vsix` package (runs full build first) |
| `npm run build:claude` | Build Claude Code CLI entry point only |

### Webview Cache

When modifying `src/webview/generator.ts` or `src/webview/design-docs.ts`, delete the cached webview output to force regeneration:

```bash
rm -rf .artifacts/webview
```

Then touch a watched file to trigger regeneration in serve mode:

```bash
touch src/webview/ui/main.ts
```

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

- **VS Code / Antigravity IDE**: Press `F5` to launch an Extension Development Host with the extension loaded.
- **Claude Code**: Start the graph server and MCP server separately:
  ```bash
  npm run serve            # Graph server (http://localhost:5757)
  node dist/claude/index.js  # MCP server (stdio, used by Claude)
  ```

## Project Structure

Key areas to understand before contributing:

- `src/mcp/` — MCP server tools and handlers
- `src/graph/` — Edge list data structures
- `src/parser/` — Language parsers (TypeScript Compiler API + Tree-sitter)
- `src/info/` — Documentation extraction and prompt building
- `src/webview/` — Graph visualization UI

See `CLAUDE.md` for a detailed architecture overview.

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
