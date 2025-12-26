---
description: Show statistics about the analyzed codebase graph
allowed-tools: Bash
---

# LLMem Stats

Show statistics about the import and call graphs for this codebase.

## Instructions

Run the stats command:

```bash
cd $WORKSPACE_ROOT && node ./dist/claude/cli.js stats
```

## Output

This shows:
- **Import Graph**: Number of files (nodes) and import relationships (edges)
- **Call Graph**: Number of functions (nodes) and call relationships (edges)
- **Total Files**: Files that have been analyzed
- **Last Updated**: When the graphs were last modified
