# Artifact Service Implementation Plan (Architectural Helper)
# Component: src/artifact/
================================================================================
## PURPOSE
================================================================================
Manages "Mirror Artifacts" and "Folder Summaries".

Naming Convention:
- Source: `src/path/file.ts`
- Artifact: `.artifacts/src/path/file.ts.artifact`
- Summary: `.artifacts/src/path/path.summary`

================================================================================
## FILES & RESPONSIBILITIES
================================================================================

### service.ts
- `ensureArtifacts(folderPath: string)`: 
  - Iterates files in folder.
  - Checks if corresponding `.artifact` exists and is fresh.
  - If not, calls Parser -> writes `.artifact`.
  - Returns list of ArtifactData for all files in folder.
- `saveFolderSummary(folderPath: string, content: string)`:
  - Writes `.summary` file for the folder.

### path-mapper.ts
- `sourceToArtifactPath(srcPath)`: `src/a.ts` -> `.artifacts/src/a.ts.artifact`
- `folderToSummaryPath(folderPath)`: `src/utils` -> `.artifacts/src/utils/utils.summary`

### types.ts
- `FileArtifact`: Just the signatures and path.
- `FolderSummary`: Markdown content + metadata.

================================================================================
## MODULE INTERACTIONS
================================================================================

┌─────────────────────┐      ┌───────────────────────────┐
│ src/mcp/tools.ts    │      │ src/parser/               │
│ (get_artifacts)     │      │                           │
└──────────┬──────────┘      │ - parseFile(srcPath)      │
           │                 └─────────────▲─────────────┘
           ▼                               │
┌──────────────────────────────────────────┴───────────────┐
│ src/artifact/service.ts                                  │
│                                                          │
│ - ensureArtifacts(folder) ───────────────────────────────┘
│   Loop:                                                  │
│     Call Parser -> Write .artifact                       │
│   Return [ArtifactData...]                               │
│                                                          │
│ - saveFolderSummary(folder, text)                        │
│   Write .summary                                         │
└──────────────────────────────────────────────────────────┘
