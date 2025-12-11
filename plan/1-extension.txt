# Extension Core Implementation Plan
# Component: src/extension/

================================================================================
## PURPOSE
================================================================================
Entry point for the MCP server extension. Handles lifecycle management,
configuration loading, and MCP server initialization.

================================================================================
## FILES & RESPONSIBILITIES
================================================================================

### extension.ts
- Register extension activation event
- Initialize configuration on startup
- Start MCP server process
- Handle extension deactivation/cleanup

### config.ts
- Load settings from environment variables
- Provide typed configuration interface to other modules
- Handle missing/invalid configuration gracefully

================================================================================
## MODULE INTERACTIONS
================================================================================

INTERNAL (within extension/):
┌─────────────────┐      ┌─────────────────┐
│  extension.ts   │─────>│    config.ts    │
│                 │      │                 │
│ - activate()    │      │ - loadConfig()  │
│ - deactivate()  │      │ - getConfig()   │
└────────┬────────┘      └─────────────────┘
         │
         │ starts
         ▼
┌─────────────────┐
│   MCP Server    │
│  (src/mcp/)     │
└─────────────────┘

EXTERNAL DEPENDENCIES:
- config.ts → Provides Config to mcp/server.ts
- extension.ts → Starts mcp/server.ts

================================================================================
## INTERFACES
================================================================================

```typescript
// config.ts exports
interface Config {
  artifactRoot: string;
  maxFilesPerFolder: number;
  maxFileSizeKB: number;
}

function loadConfig(): Config;
function getConfig(): Config;
```

================================================================================
## IMPLEMENTATION ORDER
================================================================================

1. config.ts
   - Environment variable loading
   - Default values
   - Validation logic

2. extension.ts
   - Activation handler
   - Config initialization
   - MCP server startup call

================================================================================
## DEPENDENCIES
================================================================================

External packages:
- None (uses standard Node.js process.env)

Internal dependencies:
- Depends on: (none - this is the root)
- Depended on by: mcp/server.ts

================================================================================
## TESTING
================================================================================

### Unit Tests (extension/)

config.ts:
- loadConfig() returns defaults when env vars missing
- loadConfig() reads GEMINI_API_KEY from process.env
- loadConfig() validates required fields
- getConfig() throws if called before loadConfig()
- getConfig() returns cached config after load

extension.ts:
- activate() calls loadConfig()
- activate() starts MCP server with config
- deactivate() shuts down MCP server cleanly

### Integration Tests (extension/ ↔ mcp/)

Extension → MCP Server:
- Test: activate() successfully starts MCP server
- Test: Config is correctly passed to server
- Test: deactivate() stops server without hanging
- Test: Server restart after config change

### Module Compatibility Tests

Config ↔ All Modules:
- Test: All modules can import and use Config interface
- Test: Config changes propagate to dependent modules
- Test: Missing API key is handled gracefully across system

================================================================================
## ENGINEER - MANUAL TESTING WORKFLOW
================================================================================

### Prerequisites

1. Node.js 18+ installed
2. Antigravity IDE installed

### Setup Steps

```bash
# 1. Navigate to project
cd llmem

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile

# 4. (Optional) Copy and edit .env
cp .env.example .env
```

### Extension Installation (Antigravity IDE)

Option A: Development Mode (F5)
```bash
# Open project in Antigravity
antigravity .

# Press F5 to launch Extension Development Host
# This opens a new Antigravity window with the extension loaded
```

Option B: Package and Install via CLI
```bash
# Package the extension
npm run package

# Install the .vsix file
antigravity --install-extension llmem-0.1.0.vsix
```

Option C: Install from Extension ID (after publishing)
```bash
antigravity --install-extension llmem.llmem
```

### MCP Server Registration (Part 2)

After implementing the MCP server, register it with Antigravity:
```bash
# Add MCP server definition
antigravity --add-mcp '{"name":"llmem","command":"node","args":["dist/mcp/server.js"]}'
```

This allows Antigravity's AI agent to call the LLMem MCP tools directly.

### Startup Verification Checklist

After extension activates, verify:

□ 1. Output channel "LLMem" appears in Output panel
     View → Output → Select "LLMem" from dropdown

□ 2. Activation message shown
     "LLMem: Extension activated" notification appears

□ 3. Configuration loaded (check Output)
     "[timestamp] Configuration loaded successfully"
     "[timestamp]   Artifact root: .artifacts"

□ 4. MCP server started (placeholder message)
     "[timestamp] MCP server started successfully"

□ 5. Status command works
     Ctrl+Shift+P → "LLMem: Show Status"
     Shows status message with MCP Server, Model, Artifact Root

### Error Scenario Testing

Test 1: Invalid maxFilesPerFolder
- Set MAX_FILES_PER_FOLDER=invalid
- Reload extension
- Expected: Falls back to default (20)

Test 2: Extension Deactivation
- Close Antigravity
- Check output for clean shutdown message
- Expected: "LLMem extension deactivated"

### Troubleshooting

Issue: Extension doesn't activate
- Check: View → Output → LLMem for error messages
- Check: Help → Toggle Developer Tools → Console for errors

Issue: Compilation errors
- Run: npm run compile
- Fix any TypeScript errors shown
- Check: @types/vscode is installed

Issue: MCP not recognized
- Run: antigravity --add-mcp '{"name":"llmem",...}'
- Verify command path points to compiled dist/mcp/server.js

### Antigravity CLI Quick Reference

```bash
# List installed extensions
antigravity --list-extensions

# Install extension from .vsix
antigravity --install-extension <path-to-vsix>

# Uninstall extension
antigravity --uninstall-extension llmem.llmem

# Add MCP server
antigravity --add-mcp '{"name":"server-name","command":"..."}'

# Open with verbose logging
antigravity --log debug .
```

### File Locations After Implementation

```
llmem/
├── package.json           ← Extension manifest
├── tsconfig.json          ← TypeScript config
├── .env.example           ← Environment template
├── .env                   ← Your local config (gitignored)
├── src/
│   └── extension/
│       ├── config.ts      ← Configuration loading
│       └── extension.ts   ← Activation/deactivation
└── dist/                  ← Compiled output (after npm run compile)
```
