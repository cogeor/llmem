/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires --
   Every require() below is a deliberately deferred/optional load (native tree-sitter grammars +
   adapter constructors) that MUST stay a synchronous lazy require inside its loader arrow — a
   static import would force optional native addons to load at module-import time and break the
   "TS/JS works without grammars installed" guarantee. */
/**
 * Language Loaders (lazy adapter constructors)
 *
 * The runtime half of the language-metadata split: a record of lazy
 * `load()` arrows keyed by language id. Each arrow constructs the language's
 * adapter, performing any grammar `require()` INSIDE the arrow so it only runs
 * when a consumer actually invokes it (mirroring the lazy require placement in
 * `registry.ts`'s `tryRegisterOptional` blocks). TypeScript needs no grammar,
 * so its loader constructs the adapter eagerly inside the arrow.
 *
 * The pure static metadata lives in `../core/language-descriptors`. The composed
 * view (descriptor + loader) lives in `./languages`. Keeping the loaders here,
 * away from the descriptors, lets metadata-only consumers read language data
 * without transitively pulling in adapters or native grammars.
 */

import { LanguageAdapter } from './adapter';

/**
 * Lazy adapter constructors keyed by language id (matching
 * `LANGUAGE_DESCRIPTORS[].id`). Each grammar `require()` lives INSIDE its
 * arrow so it runs only when the loader is invoked.
 */
export const LANGUAGE_LOADERS: Record<string, () => LanguageAdapter> = {
    typescript: () => {
        // No grammar required — construct eagerly inside the arrow.
        const { TypeScriptAdapter } = require('./typescript/adapter');
        return new TypeScriptAdapter();
    },
    python: () => {
        require('tree-sitter-python');
        const { PythonAdapter } = require('./python/adapter');
        return new PythonAdapter();
    },
    cpp: () => {
        require('tree-sitter-cpp');
        const { CppAdapter } = require('./cpp/adapter');
        return new CppAdapter();
    },
    rust: () => {
        require('tree-sitter-rust');
        const { RustAdapter } = require('./rust/adapter');
        return new RustAdapter();
    },
    r: () => {
        require('@davisvaughan/tree-sitter-r');
        const { RAdapter } = require('./r/adapter');
        return new RAdapter();
    },
};
