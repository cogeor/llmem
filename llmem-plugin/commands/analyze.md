---
description: Analyze a file or folder to extract imports, exports, and call relationships
argument-hint: <path>
---

# LLMem Analyze

Analyze a file or folder at path `$ARGUMENTS` to extract its structure and relationships.

## What This Does

Uses the LLMem MCP tools to:
1. Extract function signatures and exports
2. Identify import dependencies
3. Build call relationship graphs
4. Add the results to the edge lists for visualization

## Instructions

Use the `file_info` MCP tool to analyze the target:

For a file:
- Call `file_info` with the file path to get its structure
- Review the imports, exports, and function signatures

For a folder:
- Call `folder_info` with the folder path to get an overview
- This summarizes all files in the folder

## After Analysis

Once files are analyzed:
1. Their edges are added to the graph
2. Use `/llmem:serve` to visualize the relationships
3. Or use `/llmem:stats` to see graph statistics
