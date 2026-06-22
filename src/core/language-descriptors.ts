/**
 * Language Descriptors (PURE STATIC metadata)
 *
 * One declarative array describing every language LLMem can parse: its id,
 * display name, file extensions, optional tree-sitter grammar package,
 * call-graph capability, and syntax-highlight id(s).
 *
 * This file is PURE: it imports NOTHING with a runtime side effect — no
 * adapter modules, no tree-sitter grammar `require()`s. It is just data, so
 * config-only / metadata consumers (`src/parser/config.ts`,
 * `src/application/scan/hints.ts`, `src/graph/index.ts`) can read the language
 * metadata WITHOUT transitively pulling in adapter loaders or native grammars.
 *
 * It lives in `src/core/` (the bottom layer every other layer may import)
 * precisely so the `graph` layer can read `ALL_SUPPORTED_EXTENSIONS` without
 * importing the `parser` layer (forbidden by tests/arch/layer-matrix.test.ts).
 *
 * The lazy adapter loaders live in `src/parser/language-loaders` (keyed by
 * `id`). The composed registry view (descriptor + loader) lives in
 * `src/parser/languages`.
 *
 * Enforced by `tests/arch/parser-descriptor-purity.test.ts`.
 */

/**
 * Call-graph capability of a language.
 *
 * - `'semantic'`: full call graph via a type-aware compiler (TypeScript).
 * - `'heuristic'`: best-effort call graph from a tree-sitter AST (Python).
 * - `'none'`: import graph only, no call graph.
 *
 * The python-callgraph build reads `callGraph: 'heuristic'` from here — this is
 * the ONLY place call-graph capability is declared; do not add a separate flag.
 */
export type CallGraphCapability = 'semantic' | 'heuristic' | 'none';

/**
 * Declarative description of one supported language — PURE STATIC metadata.
 *
 * Deliberately has NO `load` field: constructing an adapter is a runtime
 * concern that would couple this metadata to grammar `require()`s. The
 * runtime loader for each language lives in `src/parser/language-loaders`,
 * keyed by `id`, and is joined back onto the descriptor in
 * `src/parser/languages`.
 */
export interface LanguageDescriptor {
    /** Unique language identifier (lowercase). Matches the adapter's `id`. */
    id: string;

    /** Human-readable language name. */
    displayName: string;

    /** File extensions handled by this language (lowercase-ish, with dot). */
    extensions: readonly string[];

    /**
     * NPM package name for the tree-sitter grammar, when one is required.
     * Omitted for TypeScript/JavaScript, which uses the TS compiler API.
     * When present, must match a peerDependency in package.json.
     */
    grammarPackage?: string;

    /** Call-graph capability for this language. */
    callGraph: CallGraphCapability;

    /**
     * Base syntax-highlight id for this language's extensions.
     *
     * highlightId is PER-EXTENSION, not strictly per-language: the existing
     * `getLanguageFromPath` maps `.ts`/`.tsx` → 'typescript' but `.js`/`.jsx`
     * → 'javascript' (a contract pinned by tests/integration/parser.test.ts).
     * To preserve that split without two separate descriptors, a descriptor
     * may declare `highlightOverrides` mapping specific extensions to a
     * different highlight id than `highlightId`. A future `getLanguageFromPath`
     * built from LANGUAGES resolves an extension's highlight id as
     * `highlightOverrides[ext] ?? highlightId`.
     */
    highlightId: string;

    /**
     * Optional per-extension highlight-id overrides (extension → highlightId).
     * See `highlightId`. Used so TypeScript's `.js`/`.jsx` yield 'javascript'
     * while `.ts`/`.tsx` yield 'typescript'.
     */
    highlightOverrides?: Readonly<Record<string, string>>;
}

/**
 * Single source of truth for supported-language STATIC metadata.
 *
 * No `load` here — see `src/parser/language-loaders` for the lazy adapter
 * constructors and `src/parser/languages` for the composed `LANGUAGES` view.
 */
export const LANGUAGE_DESCRIPTORS: readonly LanguageDescriptor[] = [
    {
        id: 'typescript',
        displayName: 'TypeScript/JavaScript',
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        // No grammarPackage: uses the TypeScript compiler API, not tree-sitter.
        callGraph: 'semantic',
        highlightId: 'typescript',
        highlightOverrides: { '.js': 'javascript', '.jsx': 'javascript' },
    },
    {
        id: 'python',
        displayName: 'Python',
        extensions: ['.py'],
        grammarPackage: 'tree-sitter-python',
        callGraph: 'heuristic',
        highlightId: 'python',
    },
    {
        id: 'cpp',
        displayName: 'C/C++',
        extensions: ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx'],
        grammarPackage: 'tree-sitter-cpp',
        callGraph: 'none',
        highlightId: 'cpp',
    },
    {
        id: 'rust',
        displayName: 'Rust',
        extensions: ['.rs'],
        grammarPackage: 'tree-sitter-rust',
        callGraph: 'none',
        highlightId: 'rust',
    },
    {
        id: 'r',
        displayName: 'R',
        extensions: ['.r', '.R'],
        grammarPackage: '@davisvaughan/tree-sitter-r',
        callGraph: 'none',
        highlightId: 'r',
    },
];

/**
 * All extensions supported for parsing and graph generation.
 *
 * Derived from {@link LANGUAGE_DESCRIPTORS} (the single source of truth for
 * supported languages and their extensions). Runtime support is gated
 * separately by `ParserRegistry.isSupported(filePath)`, which only returns
 * `true` for adapters whose tree-sitter package was successfully `require()`d
 * at registry-construction time.
 *
 * TypeScript/JavaScript supports both imports and call graphs.
 * Other languages (Python, C/C++, Rust, R) support import graphs only.
 */
export const ALL_SUPPORTED_EXTENSIONS: readonly string[] =
    LANGUAGE_DESCRIPTORS.flatMap((l) => l.extensions);

/**
 * Set version of {@link ALL_SUPPORTED_EXTENSIONS} for efficient O(1) lookups.
 */
export const SUPPORTED_EXTENSIONS_SET: ReadonlySet<string> = new Set(ALL_SUPPORTED_EXTENSIONS);
