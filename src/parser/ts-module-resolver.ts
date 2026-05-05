// src/parser/ts-module-resolver.ts
//
// Loop 12 — documented thin wrapper over `ts.resolveModuleName`.
//
// This module is intentionally a pure utility: it MUST NOT import from
// `ts-extractor.ts`, `ts-service.ts`, or `interfaces.ts`. Both the
// disk-backed and in-memory branches of TypeScriptExtractor consume the
// same `resolveModule()` so resolution is uniform.

import * as ts from 'typescript';
import * as path from 'path';

/**
 * Result of resolving a single module specifier.
 *
 * - `kind: 'resolved'` — TypeScript found a real source file.
 *   `resolvedPath` is the workspace-relative POSIX path.
 *   `isExternal` is true iff the file lives under `node_modules/`.
 * - `kind: 'external'` — TypeScript classified the specifier as an
 *   ambient/external module that does not resolve to a workspace file
 *   (e.g. `'react'` with no `@types/react` in the program). Caller MUST
 *   leave `resolvedPath = null` and keep the original `source` string.
 * - `kind: 'unresolved'` — TypeScript could not resolve the specifier
 *   at all (typo, missing dep). Caller MUST leave `resolvedPath = null`.
 *
 * The three-way enum is load-bearing: callers can distinguish "this is a
 * real npm module we just don't have types for" from "this is broken"
 * without reading TypeScript's failed-lookup-locations array.
 */
export type ModuleResolutionResult =
    | { kind: 'resolved'; resolvedPath: string; isExternal: boolean }
    | { kind: 'external' }
    | { kind: 'unresolved' };

/**
 * Returns true if a specifier is "relative-shaped" — i.e. a `./`, `../`,
 * `/`, or Windows drive path. Bare specifiers (e.g. `'react'`,
 * `'@/foo'`, `'utils/log'` under baseUrl) are NOT relative-shaped.
 */
function isRelativeSpecifier(spec: string): boolean {
    if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
        return true;
    }
    if (spec.startsWith('/')) {
        return true;
    }
    // Windows drive (e.g. 'C:\foo' or 'C:/foo')
    if (/^[a-zA-Z]:[\\/]/.test(spec)) {
        return true;
    }
    return false;
}

/**
 * Thin wrapper over `ts.resolveModuleName` that:
 *  1. Pins compiler options (passed in by caller).
 *  2. Reuses a `ts.ModuleResolutionCache` for the workspace.
 *  3. Maps TypeScript's `ResolvedModuleWithFailedLookupLocations` to our
 *     `ModuleResolutionResult` discriminated union.
 *  4. Normalizes the resolved file path to a workspace-relative POSIX
 *     string, matching the convention used by `FileArtifact.file.id`.
 *
 * @param moduleName     The literal text of the import specifier (e.g.
 *                       `'./foo'`, `'react'`, `'@/utils/log'`).
 * @param containingFile Absolute path of the importing file.
 * @param options        Compiler options to use for resolution. Callers
 *                       SHOULD pass options derived from the workspace's
 *                       tsconfig (so `paths`/`baseUrl`/`moduleResolution`
 *                       take effect). When no tsconfig exists, callers
 *                       MUST pass `ts.getDefaultCompilerOptions()` or a
 *                       documented superset thereof.
 * @param host           A `ts.ModuleResolutionHost`. The same in-memory
 *                       host used to back `ts.createProgram` may be
 *                       reused; the resolver only consults
 *                       `fileExists`/`readFile`/`directoryExists`.
 * @param cache          Optional `ts.ModuleResolutionCache` for
 *                       performance — strongly recommended, one per
 *                       (workspace, options) pair.
 * @param workspaceRoot  Absolute path. Used only to compute the returned
 *                       workspace-relative `resolvedPath` (POSIX).
 */
export function resolveModule(
    moduleName: string,
    containingFile: string,
    options: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
    cache: ts.ModuleResolutionCache | undefined,
    workspaceRoot: string
): ModuleResolutionResult {
    const result = ts.resolveModuleName(
        moduleName,
        containingFile,
        options,
        host,
        cache
    );

    const resolved = result.resolvedModule;

    if (!resolved) {
        // TypeScript could not resolve. Distinguish "external lib we don't
        // have types for" from "broken/relative-but-missing".
        if (isRelativeSpecifier(moduleName)) {
            return { kind: 'unresolved' };
        }
        return { kind: 'external' };
    }

    const resolvedFileName = resolved.resolvedFileName;
    const extension = resolved.extension;

    // .d.ts-only resolutions classify as external for edge-list purposes.
    // Drawing an edge from src/foo.ts → node_modules/@types/react/index.d.ts
    // is not what we want — the bare 'react' string carries the external
    // identity downstream. (See external-module-node.test.ts.)
    if (extension === ts.Extension.Dts) {
        return { kind: 'external' };
    }

    // Normalize to workspace-relative POSIX. path.relative() handles
    // case sensitivity per the platform.
    const relPath = path
        .relative(workspaceRoot, resolvedFileName)
        .replace(/\\/g, '/');

    // Detect node_modules-resident files (case-insensitive on Windows).
    // Normalize separators first so the substring check is uniform.
    const normalizedFileName = resolvedFileName.replace(/\\/g, '/').toLowerCase();
    const isExternal = normalizedFileName.includes('/node_modules/');

    return {
        kind: 'resolved',
        resolvedPath: relPath,
        isExternal,
    };
}

/**
 * Convenience factory for `ts.ModuleResolutionCache`. Callers can use
 * this to avoid importing `ts` solely for the cache constructor.
 *
 * Cache is keyed on (cwd, compiler options); pass a fresh one per
 * `extract()` call to avoid cross-call invalidation concerns.
 *
 * @param options Compiler options the cache will be associated with.
 * @param cwd     Current working directory for the cache.
 */
export function createResolutionCache(
    options: ts.CompilerOptions,
    cwd: string
): ts.ModuleResolutionCache {
    return ts.createModuleResolutionCache(
        cwd,
        (fileName) => fileName,
        options
    );
}
