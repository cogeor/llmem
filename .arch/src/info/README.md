# MODULE: src/info

## Overview
The `src/info` module is the semantic documentation engine for the LLMem codebase analyzer. It bridges the gap between raw code structure (parsed by the parser module) and human-readable/LLM-consumable documentation. The module operates at two granularities: file-level (detailed function/class documentation) and module-level (folder summaries with dependency analysis).

The core innovation is the "prompt-callback" pattern for LLM integration. Rather than directly generating documentation, the module produces structured prompts that guide an LLM to create enriched documentation. This separation allows the LLM to apply reasoning and context that static analysis cannot provide. The resulting documentation is persisted to `.arch/` as a "semantic layer" parallel to the source code.

The module is tightly integrated with the graph system (src/graph) for understanding code relationships, and with the MCP protocol for tool-based LLM interaction. It serves as the primary consumer of EdgeList data, transforming graph edges into human-readable summaries of imports, calls, and dependencies.

**Inputs:** Node.js fs/path, src/graph/edgelist.ts (EdgeListStore), src/graph/artifact-converter.ts, src/parser/ts-service.ts and ts-extractor.ts, TypeScript compiler types

**Outputs:** Markdown design documents (.arch/<path>.md), Module README.md files (.arch/<folder>/), MCP tools (file_info, report_file_info, module_info, report_module_info), Filtered edge/node lists

## Architecture
The module follows a layered architecture with clear separation of concerns:

**Layer 1 - Extraction**: `extractor.ts` parses TypeScript AST to extract structural info (functions, classes, imports). Uses TypeScript compiler APIs via `ts-service`.

**Layer 2 - Graph Access**: `filter.ts` provides query functions for the EdgeList graph - filtering edges by type (import/call), by file, or by module. `reverse-index.ts` builds inverse lookup tables for finding callers.

**Layer 3 - Rendering**: `renderer.ts` formats extracted info as Markdown. `mcp.ts` builds LLM enrichment prompts for file-level documentation.

**Layer 4 - Module Analysis**: `module.ts` aggregates file-level data into module summaries using graph filtering. Generates prompts that include imports, calls, and entity listings.

**Key Pattern**: The module uses a "prompt-callback" pattern for LLM integration - tools like `file_info` and `module_info` return prompts, and companion `report_*` tools receive the LLM-enriched responses.

Data flows: Source Files → TypeScript Parser → FileArtifact → EdgeList → Filtered Graph → Markdown/Prompts → LLM → Enriched Documentation (.arch/)

## Key Files
- **mcp.ts**: MCP integration for file_info tool. Contains getFileInfoForMcp() to extract structural data, buildEnrichmentPrompt() to create LLM prompts, and saveEnrichedFileInfo() to persist documentation to .arch/.
- **module.ts**: Module-level documentation generator. getModuleInfoForMcp() aggregates graph data for a folder, buildModuleEnrichmentPrompt() creates comprehensive LLM prompts with imports, calls, and entity listings.
- **filter.ts**: Graph query utilities. Provides functions for filtering edges by type (getImportEdges, getCallEdges), by file (getEdgesFromFile), and by module (getEdgesForModule). Handles path normalization and external dependency detection.
- **extractor.ts**: TypeScript AST extraction. Parses source files to extract function signatures, class definitions, and structural info. Converts TypeScript AST nodes to FileInfo format.
- **renderer.ts**: Markdown rendering utilities. Formats FileInfo structures as readable Markdown documentation with sections for functions, classes, and callers.
- **reverse-index.ts**: Call graph reverse lookup. buildReverseCallIndex() creates a map from entities to their callers, enabling 'who calls this?' queries.
- **cli.ts**: Command-line interface for file info. Supports --signatures and --semantic modes. Demonstrates extraction→graph→render pipeline.
- **cli_module.ts**: Command-line interface for module info. Supports --semantic mode for raw LLM prompt output.
