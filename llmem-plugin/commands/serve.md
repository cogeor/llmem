---
description: Start the LLMem webview server to visualize import and call graphs
allowed-tools: Bash
---

# LLMem Serve

Start the LLMem HTTP server to view interactive graph visualizations of your codebase.

## Instructions

1. First, ensure edge lists exist by analyzing files/folders with the MCP tools
2. Start the server on the default port (3000):

```bash
cd $WORKSPACE_ROOT && npm run serve
```

Or with options:
```bash
cd $WORKSPACE_ROOT && npm run serve -- --port 8080 --open
```

3. Open the URL in your browser (usually http://localhost:3000)

## What You'll See

The webview provides three panels:
- **File Explorer**: Navigate your codebase and toggle files/folders for analysis
- **Graph View**: Interactive visualization of import and call relationships
- **Design Docs**: AI-generated documentation from the `.arch/` directory

## Options

- `--port, -p <num>`: Port number (default: 3000)
- `--open, -o`: Open browser automatically
- `--regenerate, -r`: Force regenerate graph before serving
