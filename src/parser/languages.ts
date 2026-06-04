/**
 * Language Descriptors (single source of truth)
 *
 * One declarative array describing every language LLMem can parse: its id,
 * display name, file extensions, optional tree-sitter grammar package,
 * call-graph capability, syntax-highlight id(s), and a lazy `load()` that
 * constructs the language's adapter.
 *
 * This file is PURE / ADDITIVE: it is the foundation that the registry,
 * config, scan, and python-callgraph migrations build on in later loops.
 * Nothing imports it yet.
 *
 * Lazy loading: `load()` is an arrow fn so the grammar `require()` only runs
 * when a consumer actually invokes it (mirroring the lazy require placement in
 * `registry.ts`'s `tryRegisterOptional` blocks). TypeScript needs no grammar,
 * so its `load()` constructs the adapter eagerly inside the arrow.
 */

import { LanguageAdapter } from './adapter';

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
 * Declarative description of one supported language.
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
     * Construct the language's adapter. Lazy: any grammar `require()` lives
     * INSIDE this arrow so it only runs when a consumer calls `load()`.
     */
    load: () => LanguageAdapter;

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
 * Single source of truth for supported languages.
 */
export const LANGUAGES: readonly LanguageDescriptor[] = [
    {
        id: 'typescript',
        displayName: 'TypeScript/JavaScript',
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        // No grammarPackage: uses the TypeScript compiler API, not tree-sitter.
        callGraph: 'semantic',
        highlightId: 'typescript',
        highlightOverrides: { '.js': 'javascript', '.jsx': 'javascript' },
        load: () => {
            // No grammar required — construct eagerly inside the arrow.
            const { TypeScriptAdapter } = require('./typescript/adapter');
            return new TypeScriptAdapter();
        },
    },
    {
        id: 'python',
        displayName: 'Python',
        extensions: ['.py'],
        grammarPackage: 'tree-sitter-python',
        callGraph: 'heuristic',
        highlightId: 'python',
        load: () => {
            require('tree-sitter-python');
            const { PythonAdapter } = require('./python/adapter');
            return new PythonAdapter();
        },
    },
    {
        id: 'cpp',
        displayName: 'C/C++',
        extensions: ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx'],
        grammarPackage: 'tree-sitter-cpp',
        callGraph: 'none',
        highlightId: 'cpp',
        load: () => {
            require('tree-sitter-cpp');
            const { CppAdapter } = require('./cpp/adapter');
            return new CppAdapter();
        },
    },
    {
        id: 'rust',
        displayName: 'Rust',
        extensions: ['.rs'],
        grammarPackage: 'tree-sitter-rust',
        callGraph: 'none',
        highlightId: 'rust',
        load: () => {
            require('tree-sitter-rust');
            const { RustAdapter } = require('./rust/adapter');
            return new RustAdapter();
        },
    },
    {
        id: 'r',
        displayName: 'R',
        extensions: ['.r', '.R'],
        grammarPackage: '@davisvaughan/tree-sitter-r',
        callGraph: 'none',
        highlightId: 'r',
        load: () => {
            require('@davisvaughan/tree-sitter-r');
            const { RAdapter } = require('./r/adapter');
            return new RAdapter();
        },
    },
];
