# Artifact Module (Deprecated)

> **Status**: This module is largely deprecated. The edge list system (`graph/edgelist.ts`) is now the primary storage mechanism.

The artifact module provides legacy support for the `.arch/` shadow filesystem.

## Current Usage

The module is still used for:
- Path mapping between source files and `.arch/` documentation
- File I/O utilities for saving design documents

## File Structure

```
src/artifact/
├── service.ts      # Storage backend (deprecated)
├── storage.ts      # File I/O operations
├── path-mapper.ts  # Path utilities
├── tree.ts         # Directory tree (deprecated)
├── types.ts        # Type definitions
└── index.ts        # Module exports
```

## Migration

The old artifact system stored per-file `.artifact` JSON files. This has been replaced by:

| Old System | New System |
|------------|------------|
| `.artifacts/src/file.ts.artifact` | Edge lists in `.artifacts/*.json` |
| Folder `.summary` files | `report_folder_info` saves to `.arch/` |
| Per-file metadata | Edge list nodes/edges |

Documentation is now saved directly to `.arch/` via MCP tools (`report_file_info`, `report_folder_info`).
