import * as path from 'path';
import Parser = require('tree-sitter');

// Language bindings (using require as they often lack types or have specific export patterns)
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;
const JavaScript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');

export class CodeParser {
    private parser: Parser;
    private languages: Map<string, any>;

    constructor() {
        this.parser = new Parser();
        this.languages = new Map();

        this.languages.set('typescript', TypeScript);
        this.languages.set('tsx', TSX);
        this.languages.set('javascript', JavaScript);
        this.languages.set('python', Python);
    }

    public getLanguageForFile(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case '.ts':
                // Check if it's a react file potentially? For now assume TS
                // But .tsx is distinct in tree-sitter
                return 'typescript';
            case '.tsx':
                return 'tsx';
            case '.js':
            case '.jsx': // JS parser usually handles JSX or we might need separate
                return 'javascript';
            case '.py':
                return 'python';
            default:
                return 'unknown';
        }
    }

    public parse(filePath: string, content: string): Parser.Tree | null {
        const langName = this.getLanguageForFile(filePath);
        if (langName === 'unknown') {
            return null;
        }

        const language = this.languages.get(langName);
        if (!language) {
            console.warn(`Language ${langName} not configured.`);
            return null;
        }

        this.parser.setLanguage(language);
        return this.parser.parse(content);
    }
}
