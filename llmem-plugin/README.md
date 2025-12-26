# LLMem Plugin for Claude Code

Interactive graph visualization and documentation for codebases.

## Installation

### From Git Repository

```bash
# Clone the llmem repository
git clone https://github.com/llmem/llmem.git
cd llmem

# Build the project
npm install
npm run build

# Install the plugin in Claude Code
claude plugin install ./llmem-plugin
```

### Restart Claude Code

After installing, restart Claude Code to activate the MCP server.

## Available Commands

| Command | Description |
|---------|-------------|
| `/llmem:serve` | Start the HTTP webview server |
| `/llmem:analyze <path>` | Analyze a file or folder |
| `/llmem:stats` | Show graph statistics |

## MCP Tools

The plugin provides these MCP tools for Claude:

- `file_info` - Extract file structure (imports, exports, functions)
- `folder_info` - Get folder overview
- `report_file_info` - Save AI-generated documentation
- `report_folder_info` - Save folder documentation
- `inspect_source` - Read specific lines from files

## Usage

1. Ask Claude to analyze your codebase:
   > "Analyze the src/parser folder and document what each file does"

2. View the visualization:
   > "/llmem:serve"

3. Check progress:
   > "/llmem:stats"

## Requirements

- Node.js 18+
- Claude Code CLI
