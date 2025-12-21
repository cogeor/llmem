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

## 🎯 Usage Workflow

LLMem works in two stages: **graph visualization** (in the IDE panel) and **documentation generation** (via MCP tools).

### Step 1: Open the LLMem Panel

Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:

```
LLMem: Open View Panel
```

This opens the LLMem webview showing your workspace file tree and the dependency graph.

### Step 2: Toggle Watched Files

For large codebases, graph edges are computed **lazily** to save resources:

1. In the file explorer (left panel), you'll see toggle buttons (circles) next to files and folders
2. Click a toggle to **watch** a file/folder — this triggers edge computation
3. Watched items turn green; their import and call relationships appear in the graph

> [!TIP]
> Toggle an entire folder to watch all files within it at once.

### Step 3: Explore the Graph

![Graph Visualization](images/graph-preview.png)

The graph shows:
- **Import edges**: File-to-file import dependencies
- **Call edges**: Function-to-function call relationships
- **Node selection**: Click a node to highlight its connections

**Navigation:**
- Pan: Click and drag
- Zoom: Mouse wheel
- Select: Click a node

### Step 4: Generate Documentation via MCP

Once edges are computed, use the Antigravity Agent to generate documentation:

**Folder documentation:**
> "Run mcp folder_info on src/graph"

**File documentation:**
> "Run mcp file_info on src/mcp/tools.ts"

The agent uses the computed graph to understand dependencies and generates detailed documentation saved to `.arch/`.

---

## 💡 MCP Tools Reference

| Tool | Purpose |
|------|---------|
| `folder_info` | Get folder structure + prompt for LLM documentation |
| `file_info` | Get file details + prompt for LLM documentation |
| `report_folder_info` | Save LLM-generated folder docs to `.arch/{folder}/README.md` |
| `report_file_info` | Save LLM-generated file docs to `.arch/{file}.md` |
| `inspect_source` | Read specific line ranges from source files |
| `open_window` | Open the LLMem panel in the IDE |

> [!IMPORTANT]
> MCP documentation tools require the graph to be computed first. Make sure to **toggle watched files** in the panel before generating summaries.

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
