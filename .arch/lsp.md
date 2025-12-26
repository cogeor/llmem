# Language Server Protocol (DEPRECATED)

> [!CAUTION]
> **This LSP infrastructure is currently unused/deprecated.**
> 
> LLMem now uses tree-sitter for all non-TypeScript/JavaScript parsing.
> This file is kept for potential future re-integration.

## Historical Context

The LSP approach was explored to provide call graph support for multiple languages but was found to be too slow for real-time editor integration due to:

1. **Startup latency**: LSP servers need time to analyze the codebase before responding
2. **Per-request overhead**: Each call hierarchy request required significant processing
3. **Memory usage**: Running multiple LSP servers simultaneously consumed significant resources

## Current Architecture

LLMem now uses:

- **TypeScript/JavaScript**: TypeScript Compiler API (full imports + calls)
- **Python, C++, Rust, R**: Tree-sitter parsers (imports only)

See [tree-sitter.md](tree-sitter.md) for the current architecture.

## Legacy LSP Files (Dead Code)

The following files are marked as dead code and are not currently used:

- `src/parser/lsp/extractor.ts` - LSP-based artifact extraction
- `src/parser/lsp/client.ts` - LSP client communication
- `src/parser/lsp/lsp-call-extractor.ts` - Call hierarchy extraction
- `src/parser/languages.ts` - LSP server configurations
