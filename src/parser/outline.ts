import { CodeParser } from './parser';
import { Extractor } from './extractor';
import { FileArtifact, CodeOutline } from './types';

export class OutlineGenerator {
    private parser: CodeParser;
    private extractor: Extractor;

    constructor() {
        this.parser = new CodeParser();
        this.extractor = new Extractor();
    }

    public async generateFileOutline(filePath: string, content: string): Promise<FileArtifact | null> {
        const tree = this.parser.parse(filePath, content);
        if (!tree) {
            return null;
        }

        const language = this.parser.getLanguageForFile(filePath);
        return this.extractor.extract(tree, language, filePath);
    }

    public formatForLLM(outline: FileArtifact): string {
        let output = `File: ${outline.file.path} (${outline.file.language})\n`;

        // Imports
        if (outline.imports.length > 0) {
            output += `Imports:\n`;
            outline.imports.forEach(i => {
                const specs = i.specifiers.map(s => s.alias ? `${s.name} as ${s.alias}` : s.name).join(', ');
                output += `  - ${i.source} (${specs})\n`;
            });
        }

        // Exports
        if (outline.exports.length > 0) {
            output += `Exports:\n`;
            outline.exports.forEach(e => {
                output += `  - ${e.name} (${e.type})\n`;
            });
        }

        // Entities (Classes, Functions, etc)
        if (outline.entities.length > 0) {
            // Group by class if method
            // The entities list is flat.
            // We can just dump them or try to reconstruct hierarchy if we want.
            // For LLM summary, flat list with signatures is fine.
            output += `Entities:\n`;
            outline.entities.forEach(e => {
                output += `  - [${e.kind}] ${e.name}`;
                if (e.signature) output += `: ${e.signature}`;
                output += ` (Line ${e.loc.startLine}-${e.loc.endLine})`;
                if (e.isExported) output += ` [EXPORTED]`;
                output += `\n`;

                if (e.calls && e.calls.length > 0) {
                    output += `    Calls: ${e.calls.slice(0, 5).map(c => c.calleeName).join(', ')}${e.calls.length > 5 ? '...' : ''}\n`;
                }
            });
        }

        return output;
    }
}
