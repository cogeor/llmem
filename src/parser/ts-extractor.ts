import * as ts from 'typescript';
import { FileArtifact } from './types';
import { ArtifactExtractor } from './interfaces';
import { createResolutionCache } from './ts-module-resolver';
import {
    ResolveContext,
    getResolverOptions,
    createInMemoryProgram,
} from './ts-extractor/program-builder';
import { extractFromSource } from './ts-extractor/extract-from-source';
import { TsconfigRegistry } from './tsconfig-registry';

export class TypeScriptExtractor implements ArtifactExtractor {
    private workspaceRoot: string;

    constructor(
        private programProvider: () => ts.Program | undefined,
        workspaceRoot?: string,
        /**
         * Loop 02 — nearest-enclosing tsconfig registry. When provided, the
         * options/cache handed to the per-file module resolver come from the
         * NEAREST ancestor tsconfig of the file being extracted, so `paths`/
         * `baseUrl` resolve even on a monorepo whose `@/*` aliases live in a
         * subdirectory tsconfig (not at the workspace root). The workspace
         * `ts.Program` (type checker / call graph) is unaffected.
         */
        private tsconfigRegistry?: TsconfigRegistry
    ) {
        // Use provided workspace root, or fall back to cwd
        this.workspaceRoot = workspaceRoot || process.cwd();
    }

    public async extract(filePath: string, content?: string): Promise<FileArtifact | null> {
        let sourceFile: ts.SourceFile | undefined;
        let checker: ts.TypeChecker | undefined;
        let resolveCtx: ResolveContext | undefined;

        if (content !== undefined) {
            // Honor the content contract (see ArtifactExtractor JSDoc):
            // build a one-file program rooted at filePath but backed by
            // `content`, without reading filePath from disk.
            const result = createInMemoryProgram(this.programProvider, filePath, content);
            sourceFile = result.sourceFile;
            checker = result.checker;
            // The resolver MUST share the host that backs the program so
            // that self-relative imports of the in-memory file see it
            // existing.
            resolveCtx = {
                workspaceRoot: this.workspaceRoot,
                options: result.options,
                host: result.host,
                cache: createResolutionCache(result.options, this.workspaceRoot),
            };
        } else {
            const program = this.programProvider();

            if (program) {
                sourceFile = program.getSourceFile(filePath);
                checker = program.getTypeChecker();
                if (sourceFile) {
                    const options = program.getCompilerOptions();
                    // ts.Program does not expose its CompilerHost. The
                    // resolver only needs ModuleResolutionHost surface
                    // (fileExists/readFile/directoryExists), which a
                    // freshly-created CompilerHost provides identically
                    // for disk-backed lookups.
                    const host = ts.createCompilerHost(options);
                    resolveCtx = {
                        workspaceRoot: this.workspaceRoot,
                        options,
                        host,
                        cache: createResolutionCache(options, this.workspaceRoot),
                    };
                }
            }

            if (!sourceFile) {
                // File not in main program (e.g. new file, or file outside root).
                // Create a temporary program for single-file analysis.
                // This is slower but ensures we get results.
                const fallbackOptions = getResolverOptions(this.programProvider);
                const tempProgram = ts.createProgram([filePath], fallbackOptions);
                sourceFile = tempProgram.getSourceFile(filePath);
                checker = tempProgram.getTypeChecker();
                const host = ts.createCompilerHost(fallbackOptions);
                resolveCtx = {
                    workspaceRoot: this.workspaceRoot,
                    options: fallbackOptions,
                    host,
                    cache: createResolutionCache(fallbackOptions, this.workspaceRoot),
                };
            }
        }

        if (!sourceFile || !checker || !resolveCtx) {
            return null;
        }

        // Loop 02 — correct the import-edge resolver options/cache for THIS
        // file using its nearest-enclosing tsconfig. The workspace program's
        // options (used above for the type checker / call graph) are left
        // intact; only the `resolveModule` call inside extractFromSource sees
        // these per-file options. The cache is options-sensitive, so it comes
        // from the same registry entry to avoid cross-config contamination.
        if (this.tsconfigRegistry) {
            resolveCtx = {
                ...resolveCtx,
                options: this.tsconfigRegistry.optionsForFile(filePath),
                cache: this.tsconfigRegistry.cacheForFile(filePath),
            };
        }

        return extractFromSource(this.workspaceRoot, sourceFile, checker, resolveCtx);
    }
}
