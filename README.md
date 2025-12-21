# LLMem - Codebase Summary Tool

**LLMem** is an MCP (Model Context Protocol) server extension for the Antigravity IDE. It is designed to enhance the efficiency of LLM context windows by managing a shadow filesystem of "artifacts"—high-level summaries, code outlines, and architectural notes—that exist alongside your source code.

## 🚀 Key Features

- **MCP-Native**: Operates as a pure Model Context Protocol server. It provides tools to the Antigravity Agent without requiring a separate UI.
- **Shadow Filesystem**: Maintains a parallel `.arch/` directory. For every source file or folder, LLMem creates corresponding documentation files.
- **Strategic Summarization**: Automatically generates high-level summaries for folders and files, allowing the LLM to understand the codebase structure without reading every file.
- **Code Intelligence**: Detailed structural analysis (imports, exports, function signatures) using Tree-sitter.
- **Graph Visualization**: Interactive visualization of import dependencies and function calls across your codebase.

## 📦 Installation

Prerequisites:
- Antigravity IDE
- Node.js (v18+)

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/llmem.git
   cd llmem
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Compile the extension**
   ```bash
   npm run compile
   ```

4. **Open in Antigravity IDE**
   Open the folder in Antigravity. The extension should activate automatically, starting the MCP server.

## 💡 MCP Tools Usage

LLMem exposes MCP tools to the Antigravity Agent. These tools provide semantic documentation generation for files and folders.

### `folder_info` - Get Folder Documentation

Summarizes a folder using the EdgeList graph and returns a prompt for the LLM to generate high-level folder documentation. Reads existing docs from `.arch/{path}/README.md` if present.

**Example interaction:**
> "Run mcp folder_info on src/graph"

The tool returns structural analysis including:
- File count and graph statistics
- Function/class signatures for each file
- Import and call edges between files

### `file_info` - Get File Documentation

Extracts detailed file information and returns a prompt for the LLM to generate documentation. Returns structural info including functions, classes, and their relationships.

**Example interaction:**
> "Run mcp file_info on src/mcp/tools.ts"

### `report_folder_info` / `report_file_info` - Save Documentation

Callback tools that receive LLM-generated enrichment and save the documentation:
- `report_folder_info` saves to `.arch/{folder}/README.md`
- `report_file_info` saves to `.arch/{file}.md`

### `inspect_source` - Read Source Lines

Allows the agent to read specific line ranges from a source file for detailed inspection.

### `open_window` - Generate Static Webview

Generates a static webview of the graph visualization for browser viewing.

## 📊 Graph Visualization

![Graph Visualization](images/graph-preview.png)

LLMem provides an interactive graph visualization of your codebase structure, showing import dependencies and function call relationships.

**Features:**
- Interactive pan and zoom navigation
- Node selection with edge highlighting
- Folder-level grouping of files
- Import edges and function call edges visualization

**Generate and view the graph:**
```bash
npm run view:graph
```

This generates a static HTML page at `data/graph/index.html` that can be opened in any browser.

> [!TIP]
> The graph helps you visualize dependencies, identify tightly-coupled modules, and understand the overall architecture at a glance.

## 🏗️ Architecture

The user flows from **User** -> **Antigravity Agent** -> **LLMem MCP Server**.

- **User**: Asks a question about the codebase.
- **Agent**: Determines it needs code context and calls MCP tools.
- **LLMem**:
    1. Analyzes the codebase using Tree-sitter and edge graph data.
    2. Generates prompts for the LLM to create documentation.
    3. Saves documentation to `.arch/` directory.
- **Agent**: Uses the context to answer the User.

## 🛠️ Development

- **Build**: `npm run compile`
- **Watch**: `npm run watch` (for auto-recompilation)
- **Test**: `npm test`

## 📁 Directory Structure

- `src/extension`: VS Code/Antigravity IDE integration.
- `src/mcp`: MCP server implementation with tool handlers (`file_info`, `folder_info`, `inspect_source`, etc.).
- `src/artifact`: Core logic for managing the artifact filesystem and path mapping.
- `src/parser`: Tree-sitter based code analysis and signature extraction.
- `src/graph`: EdgeList graph data structures for tracking imports and function calls.
- `src/info`: Information extraction utilities for file and folder documentation.
- `src/webview`: Interactive graph visualization UI components.
- `images/`: Screenshot assets for documentation.

## 📄 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
