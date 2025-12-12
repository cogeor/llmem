import { CodeParser } from './parser';
import { Extractor } from './extractor';
import { FileOutline, CodeOutline } from './types';

export class OutlineGenerator {
    private parser: CodeParser;
    private extractor: Extractor;

    constructor() {
        this.parser = new CodeParser();
        this.extractor = new Extractor();
    }

    public async generateFileOutline(filePath: string, content: string): Promise<FileOutline | null> {
        const tree = this.parser.parse(filePath, content);
        if (!tree) {
            return null;
        }

        const language = this.parser.getLanguageForFile(filePath);
        return this.extractor.extract(tree, language, filePath);
    }

    public formatForLLM(outline: FileOutline): string {
        let output = `File: ${outline.path} (${outline.language})\n`;

        // Imports
        if (outline.imports.length > 0) {
            output += `Imports:\n`;
            outline.imports.forEach(i => {
                output += `  - ${i.source} ([${i.specifiers.map(s => s.name).join(', ')}])\n`;
            });
        }

        // Exports
        if (outline.exports.length > 0) {
            output += `Exports:\n`;
            outline.exports.forEach(e => {
                output += `  - ${e.name} (${e.type})\n`;
            });
        }

        // Types
        if (outline.types.length > 0) {
            output += `Types/Interfaces:\n`;
            outline.types.forEach(t => {
                output += `  - ${t.kind} ${t.name}\n`;
            });
        }

        if (outline.classes.length > 0) {
            output += `Classes:\n`;
            outline.classes.forEach(c => {
                output += `  - ${c.name} : ${c.startLine}-${c.endLine}\n`;
                c.methods.forEach(m => {
                    output += `    - ${m.name}()\n`;
                });
            });
        }

        if (outline.functions.length > 0) {
            output += `Functions:\n`;
            outline.functions.forEach(f => {
                output += `  - ${f.name}(${f.params.map(p => p.name).join(', ')}) : ${f.startLine}-${f.endLine}\n`;
            });
        }

        return output;
    }
}
