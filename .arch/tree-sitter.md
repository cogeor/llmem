# Tree-Sitter Architecture

LLMem uses tree-sitter for fast, reliable syntax parsing of non-TypeScript/JavaScript languages.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Parser Registry                               │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │ TypeScriptAdapter │  │    Tree-Sitter Adapters              │ │
│  │ (TS Compiler API) │  │  ┌────────┐ ┌────────┐ ┌────────┐  │ │
│  │                   │  │  │ Python │ │  Rust  │ │  C++   │  │ │
│  │ • Imports ✅      │  │  │        │ │        │ │        │  │ │
│  │ • Calls ✅        │  │  │ Imports│ │ Imports│ │ Imports│  │ │
│  └──────────────────┘  │  │   ✅   │ │   ✅   │ │   ✅   │  │ │
│                        │  │ Calls ❌│ │ Calls ❌│ │ Calls ❌│  │ │
│                        │  └────────┘ └────────┘ └────────┘  │ │
│                        └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Why Tree-Sitter?

1. **Fast**: Incremental parsing, 10,000+ lines/sec
2. **Accurate**: Language-specific grammars maintained by the community
3. **No external dependencies**: Works offline, no LSP servers needed
4. **Consistent**: Same parsing behavior across platforms

## Supported Languages

| Language | NPM Package | Import Patterns |
|----------|------------|-----------------|
| Python | `tree-sitter-python` | `import`, `from X import` |
| C/C++ | `tree-sitter-cpp` | `#include` |
| Rust | `tree-sitter-rust` | `use` |
| R | `tree-sitter-r` | `library()`, `require()`, `source()` |

## Why No Call Graphs for Non-TS Languages?

Extracting accurate call graphs requires:

1. **Type information**: Knowing which function a name refers to
2. **Semantic analysis**: Understanding scope, imports, class hierarchies
3. **Cross-file resolution**: Linking references across modules

Tree-sitter provides **syntax** only, not **semantics**. For TypeScript/JavaScript, we use the TypeScript Compiler API which provides all of the above.

For other languages, reliable call graph extraction would require:
- Language-specific type systems
- LSP servers (which are slow and complex)
- Custom semantic analysis per language

The tradeoff: **Import graphs for all languages, call graphs for TS/JS only**.

## Adding a New Language

1. **Install the tree-sitter grammar**:
   ```bash
   npm install tree-sitter-{language}
   ```

2. **Create the adapter** (`src/parser/{language}/adapter.ts`):
   ```typescript
   export class LanguageAdapter extends TreeSitterAdapter {
       readonly id = 'language';
       readonly displayName = 'Language';
       readonly extensions = ['.ext'] as const;
       readonly npmPackage = 'tree-sitter-language';

       protected createExtractorInstance(workspaceRoot: string): ArtifactExtractor {
           return new LanguageExtractor(workspaceRoot);
       }
   }
   ```

3. **Create the extractor** (`src/parser/{language}/extractor.ts`):
   - Initialize tree-sitter parser with the grammar
   - Implement `extract()` to parse the file
   - Parse imports using language-specific AST patterns
   - Return entities with empty `calls` arrays

4. **Register in ParserRegistry** (`src/parser/registry.ts`):
   ```typescript
   try {
       require('tree-sitter-language');
       const { LanguageAdapter } = require('./language/adapter');
       this.registerAdapter(new LanguageAdapter());
   } catch (error) {
       console.error('[ParserRegistry] Language parser not available');
   }
   ```

5. **Add to config** (`src/parser/config.ts`):
   - Add extensions to `ALL_SUPPORTED_EXTENSIONS`

## Import Extraction Patterns

### Python
```python
import os                    # → ImportSpec { source: 'os' }
from pathlib import Path     # → ImportSpec { source: 'pathlib', specifiers: ['Path'] }
from . import utils          # → ImportSpec { source: '.', specifiers: ['utils'] }
```

### C/C++
```cpp
#include <stdio.h>           // → ImportSpec { source: 'stdio.h' }
#include "myheader.h"        // → ImportSpec { source: 'myheader.h' }
```

### Rust
```rust
use std::io::{Read, Write};  // → ImportSpec { source: 'std::io', specifiers: ['Read', 'Write'] }
use crate::module::Type;     // → ImportSpec { source: 'crate::module', specifiers: ['Type'] }
```

### R
```r
library(dplyr)               # → ImportSpec { source: 'dplyr' }
source("utils.R")            # → ImportSpec { source: 'utils.R' }
```
