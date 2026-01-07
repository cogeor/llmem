# Adding New Language Support to LLMem

This guide explains how to add support for a new programming language to LLMem's graph analysis system.

## Overview

LLMem uses an **Adapter Pattern** to support multiple languages. Each language needs:
1. A **tree-sitter grammar** (npm package)
2. A **parser implementation** (extracts FileArtifact)
3. A **language adapter** (integrates with the registry)

All other components (MCP tools, edge lists, graph rendering) are **language-agnostic** and require no changes.

## Prerequisites

- Tree-sitter grammar available on npm
- Understanding of the language's syntax (imports, functions, classes, calls)
- Familiarity with tree-sitter query syntax

## Step-by-Step Guide

### Step 1: Install Tree-Sitter Grammar

Add the tree-sitter grammar package to `package.json`:

```bash
npm install tree-sitter-<language>
```

**Examples**:
- Python: `tree-sitter-python`
- Rust: `tree-sitter-rust`
- C++: `tree-sitter-cpp`
- Go: `tree-sitter-go`
- Java: `tree-sitter-java`

### Step 2: Create Parser Directory Structure

Create a new directory under `src/parser/`:

```
src/parser/<language>/
├── index.ts          # Public exports
├── adapter.ts        # Language adapter (registry integration)
├── extractor.ts      # Main parser (implements ArtifactExtractor)
├── imports.ts        # Import statement parser
└── resolver.ts       # Call resolution logic
```

### Step 3: Implement the Extractor

Create `src/parser/<language>/extractor.ts`:

**Required Interface**: `ArtifactExtractor` from `src/parser/interfaces.ts`

```typescript
import Parser, { SyntaxNode } from 'tree-sitter';
import { ArtifactExtractor } from '../interfaces';
import { FileArtifact } from '../types';

// Import tree-sitter grammar
const Language = require('tree-sitter-<language>');

export class <Language>Extractor implements ArtifactExtractor {
    private parser: Parser;
    private workspaceRoot: string;

    constructor(workspaceRoot?: string) {
        this.workspaceRoot = workspaceRoot || process.cwd();
        this.parser = new Parser();
        this.parser.setLanguage(Language);
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        // 1. Read file content
        const fileContent = content ?? fs.readFileSync(filePath, 'utf-8');

        // 2. Parse with tree-sitter
        const tree = this.parser.parse(fileContent);
        const rootNode = tree.rootNode;

        // 3. Extract imports
        const imports = this.parseImports(rootNode);

        // 4. Extract entities (functions, classes, methods)
        const entities = this.extractEntities(rootNode, fileContent);

        // 5. Extract calls within each entity
        for (const entity of entities) {
            entity.calls = this.extractCalls(entityNode, fileContent);
        }

        // 6. Determine exports
        const exports = this.extractExports(entities);

        // 7. Return FileArtifact
        return {
            schemaVersion: '<language>-ts-v1',
            file: {
                id: path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/'),
                path: filePath,
                language: '<language>'
            },
            imports,
            exports,
            entities
        };
    }

    // Helper methods...
}
```

**Reference Implementation**: See `src/parser/python/extractor.ts` for a complete example.

### Step 4: Implement Import Parser

Create `src/parser/<language>/imports.ts`:

**Purpose**: Extract import statements and build a binding map for call resolution

```typescript
import type { SyntaxNode } from 'tree-sitter';
import { ImportSpec } from '../types';

export class <Language>ImportParser {
    private importBindings: Map<string, ImportBinding> = new Map();

    /**
     * Parse all import statements from AST root
     */
    public parseImports(rootNode: SyntaxNode): ImportSpec[] {
        const imports: ImportSpec[] = [];
        this.importBindings.clear();

        // Walk AST and find import nodes
        // Extract source, specifiers, and build binding map

        return imports;
    }

    /**
     * Get import bindings for call resolution
     */
    public getBindings(): Map<string, ImportBinding> {
        return this.importBindings;
    }
}
```

**Key Concepts**:
- **ImportSpec**: What gets stored in FileArtifact.imports
- **ImportBinding**: Maps local name → module path (for call resolution)

**Example Bindings**:
```typescript
// Python: from pathlib import Path
{ localName: 'Path', importedName: 'Path', modulePath: 'pathlib' }

// Rust: use std::collections::HashMap as Map;
{ localName: 'Map', importedName: 'HashMap', modulePath: 'std::collections' }
```

### Step 5: Implement Call Resolver

Create `src/parser/<language>/resolver.ts`:

**Purpose**: Resolve function/method calls to their definitions

```typescript
export class <Language>CallResolver {
    private localDefs: Map<string, LocalDefinition> = new Map();
    private importBindings: Map<string, ImportBinding> = new Map();

    public initialize(
        fileId: string,
        localDefs: Map<string, LocalDefinition>,
        importBindings: Map<string, ImportBinding>
    ): void {
        this.localDefs = localDefs;
        this.importBindings = importBindings;
    }

    /**
     * Resolve a call to its definition
     */
    public resolve(calleeName: string): { file: string; name: string } | undefined {
        // 1. Check local definitions (same file)
        if (this.localDefs.has(calleeName)) {
            return { file: this.fileId, name: calleeName };
        }

        // 2. Check import bindings (imported from other files)
        const binding = this.importBindings.get(baseName);
        if (binding) {
            return { file: binding.modulePath, name: binding.importedName };
        }

        // 3. Check if builtin
        if (this.isBuiltin(calleeName)) {
            return { file: '<builtin>', name: calleeName };
        }

        // 4. Unresolved (external or dynamic)
        return undefined;
    }

    private isBuiltin(name: string): boolean {
        // Language-specific builtins
        // Python: print, len, range, etc.
        // Rust: println!, vec!, assert!, etc.
        // C++: std::vector, std::string, etc.
    }
}
```

### Step 6: Create Language Adapter

Create `src/parser/<language>/adapter.ts`:

```typescript
import { TreeSitterAdapter } from '../adapter';
import { ArtifactExtractor } from '../interfaces';
import { <Language>Extractor } from './extractor';

export class <Language>Adapter extends TreeSitterAdapter {
    readonly id = '<language>';
    readonly displayName = '<Language>';
    readonly extensions = ['.<ext1>', '.<ext2>'] as const;
    readonly npmPackage = 'tree-sitter-<language>';
    readonly supportsAsync = true;   // true if language has async/await
    readonly supportsClasses = true; // true if language has classes

    protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
        return new <Language>Extractor(workspaceRoot);
    }
}
```

### Step 7: Register in Parser Registry

Edit `src/parser/registry.ts`:

```typescript
import { <Language>Adapter } from './<language>/adapter';

private constructor() {
    this.registerAdapter(new TypeScriptAdapter());
    this.registerAdapter(new PythonAdapter());
    this.registerAdapter(new <Language>Adapter());  // ADD THIS LINE
}
```

### Step 8: Update Configuration

Edit `src/parser/config.ts`:

Add extensions to `ALL_SUPPORTED_EXTENSIONS`:
```typescript
export const ALL_SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',
    '.py',
    '.<ext1>', '.<ext2>',  // ADD YOUR EXTENSIONS
];
```

Update `getLanguageFromPath()`:
```typescript
export function getLanguageFromPath(filePath: string): string {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.<ext>')) return '<language>';  // ADD THIS
    return 'code';
}
```

### Step 9: Export Public API

Edit `src/parser/<language>/index.ts`:

```typescript
export { <Language>Extractor } from './extractor';
export { <Language>ImportParser } from './imports';
export { <Language>CallResolver } from './resolver';
export { <Language>Adapter } from './adapter';
```

### Step 10: Test

Create test file: `test/fixtures/sample.<ext>`

Run the parser test:
```bash
npx ts-node test/test-<language>-parser.ts
```

Expected output:
- File info (ID, language)
- Imports parsed correctly
- Entities extracted (functions, classes, methods)
- Calls resolved (local, imported, builtin)
- Exports identified

### Step 11: Build and Verify

```bash
npm run build
npm run serve
```

Open the webview and verify:
- ✅ Files with `.<ext>` extension appear in file explorer
- ✅ Toggle a file → edges appear in graph
- ✅ Import edges show file dependencies
- ✅ Call edges show function calls

---

## Language-Specific Considerations

### Tree-Sitter Node Types

Each language has different AST node types. Use the tree-sitter playground to explore:

**Python**:
- `function_definition`, `class_definition`
- `import_statement`, `import_from_statement`
- `call`

**Rust**:
- `function_item`, `impl_item`, `struct_item`
- `use_declaration`
- `call_expression`

**C++**:
- `function_definition`, `class_specifier`
- `include_directive`, `using_directive`
- `call_expression`

**Go**:
- `function_declaration`, `method_declaration`, `type_declaration`
- `import_declaration`
- `call_expression`

### Import Syntax Variations

**Python**:
```python
import os
from pathlib import Path
from . import utils
```

**Rust**:
```rust
use std::collections::HashMap;
use crate::module::Struct;
use super::helper;
```

**C++**:
```cpp
#include <vector>
#include "local.h"
using namespace std;
```

**Go**:
```go
import "fmt"
import "path/to/package"
import . "aliased"
```

### Call Resolution Strategies

**Simple (Python, Go)**:
- Direct function calls: `foo()`
- Method calls: `obj.method()`
- Package calls: `pkg.function()`

**Complex (Rust, C++)**:
- Namespaced calls: `std::vector::push`
- Template calls: `Vec<T>::new()`
- Trait methods: `Iterator::map()`

**Recommendation**: Start simple (resolve what you can), mark rest as unresolved. Incremental improvements are fine.

---

## Checklist

- [ ] Install `tree-sitter-<language>` npm package
- [ ] Create `src/parser/<language>/` directory
- [ ] Implement `extractor.ts` (ArtifactExtractor interface)
- [ ] Implement `imports.ts` (parse import statements)
- [ ] Implement `resolver.ts` (resolve calls)
- [ ] Implement `adapter.ts` (TreeSitterAdapter subclass)
- [ ] Register adapter in `src/parser/registry.ts`
- [ ] Update `src/parser/config.ts` extensions and language map
- [ ] Create test file and test script
- [ ] Run `npm run build` and verify no errors
- [ ] Test in webview (toggle files, see graphs)

---

## Examples to Study

**Fully Implemented**:
- `src/parser/python/` - Complete Python parser with imports, classes, async

**Reference Architecture**:
- `src/parser/ts-extractor.ts` - TypeScript (uses compiler API, not tree-sitter)
- `src/parser/interfaces.ts` - Required interfaces
- `src/parser/types.ts` - FileArtifact schema

---

## What You DON'T Need to Touch

These modules are **language-agnostic** and require no changes:

- ✅ `src/mcp/tools.ts` - MCP tool definitions
- ✅ `src/info/extractor.ts` - Info extraction from FileArtifact
- ✅ `src/info/mcp.ts` - MCP prompt building (uses ParserRegistry)
- ✅ `src/graph/edgelist.ts` - Edge list storage
- ✅ `src/graph/artifact-converter.ts` - FileArtifact → edges
- ✅ `src/graph/index.ts` - Graph building
- ✅ `src/webview/` - Visualization UI
- ✅ `src/claude/` - CLI and server

**Once the adapter is registered, everything else works automatically.**

---

## FAQ

**Q: Do I need to support 100% of language features?**
A: No. Start with basics (imports, functions, calls). Incrementally add classes, generics, macros, etc.

**Q: What if import resolution is complex (like Python's PYTHONPATH)?**
A: Best-effort resolution is fine. Unresolved imports just show as module names, not file paths.

**Q: Can I use a compiler API instead of tree-sitter?**
A: Yes, but you'll need to implement the adapter differently (see `TypeScriptAdapter` for compiler API example). Tree-sitter is faster and works without needing language-specific toolchains installed.

**Q: How do I handle language-specific features (Rust lifetimes, C++ templates)?**
A: Include them in the signature string. They don't need special handling for graph edges.

**Q: What about dynamically typed languages without clear exports?**
A: Mark top-level functions/classes as exported if they don't start with `_` (Python convention). Language adapters can define export rules.

---

## Support

If you implement a new language parser:
1. Test thoroughly with real-world codebases
2. Submit a PR with tests and documentation
3. Add examples to `test/fixtures/`

Happy parsing! 🎉
