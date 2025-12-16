# LLMem - Codebase Summary Tool

**LLMem** is an MCP (Model Context Protocol) server extension for the Antigravity IDE. It is designed to enhance the efficiency of LLM context windows by managing a shadow filesystem of "artifacts"—high-level summaries, code outlines, and architectural notes—that exist alongside your source code.

## 🚀 Key Features

- **MCP-Native**: Operates as a pure Model Context Protocol server. It provides tools to the Antigravity Agent without requiring a separate UI.
- **Shadow Filesystem**: Maintains a parallel `.artifacts/` directory. For every source file (e.g., `src/foo.ts`), LLMem creates corresponding context files (e.g., `.artifacts/src/foo.ts.artifact`).
- **Strategic Summarization**: Automatically generates high-level summaries for folders and modules, allowing the LLM to understand the codebase structure without reading every file.
- **Code Intelligence**: detailed structural analysis (imports, exports, function signatures) using Tree-sitter.

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

## 🔧 Configuration

LLMem can be configured via Environment Variables or VS Code settings.

### Environment Variables
- `ARTIFACT_ROOT`: The directory where artifacts are stored (default: `.artifacts`).
- `MAX_FILES_PER_FOLDER`: Limit context size during retrieval (default: 20).
- `MAX_FILE_SIZE_KB`: Limit individual file size selection (default: 512).

## 💡 Usage

LLMem exposes tools to the Antigravity Agent. You do not run these commands manually; instead, you ask the Agent to perform tasks that trigger them.

### Common Interactions

**1. "Summarize this folder"**
- **Agent Action**: Calls `analyze_codebase` to analyze the directory structure.
- **LLMem Response**: Returns file signatures and import/export graphs.
- **Agent Action**: Calls `report_analysis` to save a generated Markdown summary.

**2. "Explain the auth module"**
- **Agent Action**: Calls `analyze_codebase` on the `auth` directory.
- **LLMem Response**: Provides a comprehensive context map of the module, which the Agent uses to answer your question.

### Tools Available to Agent
1. **`analyze_codebase`**: The entry point. Generates context prompts and triggers the analysis workflow.
2. **`inspect_source`**: Allows the agent to read specific blocks of code for detailed inspection.
3. **`report_analysis`**: The final step where the agent submits its generated summaries for storage.

## 📊 Visualization

![Graph Visualization](data/graph-preview.png)

LLMem provides a generated visualization of your codebase structure.

1. **Generate the graph**:
   ```bash
   npm run view:graph
   ```
2. **View the graph**:
   Open `data/graph/index.html` in your browser.

   > [!TIP]
   > The graph provides an interactive view of imports and function calls, helping you visualize dependencies.


### Architecture
The user flows from **User** -> **Antigravity Agent** -> **LLMem MCP Server**.

- **User**: Asks a question.
- **Agent**: Determines it needs code context and calls MCP tools.
- **LLMem**:
    1.  Looks up or generates artifacts in `.artifacts/`.
    2.  Returns concise, structurally-aware context to the Agent.
- **Agent**: Uses the context to answer the User.

## 🛠️ Development

- **Build**: `npm run compile`
- **Watch**: `npm run watch` (for auto-recompilation)
- **Test**: `npm test`

## 📁 Directory Structure

- `src/extension`: VS Code integration.
- `src/mcp`: The MCP server implementation (tools: `analyze_codebase`, `inspect_source`, `report_analysis`).
- `src/artifact`: Core logic for managing the artifact filesystem and path mapping.
- `src/parser`: Tree-sitter based code analysis and signature extraction.

## 📄 License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.
