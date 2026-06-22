// src/parser/tsconfig-registry.ts
//
// Loop 02 — nearest-enclosing tsconfig resolution for import edges.
//
// Background: `ts-service.ts` builds ONE `ts.Program` for the whole
// workspace using compiler options loaded ONLY from
// `<workspaceRoot>/tsconfig.json`. On a monorepo with NO root tsconfig
// (the `@/*` path aliases live in e.g. `frontend/tsconfig.json`), those
// options carry no `paths`/`baseUrl`, so `ts.resolveModuleName` cannot
// resolve `@/...` and classifies internal alias imports as external.
//
// This registry corrects ONLY the options/cache handed to the per-file
// module resolver (`resolveModule` in `ts-extractor/extract-from-source.ts`).
// It does NOT rebuild the workspace `ts.Program` — the type checker / call
// graph keep using the workspace program unchanged.
//
// For a given source file it walks up the directory tree to the NEAREST
// ancestor directory containing a `tsconfig.json`, parses that config in
// its OWN directory (so `pathsBasePath` anchors `@/* -> ./src/*` at the
// tsconfig's dir, e.g. `frontend/src/*`, not the workspace root), and
// returns the parsed compiler options. Parsed options AND a dedicated
// `ts.ModuleResolutionCache` are cached per tsconfig directory — the cache
// is options-sensitive, so two configs with different `paths` must never
// share one.

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '../common/logger';

const log = createLogger('tsconfig-registry');

// Mirror the SKIP_DIRECTORIES set in ts-service.ts so discovery does not
// descend into vendored / generated trees.
const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'out',
    'build',
    '.artifacts',
]);

/**
 * Default compiler options used when a source file has NO ancestor
 * tsconfig.json. Matches the single-file fallback shape in
 * `program-builder.ts:getResolverOptions` so behavior is uniform with the
 * pre-Loop-02 pathless path.
 */
function defaultOptions(): ts.CompilerOptions {
    return {
        ...ts.getDefaultCompilerOptions(),
        allowJs: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };
}

interface TsconfigEntry {
    options: ts.CompilerOptions;
    cache: ts.ModuleResolutionCache;
}

/**
 * Per-workspace registry of nearest-enclosing tsconfig compiler options.
 *
 * Construct ONE per workspace root (alongside the `TypeScriptService`).
 * Discovery is performed lazily on first `optionsForFile`/`cacheForFile`
 * call and memoized for the registry's lifetime.
 */
export class TsconfigRegistry {
    private readonly workspaceRoot: string;

    /** Absolute, normalized (forward-slash) directories that contain a tsconfig.json. */
    private tsconfigDirs: string[] | undefined;

    /** Parsed options + resolution cache, keyed by tsconfig directory. */
    private readonly byDir = new Map<string, TsconfigEntry>();

    /** Default entry (options + cache) for files with no ancestor tsconfig. */
    private defaultEntry: TsconfigEntry | undefined;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = norm(path.resolve(workspaceRoot));
    }

    /**
     * Compiler options for resolving imports FROM `absFilePath`, derived
     * from the nearest ancestor tsconfig.json (or defaults when none).
     */
    public optionsForFile(absFilePath: string): ts.CompilerOptions {
        return this.entryForFile(absFilePath).options;
    }

    /**
     * `ts.ModuleResolutionCache` matching `optionsForFile(absFilePath)`.
     * One cache per tsconfig directory (options-sensitive) so two configs
     * with different `paths` never share resolutions.
     */
    public cacheForFile(absFilePath: string): ts.ModuleResolutionCache {
        return this.entryForFile(absFilePath).cache;
    }

    private entryForFile(absFilePath: string): TsconfigEntry {
        const dir = this.nearestTsconfigDir(norm(path.resolve(absFilePath)));
        if (!dir) {
            return this.getDefaultEntry();
        }
        let entry = this.byDir.get(dir);
        if (!entry) {
            entry = this.buildEntry(dir);
            this.byDir.set(dir, entry);
        }
        return entry;
    }

    private getDefaultEntry(): TsconfigEntry {
        if (!this.defaultEntry) {
            const options = defaultOptions();
            this.defaultEntry = {
                options,
                cache: ts.createModuleResolutionCache(
                    this.workspaceRoot,
                    (f) => f,
                    options
                ),
            };
        }
        return this.defaultEntry;
    }

    /**
     * Parse the tsconfig.json in `tsconfigDir` (basePath = its OWN dir so
     * `pathsBasePath` anchors `paths`/`baseUrl` there) and build a matching
     * resolution cache. `extends` is handled by TS's config parser.
     */
    private buildEntry(tsconfigDir: string): TsconfigEntry {
        const options = this.parseTsconfig(tsconfigDir);
        return {
            options,
            cache: ts.createModuleResolutionCache(
                tsconfigDir,
                (f) => f,
                options
            ),
        };
    }

    private parseTsconfig(tsconfigDir: string): ts.CompilerOptions {
        const tsconfigPath = path.join(tsconfigDir, 'tsconfig.json');
        try {
            const configFile = ts.readConfigFile(tsconfigPath, (p) =>
                fs.readFileSync(p, 'utf8')
            );
            if (configFile.error) {
                log.warn('Error reading tsconfig.json', {
                    path: tsconfigPath,
                    error: ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
                });
                return defaultOptions();
            }

            const parseHost: ts.ParseConfigHost = {
                readFile: (p) => fs.readFileSync(p, 'utf8'),
                // We do our own file discovery; do not let TS walk the tree.
                readDirectory: () => [],
                useCaseSensitiveFileNames: ts.sys ? ts.sys.useCaseSensitiveFileNames : true,
                fileExists: (p) => fs.existsSync(p),
            };

            // THIRD arg (basePath) is the tsconfig's OWN directory — this
            // sets `pathsBasePath` so `@/* -> ./src/*` anchors at this dir
            // (e.g. `frontend/src/*`), NOT the workspace root.
            const parsed = ts.parseJsonConfigFileContent(
                configFile.config,
                parseHost,
                tsconfigDir
            );

            const realErrors = parsed.errors.filter((e) => {
                const msg = ts.flattenDiagnosticMessageText(e.messageText, '');
                return !msg.includes('No inputs were found');
            });
            if (realErrors.length > 0) {
                log.warn('tsconfig.json parse errors', {
                    path: tsconfigPath,
                    errors: realErrors
                        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
                        .join('; '),
                });
            }

            // Merge defaults under parsed so paths/baseUrl/pathsBasePath
            // from the tsconfig win, while critical resolution defaults
            // (allowJs, moduleResolution) are present when the config omits
            // them.
            return {
                ...defaultOptions(),
                ...parsed.options,
                skipLibCheck: true,
            };
        } catch (e) {
            log.warn('Failed to load tsconfig.json', {
                path: tsconfigPath,
                error: e instanceof Error ? e.message : String(e),
            });
            return defaultOptions();
        }
    }

    /**
     * Nearest ancestor directory of `absFileNorm` that contains a discovered
     * tsconfig.json, or undefined. Both inputs and stored dirs are
     * normalized to forward-slash absolute paths.
     */
    private nearestTsconfigDir(absFileNorm: string): string | undefined {
        const dirs = this.getTsconfigDirs();
        if (dirs.length === 0) {
            return undefined;
        }
        const dirSet = new Set(dirs);
        let cur = norm(path.dirname(absFileNorm));
        // Walk up until the filesystem root.
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (dirSet.has(cur)) {
                return cur;
            }
            const parent = norm(path.dirname(cur));
            if (parent === cur) {
                return undefined;
            }
            cur = parent;
        }
    }

    private getTsconfigDirs(): string[] {
        if (this.tsconfigDirs === undefined) {
            const found: string[] = [];
            this.discover(this.workspaceRoot, found);
            this.tsconfigDirs = found;
            log.info('Discovered tsconfig.json files', { count: found.length });
        }
        return this.tsconfigDirs;
    }

    private discover(dir: string, out: string[]): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const name = entry.name;
            if (entry.isDirectory()) {
                if (name.startsWith('.') || SKIP_DIRECTORIES.has(name)) {
                    continue;
                }
                this.discover(norm(path.join(dir, name)), out);
            } else if (name === 'tsconfig.json') {
                out.push(norm(dir));
            }
        }
    }
}

/** Normalize an absolute path to forward slashes (case preserved). */
function norm(p: string): string {
    return p.replace(/\\/g, '/');
}
