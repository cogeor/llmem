
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// Whitelist of TypeScript/JavaScript file extensions
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// Directories to always skip
const SKIP_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'out',
    'build',
    '.artifacts'
]);

// File extensions to always skip (binary/problematic files)
const SKIP_EXTENSIONS = new Set(['.asar', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.node']);

export class TypeScriptService {
    private program: ts.Program | undefined;
    private workspaceRoot: string;

    constructor(root: string) {
        this.workspaceRoot = root;
        this.initializeProgram();
    }

    private initializeProgram() {
        try {
            // Get compiler options from tsconfig (if exists) WITHOUT using ts.sys for file discovery
            const compilerOptions = this.loadCompilerOptions();

            // Use our own whitelist-based file discovery
            const files = this.getTypeScriptFiles(this.workspaceRoot);

            if (files.length === 0) {
                console.log('[TypeScriptService] No TypeScript/JavaScript files found');
                this.program = undefined;
                return;
            }

            this.program = ts.createProgram(files, compilerOptions);
            console.log(`[TypeScriptService] Initialized with ${files.length} files`);
        } catch (e) {
            console.warn('[TypeScriptService] Failed to initialize program:', e);
            this.program = undefined;
        }
    }

    /**
     * Load compiler options from tsconfig.json using TypeScript's proper config parsing.
     * This correctly handles enum values like moduleResolution, jsx, etc.
     */
    private loadCompilerOptions(): ts.CompilerOptions {
        const defaultOptions: ts.CompilerOptions = {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            allowJs: true,
            esModuleInterop: true,
            skipLibCheck: true
        };

        const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');

        try {
            if (!fs.existsSync(tsconfigPath)) {
                console.log('[TypeScriptService] No tsconfig.json found, using defaults');
                return defaultOptions;
            }

            // Use TypeScript's built-in config parsing (handles enum conversions)
            const configFile = ts.readConfigFile(tsconfigPath, (filePath) =>
                fs.readFileSync(filePath, 'utf8')
            );

            if (configFile.error) {
                console.warn('[TypeScriptService] Error reading tsconfig.json:',
                    ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
                return defaultOptions;
            }

            // Parse the config content - this converts strings to proper enum values
            const parsed = ts.parseJsonConfigFileContent(
                configFile.config,
                {
                    readFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
                    readDirectory: () => [], // We don't want TS to discover files
                    useCaseSensitiveFileNames: true,
                    fileExists: (filePath) => fs.existsSync(filePath),
                    getCurrentDirectory: () => this.workspaceRoot
                },
                this.workspaceRoot
            );

            // Filter out the harmless "No inputs were found" warning (we do our own file discovery)
            const realErrors = parsed.errors.filter(e => {
                const msg = ts.flattenDiagnosticMessageText(e.messageText, '');
                return !msg.includes('No inputs were found');
            });

            if (realErrors.length > 0) {
                console.warn('[TypeScriptService] tsconfig.json parse errors:',
                    realErrors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('; '));
            }

            // Merge with defaults to ensure critical options are set
            return {
                ...defaultOptions,
                ...parsed.options,
                // Always skip lib check for performance
                skipLibCheck: true
            };
        } catch (e) {
            console.warn('[TypeScriptService] Failed to load tsconfig.json:', e);
            return defaultOptions;
        }
    }

    private parseTarget(target: string | undefined): ts.ScriptTarget | undefined {
        if (!target) return undefined;
        const key = target.toUpperCase();
        const map: Record<string, ts.ScriptTarget> = {
            'ES5': ts.ScriptTarget.ES5,
            'ES6': ts.ScriptTarget.ES2015,
            'ES2015': ts.ScriptTarget.ES2015,
            'ES2016': ts.ScriptTarget.ES2016,
            'ES2017': ts.ScriptTarget.ES2017,
            'ES2018': ts.ScriptTarget.ES2018,
            'ES2019': ts.ScriptTarget.ES2019,
            'ES2020': ts.ScriptTarget.ES2020,
            'ES2021': ts.ScriptTarget.ES2021,
            'ES2022': ts.ScriptTarget.ES2022,
            'ESNEXT': ts.ScriptTarget.ESNext,
        };
        return map[key];
    }

    private parseModule(module: string | undefined): ts.ModuleKind | undefined {
        if (!module) return undefined;
        const key = module.toUpperCase();
        const map: Record<string, ts.ModuleKind> = {
            'COMMONJS': ts.ModuleKind.CommonJS,
            'AMD': ts.ModuleKind.AMD,
            'UMD': ts.ModuleKind.UMD,
            'SYSTEM': ts.ModuleKind.System,
            'ES6': ts.ModuleKind.ES2015,
            'ES2015': ts.ModuleKind.ES2015,
            'ES2020': ts.ModuleKind.ES2020,
            'ES2022': ts.ModuleKind.ES2022,
            'ESNEXT': ts.ModuleKind.ESNext,
            'NODE16': ts.ModuleKind.Node16,
            'NODENEXT': ts.ModuleKind.NodeNext,
        };
        return map[key];
    }

    public getProgram(): ts.Program | undefined {
        return this.program;
    }

    /**
     * Whitelist-based file discovery.
     * Only walks directories that are safe and only returns files with supported extensions.
     */
    private getTypeScriptFiles(dir: string, fileList: string[] = []): string[] {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            // Directory not accessible
            return fileList;
        }

        for (const entry of entries) {
            // Skip hidden files/directories and blacklisted directories
            if (entry.startsWith('.') || SKIP_DIRECTORIES.has(entry)) {
                continue;
            }

            const fullPath = path.join(dir, entry);
            const ext = path.extname(entry).toLowerCase();

            // Explicitly skip problematic file extensions before any stat call
            if (SKIP_EXTENSIONS.has(ext)) {
                continue;
            }

            // Skip files with non-whitelisted extensions
            // Only proceed to stat if: no extension (might be dir), or whitelisted extension
            if (ext && !TS_EXTENSIONS.has(ext)) {
                continue;
            }

            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    this.getTypeScriptFiles(fullPath, fileList);
                } else if (TS_EXTENSIONS.has(ext)) {
                    fileList.push(fullPath);
                }
            } catch {
                // File not accessible - skip silently
                continue;
            }
        }

        return fileList;
    }
}
