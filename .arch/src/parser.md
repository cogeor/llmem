# Parser Module

The parser module provides multi-language code analysis using the adapter pattern. TypeScript/JavaScript uses the TS Compiler API (with full call graph support), while other languages use Tree-sitter (import graphs only).

## File Structure

```
src/parser/
├── registry.ts         # ParserRegistry singleton - routes files to adapters
├── adapter.ts          # LanguageAdapter interface and TreeSitterAdapter base
├── config.ts           # Language configuration and extension mappings
├── interfaces.ts       # ArtifactExtractor interface
├── types.ts            # Data types (Entity, ImportSpec, etc.)
├── ts-service.ts       # TypeScript Program lifecycle management
├── ts-extractor.ts     # TypeScript/JavaScript extractor (full call graph)
├── line-counter.ts     # Line counting utilities
├── index.ts            # Module exports
│
├── typescript/         # TypeScript adapter
│   └── adapter.ts
├── python/             # Python adapter (tree-sitter)
│   ├── adapter.ts
│   └── extractor.ts
├── cpp/                # C/C++ adapter (tree-sitter)
│   ├── adapter.ts
│   └── extractor.ts
├── rust/               # Rust adapter (tree-sitter)
│   ├── adapter.ts
│   └── extractor.ts
├── r/                  # R adapter (tree-sitter)
│   ├── adapter.ts
│   └── extractor.ts
└── lsp/                # Legacy LSP support (deprecated)
```

## Language Support

| Language | Parser | Import Graph | Call Graph |
|----------|--------|:------------:|:----------:|
| TypeScript/JavaScript | TS Compiler API | Yes | Yes |
| Python | tree-sitter-python | Yes | No |
| C/C++ | tree-sitter-cpp | Yes | No |
| Rust | tree-sitter-rust | Yes | No |
| R | tree-sitter-r | Yes | No |

## Architecture

### ParserRegistry (`registry.ts`)

Singleton that maps file extensions to language adapters.

```typescript
class ParserRegistry {
    static getInstance(): ParserRegistry
    registerAdapter(adapter: LanguageAdapter): void
    getParser(filePath: string, workspaceRoot: string): ArtifactExtractor | null
    getLanguageId(filePath: string): string | null
    isSupported(filePath: string): boolean
    getSupportedExtensions(): string[]
}
```

On initialization, the registry:
1. Registers TypeScript adapter (always available)
2. Attempts to load optional tree-sitter grammars
3. Logs which languages are available

### LanguageAdapter (`adapter.ts`)

Interface for adding new language support.

```typescript
interface LanguageAdapter {
    readonly id: string;           // 'python', 'rust', 'cpp'
    readonly displayName: string;  // 'Python', 'Rust', 'C++'
    readonly extensions: readonly string[];  // ['.py'], ['.rs']
    readonly npmPackage?: string;  // 'tree-sitter-python'

    createExtractor(workspaceRoot: string): ArtifactExtractor
}
```

**TreeSitterAdapter** — Base class for tree-sitter based languages.

### ArtifactExtractor (`interfaces.ts`)

Common interface for all language extractors.

```typescript
interface ArtifactExtractor {
    extractImports(filePath: string): ImportInfo[]
    extractFunctions(filePath: string): FunctionInfo[]
}
```

## TypeScript Support

### TypeScriptService (`ts-service.ts`)

Manages TypeScript Program lifecycle for the workspace.

```typescript
class TypeScriptService {
    constructor(workspaceRoot: string)
    getProgram(): ts.Program
    getTypeChecker(): ts.TypeChecker
    getSourceFile(filePath: string): ts.SourceFile | undefined
}
```

Features:
- Loads `tsconfig.json` or creates default config
- Provides singleton Program for workspace
- Handles incremental updates

### TypeScriptExtractor (`ts-extractor.ts`)

Full-featured extractor using TS Compiler API.

Extracts:
- **Imports**: Resolved module paths (not just specifiers)
- **Exports**: Named, default, re-exports
- **Functions**: With full signatures
- **Call sites**: Function-to-function calls (enables call graph)

## Tree-sitter Languages

Each tree-sitter language follows the same pattern:

```typescript
// python/adapter.ts
export class PythonAdapter extends TreeSitterAdapter {
    readonly id = 'python';
    readonly displayName = 'Python';
    readonly extensions = ['.py'] as const;
    readonly npmPackage = 'tree-sitter-python';

    protected createExtractorInstance(workspaceRoot: string) {
        return new PythonExtractor(workspaceRoot);
    }
}

// python/extractor.ts
export class PythonExtractor implements ArtifactExtractor {
    extractImports(filePath: string): ImportInfo[] { ... }
    extractFunctions(filePath: string): FunctionInfo[] { ... }
}
```

Tree-sitter extractors only produce import graphs (no call graph resolution).

## Adding a New Language

1. Install tree-sitter grammar: `npm install tree-sitter-<language>`
2. Create `parser/<language>/adapter.ts` extending `TreeSitterAdapter`
3. Create `parser/<language>/extractor.ts` implementing `ArtifactExtractor`
4. Register in `registry.ts` constructor

## Configuration (`config.ts`)

Maps file extensions to language IDs and tree-sitter grammars.

```typescript
const ALL_SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx',  // TypeScript/JavaScript
    '.py',                          // Python
    '.c', '.h', '.cpp', '.hpp',    // C/C++
    '.rs',                          // Rust
    '.R', '.r',                     // R
];
```
