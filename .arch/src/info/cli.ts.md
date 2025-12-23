# DESIGN DOCUMENT: src/info/cli.ts

> **Instructions:** This document serves as a blueprint for implementing the source code. Review the specifications below before writing code.

---

## FILE OVERVIEW

## Purpose
`cli.ts` is the command-line interface entry point for the file info tool. It extracts and displays comprehensive structural information about TypeScript source files, including imports, entities, and call edges.

## Role in System
This file serves as a standalone CLI tool that:
1. Parses command-line arguments to get a target file path
2. Initializes the TypeScript service for the workspace
3. Extracts file artifacts (imports, entities, call edges)
4. Outputs formatted information to the console
5. Optionally supports different modes: `--signatures` and `--semantic`

## Key Dependencies
- **TypeScriptService**: Provides TypeScript program access
- **TypeScriptExtractor**: Extracts file structure as artifacts
- **artifactToEdgeList**: Converts artifacts to graph format
- **filter functions**: Filter and categorize edges

**Inputs:** **Command Line Args:**
- `process.argv[2]`: Relative file path to analyze
- `--signatures`: Show function signatures in output
- `--semantic`: Generate LLM enrichment prompt for semantic analysis

**Module Imports:**
- `path`, `fs` from Node.js
- `TypeScriptService` from `../parser/ts-service`
- `TypeScriptExtractor` from `../parser/ts-extractor`
- `artifactToEdgeList` from `../graph/artifact-converter`
- Filter functions from `./filter`

**Outputs:** **Console Output:**
- File info summary with imports, entities, call edges
- Or enrichment prompt in `--semantic` mode

**Exit Codes:**
- 0: Success
- 1: Missing argument or file not found

---

## FUNCTION SPECIFICATIONS

### `main`

**Purpose:** Entry point that orchestrates file info extraction and output

**Implementation:**

- Parse command line args from process.argv
- Check for --semantic and --signatures flags
- Validate that file path argument exists, exit if missing
- Resolve file path relative to current working directory
- Verify file exists on disk, exit if not found
- If --semantic mode: use getFileInfoForMcp and buildEnrichmentPrompt, output LLM prompt
- Otherwise: Initialize TypeScriptService with workspace root
- Create TypeScriptExtractor with program getter
- Extract file artifact containing entities and relationships
- Convert artifact to edge list format (nodes, importEdges, callEdges)
- Filter edges using getImportEdges, getCallEdges, filterImportEdges
- Print formatted output: separator, file info header, imports section, entities section, call edges section
- For call edges: resolve target signatures using getTargetSignature if --signatures flag
- Filter out stdlib functions (push, pop, map, filter, etc.)

### `getSignature`

**Purpose:** Extract function signature from file artifact by entity name

**Implementation:**

- Take artifact and entityName as parameters
- Iterate through artifact.entities array
- Find entity where name matches entityName
- Return entity.signature if found, null otherwise

### `formatSignature`

**Purpose:** Format a signature string for display, truncating if too long

**Implementation:**

- If signature is null, return empty string
- If signature length exceeds threshold, truncate and add '...'
- Return formatted signature wrapped in delimiter

### `getTargetSignature`

**Purpose:** Resolve function signature from a target file and function name

**Implementation:**

- Parse targetFile path and targetName from input
- Create new TypeScriptService for the target file's workspace
- Create TypeScriptExtractor for that service
- Extract artifact from target file
- If artifact is null, return '(not found)'
- Find entity in artifact.entities by name
- Return entity.signature if found, '(not found)' otherwise
