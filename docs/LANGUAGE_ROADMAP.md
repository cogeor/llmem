# Language Support Roadmap

Quick reference for adding new languages to LLMem.

> The authoritative list of supported languages is the `LANGUAGES` descriptor
> in `src/parser/languages.ts`. The tables below mirror it; `npm run check:langs`
> guards that mirror (descriptor ↔ `package.json` grammar peerDeps ↔ README).

## Currently Supported

| Language | Extensions | Parser Type | Grammar package | Call graph |
|----------|------------|-------------|-----------------|------------|
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx` | Compiler API | Built-in | semantic |
| Python | `.py` | Tree-sitter | `tree-sitter-python` | import-only |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx`, `.hxx` | Tree-sitter | `tree-sitter-cpp` | import-only |
| Rust | `.rs` | Tree-sitter | `tree-sitter-rust` | import-only |
| R | `.r`, `.R` | Tree-sitter | `@davisvaughan/tree-sitter-r` | import-only |

Call graphs are TypeScript/JavaScript-only today. Every other language
contributes import edges only (Python call-graph support is not yet shipped).

## Planned Languages

| Language | Priority | Extensions | Complexity | Package |
|----------|----------|------------|------------|---------|
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

Adding a language is a **single-descriptor** change. You only touch two files;
the registry, the config extension list, and `getLanguageFromPath()` are all
**derived** from `LANGUAGES` — do NOT edit them by hand.

| File | What to Change | Example |
|------|----------------|---------|
| `package.json` | Add the grammar to `peerDependencies` + `peerDependenciesMeta` (optional) | `"tree-sitter-rust": "^0.23.0"` |
| `src/parser/languages.ts` | Add ONE entry to the `LANGUAGES` array (id, displayName, extensions, grammarPackage, callGraph, highlightId, `load()`) | see existing entries |
| `README.md` | Add the row to the Languages table | — |

Then run `npm run check:langs` to confirm the descriptor, the grammar peerDep,
and the README table all agree (this also runs in CI).

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
# 1. Add the grammar to package.json peerDependencies + peerDependenciesMeta
#    (optional:true). Then install it locally for development:
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

# 6. Add ONE entry to LANGUAGES in src/parser/languages.ts
#    (the registry + config are derived — do NOT edit them by hand)

# 7. Add the new row to the README Languages table, then verify parity
npm run check:langs

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
