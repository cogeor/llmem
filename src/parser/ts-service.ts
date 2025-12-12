
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

export class TypeScriptService {
    private program: ts.Program | undefined;
    private workspaceRoot: string;
    private configPath: string | undefined;

    constructor(root: string) {
        this.workspaceRoot = root;
        this.configPath = ts.findConfigFile(
            root,
            ts.sys.fileExists,
            'tsconfig.json'
        );
        this.initializeProgram();
    }

    private initializeProgram() {
        if (!this.configPath) {
            // Fallback: create a program with default options for the root
            // This is less ideal but works for simple setups
            const files = this.getAllFiles(this.workspaceRoot);
            this.program = ts.createProgram(files, {
                target: ts.ScriptTarget.ES2020,
                module: ts.ModuleKind.CommonJS,
                allowJs: true
            });
            return;
        }

        const configFile = ts.readConfigFile(this.configPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(this.configPath)
        );

        this.program = ts.createProgram(
            parsedConfig.fileNames,
            parsedConfig.options
        );
    }

    public getProgram(): ts.Program | undefined {
        return this.program;
    }

    // Simple file walker for fallback (simplified)
    private getAllFiles(dir: string, fileList: string[] = []): string[] {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                if (file !== 'node_modules' && file !== '.git') {
                    this.getAllFiles(filePath, fileList);
                }
            } else {
                if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.tsx')) {
                    fileList.push(filePath);
                }
            }
        });
        return fileList;
    }
}
