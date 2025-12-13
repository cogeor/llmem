# LLMem Codebase Overview

LLMem is an MCP (Model Context Protocol) server designed to enhance LLM interactions by providing a "shadow filesystem" of summarized code artifacts. It integrates with the Antigravity IDE to allow agents to efficiently navigate and understand large codebases.

## Core Functionality

1.  **Shadow Filesystem**: Maintains a parallel `.artifacts/` directory containing high-level summaries (`.artifact`, `.html`) for every source file.
2.  **Strategic Analysis**: Uses Tree-sitter to parse code and generate structural summaries (imports, exports, signatures) without reading the full file content.
3.  **MCP Server**: Exposes tools (`analyze_codebase`, `inspect_source`) that agents use to discover and read these summaries.
4.  **Visualization**: Provides a webview to visualize the project structure and dependency graphs (Import/Call graphs).

## Codebase Layout (`src/`)

The source code is organized into distinct modules separating the extension lifecycle from the core logic.

### 1. `extension/` (VS Code Integration)
-   **Entry Point**: `extension.ts` handles activation, configuration loading (`config.ts`), and the `LLMemPanel` webview lifecycle.
-   **Responsibility**: Bridges the VS Code API and the MCP server.

### 2. `mcp/` (Model Context Protocol Server)
-   **Entry Point**: `server.ts` initializes the SDK server and connects via stdio transport.
-   **Tools**: `tools.ts` defines the registry of tools available to the Agent (e.g., `analyze_codebase`).
-   **Responsibility**: Handles JSON-RPC requests from the agent and delegates to the Artifact Service.

### 3. `artifact/` (Core Logic)
-   **Service**: `service.ts` is the central coordinator for analyzing files and managing the artifact store.
-   **Path Mapping**: `path-mapper.ts` resolves relationships between source files (`src/foo.ts`) and artifacts (`.artifacts/src/foo.ts.artifact`).
-   **Tree Generation**: `tree.ts` builds the directory structure representation.

### 4. `parser/` (Static Analysis)
-   **Tree-sitter**: Wraps language parsers to extract "skeleton" representations of code (signatures, classes, methods) for efficient summarization.

### 5. `graph/` (Dependency Modeling)
-   **Builders**: `importGraph/builder.ts` and `callGraph/builder.ts` construct the dependency and call graphs used in the webview.
-   **Data Models**: Defines `VisNode` and `VisEdge` structures for `vis.js`.

### 6. `webview/` (Visualization UI)
-   **Frontend**: `js/main.js`, `Router.js`, and components (`GraphView`, `DesignTextView`) build the interactive UI.
-   **Generator**: `generator.ts` statically compiles the webview assets into `.artifacts/webview`.

## Data Flow

1.  **Agent Request**: Agent calls `llmem_analyze_codebase`.
2.  **MCP Layer**: `server.ts` receives request -> `tools.ts` executes handler.
3.  **Artifact Layer**: `service.ts` checks `parser/` for code structure and `artifact/` storage for existing summaries.
4.  **Response**: Structural summary returned to Agent.