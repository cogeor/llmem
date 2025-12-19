# MODULE: src/graph

## Overview
The `src/graph` module is the core data layer for representing and manipulating the codebase structure as a graph. It provides the EdgeList data structure that stores nodes (files, classes, functions, methods) and edges (imports, call relationships) extracted from source code artifacts. This module serves as the central data hub that feeds both the webview visualization and the semantic documentation tools.

**Inputs:** File artifacts from the parser module, TypeScript source files for extraction

**Outputs:** EdgeListStore instances, WebviewData for visualization, filtered edge/node lists

## Architecture
The module follows a data transformation pipeline: FileArtifacts → EdgeList → WebviewData. The `EdgeListStore` is the central class that loads/saves the graph from `.artifacts/edgelist.json`. The `artifact-converter` bridges the parser output to graph format, while `webview-data` prepares data for the UI. Dependencies flow inward: external modules depend on EdgeListStore but the graph module has minimal external dependencies beyond Node.js fs/path.

## Key Files
- **edgelist.ts**: Defines EdgeListStore class for storing and persisting nodes/edges to JSON
- **artifact-converter.ts**: Converts FileArtifact objects to EdgeList format (nodes and edges)
- **webview-data.ts**: Transforms EdgeList data into WebviewData format for visualization
- **utils.ts**: Utility functions for ID derivation and path normalization
