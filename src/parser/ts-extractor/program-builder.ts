import * as ts from 'typescript';

/**
 * Per-`extract()`-call resolver context.
 *
 * The cache lives here (NOT on the extractor instance) because
 * `ts.ModuleResolutionCache` is keyed on compiler options + cwd. The
 * extractor may be called against the disk-backed program in one call
 * and the in-memory branch in another, with potentially different
 * options — pinning a per-extractor cache would be unsound.
 */
export interface ResolveContext {
    workspaceRoot: string;
    options: ts.CompilerOptions;
    host: ts.ModuleResolutionHost;
    cache: ts.ModuleResolutionCache;
}

/**
 * Compiler options used by the resolver when no live program is
 * available (i.e. the "single-file fallback" branch). Mirrors what
 * the in-memory branch uses, augmented with `allowJs` and an
 * explicit `moduleResolution` so the wrapper doesn't fall back to
 * Classic resolution.
 */
export function getResolverOptions(
    programProvider: () => ts.Program | undefined
): ts.CompilerOptions {
    const program = programProvider();
    if (program) {
        return program.getCompilerOptions();
    }
    return {
        ...ts.getDefaultCompilerOptions(),
        allowJs: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
}

/**
 * Build a one-file `ts.Program` rooted at `filePath` but backed by the
 * provided `content`. The CompilerHost is overridden so that
 * `getSourceFile`/`readFile`/`fileExists` for `filePath` return the
 * in-memory bytes; all OTHER files still go through the base host
 * (i.e. real disk reads), so imports of sibling files / lib.d.ts /
 * tsconfig still work.
 *
 * Returns the host and options too so Loop 12's
 * `ts.resolveModuleName` resolver can share the SAME host the
 * program was built with — this lets self-relative imports of the
 * in-memory file see it as existing.
 */
export function createInMemoryProgram(
    programProvider: () => ts.Program | undefined,
    filePath: string,
    content: string
): {
    sourceFile: ts.SourceFile | undefined;
    checker: ts.TypeChecker | undefined;
    host: ts.CompilerHost;
    options: ts.CompilerOptions;
} {
    const options = getResolverOptions(programProvider);

    const baseHost = ts.createCompilerHost(options);

    // TS normalizes paths to forward slashes internally before passing them
    // to host hooks, while `baseHost.getCanonicalFileName` only adjusts
    // case (lowercases on Windows). To match either form we compare on a
    // normalized canonical: lowercase via baseHost, then forward-slashes.
    const normalize = (p: string) =>
        baseHost.getCanonicalFileName(p).replace(/\\/g, '/');
    const canonicalTarget = normalize(filePath);
    const matchesTarget = (name: string) =>
        name === filePath || normalize(name) === canonicalTarget;

    const host: ts.CompilerHost = {
        ...baseHost,
        getSourceFile: (name, lang, onErr, shouldCreate) => {
            if (matchesTarget(name)) {
                return ts.createSourceFile(
                    filePath,
                    content,
                    options.target ?? ts.ScriptTarget.ES2020,
                    /* setParentNodes */ true
                );
            }
            return baseHost.getSourceFile(name, lang, onErr, shouldCreate);
        },
        readFile: (name) => {
            if (matchesTarget(name)) {
                return content;
            }
            return baseHost.readFile(name);
        },
        fileExists: (name) => {
            if (matchesTarget(name)) {
                return true;
            }
            return baseHost.fileExists(name);
        },
    };

    const program = ts.createProgram({
        rootNames: [filePath],
        options,
        host,
    });

    return {
        sourceFile: program.getSourceFile(filePath),
        checker: program.getTypeChecker(),
        host,
        options,
    };
}
