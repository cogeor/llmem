# LLMem Plugin for Claude Code

Interactive graph visualization and documentation for codebases.

## Installation

### From Git Repository

```bash
# Clone the llmem repository
git clone https://github.com/llmem/llmem.git
cd llmem

# Install dependencies and build
npm install
npm run build:claude

# Bundle the CLI for the plugin
npx esbuild dist/claude/claude/cli.js --bundle --platform=node \
  --outfile=llmem-plugin/dist/cli.bundle.js \
  --external:tree-sitter --external:tree-sitter-python \
  --external:tree-sitter-cpp --external:tree-sitter-rust \
  --external:@davisvaughan/tree-sitter-r

# Install the plugin in Claude Code
claude plugin install ./llmem-plugin
```

### Restart Claude Code

After installing, restart Claude Code to activate the MCP server.

## Language Support

### TypeScript/JavaScript (Built-in)

TypeScript and JavaScript are always supported - no additional configuration needed.

### Multi-Language Support (Python, C++, Rust, R)

To enable parsing for additional languages, you need tree-sitter and the language grammars installed. The plugin uses `NODE_PATH` to find these modules.

#### Option 1: Use the LLMem Repository's node_modules

Set the `LLMEM_NODE_MODULES` environment variable to point to the llmem repo:

**Linux/macOS** (add to `~/.bashrc` or `~/.zshrc`):
```bash
export LLMEM_NODE_MODULES="/path/to/llmem/node_modules"
```

**Windows** (System Environment Variables):
```
LLMEM_NODE_MODULES=C:\path\to\llmem\node_modules
```

Then install the language grammars in the llmem repo:
```bash
cd /path/to/llmem
npm install tree-sitter-python  # For Python
npm install tree-sitter-cpp     # For C/C++
npm install tree-sitter-rust    # For Rust
npm install @davisvaughan/tree-sitter-r  # For R
```

#### Option 2: Global Installation

Install tree-sitter globally and point NODE_PATH there:

```bash
# Create a global modules directory
mkdir -p ~/.llmem-modules
cd ~/.llmem-modules
npm init -y
npm install tree-sitter tree-sitter-python tree-sitter-cpp

# Set environment variable
export LLMEM_NODE_MODULES="$HOME/.llmem-modules/node_modules"
```

#### Verifying Language Support

After configuration, restart Claude Code and ask Claude to check parser status:
> "What languages does llmem support?"

Or use the `/llmem:stats` command to see registered parsers.

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

## Troubleshooting

### "Failed to reconnect to plugin:llmem:llmem"

This usually means the MCP server failed to start. Check:

1. **Plugin files exist**: The `dist/cli.bundle.js` must be in the plugin directory
2. **Workspace detected**: Set `LLMEM_WORKSPACE` if auto-detection fails
3. **Run manually to see errors**:
   ```bash
   LLMEM_WORKSPACE=/your/project node ~/.claude/plugins/cache/llmem-plugins/llmem/*/dist/cli.bundle.js mcp
   ```

### Language Parser Not Available

If a language shows as "not available":

1. Ensure `LLMEM_NODE_MODULES` is set correctly
2. Verify tree-sitter modules are installed at that path
3. Restart Claude Code after changing environment variables

## Requirements

- Node.js 18+
- Claude Code CLI

### Optional (for multi-language support)

- tree-sitter
- tree-sitter-python (Python support)
- tree-sitter-cpp (C/C++ support)
- tree-sitter-rust (Rust support)
- @davisvaughan/tree-sitter-r (R support)
