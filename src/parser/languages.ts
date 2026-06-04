/**
 * Languages (composed registry view)
 *
 * Joins the PURE STATIC metadata in `./language-descriptors` with the lazy
 * adapter loaders in `./language-loaders` to produce `LANGUAGES`: the
 * registry's single source of truth, where each entry carries both the
 * static fields AND a `load()` that constructs its adapter.
 *
 * This split exists so config-only / metadata consumers can import the pure
 * descriptors directly (`./language-descriptors`) WITHOUT transitively pulling
 * in adapter modules or native tree-sitter grammars. Only the registry (which
 * actually needs `load()`) imports from here.
 *
 * Public surface is preserved: `CallGraphCapability`, `LanguageDescriptor`,
 * the `Language` type (descriptor + `load`), and the `LANGUAGES` array.
 */

import { LanguageAdapter } from './adapter';
import {
    LANGUAGE_DESCRIPTORS,
    type CallGraphCapability,
    type LanguageDescriptor,
} from './language-descriptors';
import { LANGUAGE_LOADERS } from './language-loaders';

// Re-export the static metadata types so existing importers of `./languages`
// (e.g. registry.ts) keep working unchanged.
export type { CallGraphCapability, LanguageDescriptor };

/**
 * A descriptor joined with its lazy adapter loader. This is what the registry
 * iterates over: every static field plus a `load()` that constructs the
 * language's adapter on demand.
 */
export interface Language extends LanguageDescriptor {
    /**
     * Construct the language's adapter. Lazy: any grammar `require()` lives
     * INSIDE the loader so it only runs when a consumer calls `load()`.
     */
    load: () => LanguageAdapter;
}

/**
 * Single source of truth for supported languages, composed from the static
 * descriptors and their lazy loaders. The registry consumes this; metadata-only
 * consumers should import `LANGUAGE_DESCRIPTORS` from `./language-descriptors`.
 */
export const LANGUAGES: readonly Language[] = LANGUAGE_DESCRIPTORS.map((d) => ({
    ...d,
    load: LANGUAGE_LOADERS[d.id],
}));
