# Language Support Roadmap

Quick reference for adding new languages to LLMem.

## Currently Supported

| Language | Status | Extensions | Parser Type | Package |
|----------|--------|------------|-------------|---------|
| TypeScript/JavaScript | ✅ Full | `.ts`, `.tsx`, `.js`, `.jsx` | Compiler API | Built-in |
| Python | ✅ Full | `.py` | Tree-sitter | `tree-sitter-python` |

## Planned Languages

| Language | Priority | Extensions | Complexity | Package |
|----------|----------|------------|------------|---------|
| Rust | High | `.rs` | Medium | `tree-sitter-rust` |
| C/C++ | High | `.c`, `.cpp`, `.h`, `.hpp`, `.cc` | High | `tree-sitter-cpp` |
| Go | High | `.go` | Low | `tree-sitter-go` |
| Java | Medium | `.java` | Medium | `tree-sitter-java` |
| C# | Medium | `.cs` | Medium | `tree-sitter-c-sharp` |
| Ruby | Medium | `.rb` | Medium | `tree-sitter-ruby` |
| PHP | Low | `.php` | Medium | `tree-sitter-php` |
| Kotlin | Low | `.kt`, `.kts` | Medium | `tree-sitter-kotlin` |
| Swift | Low | `.swift` | High | `tree-sitter-swift` |
| Scala | Low | `.scala` | High | `tree-sitter-scala` |
| R | Low | `.R`, `.r` | Low | `tree-sitter-r` |
| Dart | Low | `.dart` | Medium | `tree-sitter-dart` |

## Implementation Checklist

When adding a new language, you need to modify these files:

### 1. Create New Files

```
src/parser/<language>/
├── index.ts          ← Export public API
├── adapter.ts        ← Language adapter (registry integration)
├── extractor.ts      ← Main parser (implements ArtifactExtractor)
├── imports.ts        ← Import statement parser
└── resolver.ts       ← Call resolution logic
```

### 2. Modify Existing Files

| File | What to Change | Example |
|------|----------------|---------|
| `package.json` | Add tree-sitter package | `"tree-sitter-rust": "^0.21.0"` |
| `src/parser/registry.ts` | Register adapter in constructor | `this.registerAdapter(new RustAdapter());` |
| `src/parser/config.ts` | Add to `ALL_SUPPORTED_EXTENSIONS` | `'.rs'` |
| `src/parser/config.ts` | Add to `getLanguageFromPath()` | `if (filePath.endsWith('.rs')) return 'rust';` |

### 3. Create Test Files

```
test/fixtures/sample.<ext>     ← Sample code in the language
test/test-<language>-parser.ts ← Parser test script
```

### 4. No Changes Needed

These files are **language-agnostic** and automatically work with new languages:

- ✅ All files in `src/mcp/` (MCP tools)
- ✅ All files in `src/info/` (info extraction)
- ✅ All files in `src/graph/` (graph building)
- ✅ All files in `src/webview/` (visualization)
- ✅ All files in `src/claude/` (CLI/server)
- ✅ All files in `src/extension/` (VS Code extension)

---

## Language Feature Matrix

This table shows which language features need special handling in the parser:

| Feature | Python | Rust | C++ | Go | Java | Notes |
|---------|--------|------|-----|-----|------|-------|
| **Functions** | ✅ | ✅ | ✅ | ✅ | ✅ | Required |
| **Classes** | ✅ | ✅ | ✅ | 🟡 | ✅ | Go uses structs |
| **Methods** | ✅ | ✅ | ✅ | ✅ | ✅ | Required |
| **Imports** | ✅ | ✅ | ✅ | ✅ | ✅ | Required |
| **Exports** | 🟡 | ✅ | 🟡 | ✅ | ✅ | Python: convention-based |
| **Async/Await** | ✅ | ✅ | 🟡 | ✅ | ❌ | C++: futures/promises |
| **Generics** | 🟡 | ✅ | ✅ | ✅ | ✅ | Python: type hints |
| **Interfaces** | 🟡 | ✅ | 🟡 | ✅ | ✅ | Python: protocols |
| **Namespaces** | ❌ | ✅ | ✅ | ✅ | ✅ | Python: modules |
| **Macros** | ❌ | ✅ | ✅ | ❌ | ❌ | Rust/C++ preprocessor |
| **Decorators** | ✅ | ✅ | ❌ | ❌ | ✅ | Python: @, Rust: #[], Java: @ |

**Legend**:
- ✅ Supported / Required
- 🟡 Partial / Convention-based
- ❌ Not applicable

---

## Import Syntax Reference

Quick reference for parsing imports in different languages:

### Python
```python
import os                          # Simple import
import json as j                   # Aliased import
from pathlib import Path           # Named import
from typing import List, Optional  # Multiple imports
from . import utils                # Relative import (same package)
from ..helpers import func         # Relative import (parent package)
```

### Rust
```rust
use std::collections::HashMap;           // Simple use
use std::io::{Read, Write};              // Multiple items
use super::module::Struct;               // Relative (parent)
use crate::module::func;                 // Relative (crate root)
use external_crate::Item as Alias;      // Aliased
```

### C++
```cpp
#include <vector>        // Standard library
#include <iostream>      // Standard library
#include "local.h"       // Local header
using namespace std;     // Namespace import
using std::vector;       // Specific import
```

### Go
```go
import "fmt"                    // Simple import
import "path/to/package"        // Full path
import alias "path/to/package"  // Aliased
import . "path/to/package"      // Dot import (all names)
import _ "path/to/package"      // Side-effect only
```

### Java
```java
import java.util.List;                  // Single import
import java.util.*;                     // Wildcard import
import static java.lang.Math.PI;        // Static import
import java.util.ArrayList as AL;       // Aliased (hypothetical)
```

---

## Call Resolution Complexity

### Simple (Recommended Starting Point)

**Languages**: Python, Go, Ruby, PHP

**Features**:
- Direct function calls
- Method calls on objects
- Package/module function calls

**Example Resolution**:
```python
# Python
foo()           → local: foo
obj.method()    → unresolved (needs type inference)
math.sqrt()     → module: math, function: sqrt
```

### Medium

**Languages**: Java, C#, Kotlin

**Features**:
- Namespaced calls
- Static method calls
- Interface method calls

**Example Resolution**:
```java
// Java
foo()                    → local: foo
Math.sqrt()              → class: Math, method: sqrt
Collections.sort()       → class: Collections, method: sort
obj.method()             → unresolved (needs type info)
```

### Complex

**Languages**: Rust, C++, Scala

**Features**:
- Trait/template methods
- Operator overloading
- Macro expansion
- Lifetime annotations

**Example Resolution**:
```rust
// Rust
foo()                    → local: foo
Vec::new()               → type: Vec, method: new
iter.map(|x| x + 1)      → trait method (unresolved)
println!("hello")        → macro (special handling)
```

**Recommendation**: Start with simple resolution. Mark complex calls as unresolved. Incremental improvements are acceptable.

---

## Tree-Sitter Resources

### Official Grammars
- [Tree-sitter organization](https://github.com/tree-sitter)
- [Available parsers](https://tree-sitter.github.io/tree-sitter/#available-parsers)

### Testing Tools
- [Tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground)
- [Tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/cli/README.md)

### Node Type References
Each grammar has a `node-types.json` file documenting AST structure:
- Python: `node_modules/tree-sitter-python/src/node-types.json`
- Rust: `node_modules/tree-sitter-rust/src/node-types.json`

### Query Syntax
- [Query syntax documentation](https://tree-sitter.github.io/tree-sitter/using-parsers#pattern-matching-with-queries)
- [Query examples](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)

---

## Performance Targets

Target performance for parsers (10,000 lines of code):

| Metric | Target | Notes |
|--------|--------|-------|
| Parse speed | > 10,000 lines/sec | Tree-sitter is fast enough |
| Memory usage | < 100 MB per file | Streaming parse recommended |
| Accuracy | > 95% entities | Some edge cases acceptable |
| Call resolution | > 80% | Best effort, not perfect |

---

## Version History

| Date | Language | Status | Notes |
|------|----------|--------|-------|
| 2024-12 | TypeScript/JavaScript | ✅ Stable | Uses TypeScript Compiler API |
| 2024-12 | Python | ✅ Stable | Tree-sitter based |
| TBD | Rust | 🚧 Planned | High priority |
| TBD | C/C++ | 🚧 Planned | High priority |
| TBD | Go | 🚧 Planned | High priority |

---

## Contributing

To add a new language:

1. Follow [ADDING_LANGUAGES.md](./ADDING_LANGUAGES.md)
2. Implement the adapter pattern
3. Add tests with real-world examples
4. Update this roadmap
5. Submit PR with:
   - Parser implementation
   - Tests (min 80% coverage)
   - Sample fixtures
   - Documentation updates

---

## Quick Start Template

Fastest way to add a new language (copy-paste template):

```bash
# 1. Install tree-sitter package
npm install tree-sitter-<language>

# 2. Create directory
mkdir -p src/parser/<language>

# 3. Copy Python parser as template
cp -r src/parser/python/* src/parser/<language>/

# 4. Search and replace
find src/parser/<language> -type f -exec sed -i 's/Python/<Language>/g' {} +
find src/parser/<language> -type f -exec sed -i 's/python/<language>/g' {} +

# 5. Update tree-sitter import
# Edit extractor.ts: const Language = require('tree-sitter-<language>');

# 6. Register in registry.ts
# Add: this.registerAdapter(new <Language>Adapter());

# 7. Update config.ts
# Add extensions and language ID

# 8. Test
npm run build
npx ts-node test/test-<language>-parser.ts
```

---

## Need Help?

- Check Python implementation: `src/parser/python/`
- Read guide: `docs/ADDING_LANGUAGES.md`
- Review interfaces: `src/parser/interfaces.ts`
- Test with: `test/test-python-parser.ts`
