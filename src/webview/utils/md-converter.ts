import * as fs from 'fs';
import * as path from 'path';

export async function convertMarkdownFile(filePath: string): Promise<void> {
    const { marked } = await import('marked');
    const content = fs.readFileSync(filePath, 'utf8');
    const htmlContent = await marked.parse(content);

    // Just write the HTML fragment. The webview will inject it into the shadow DOM where styles are applied.
    fs.writeFileSync(filePath.replace('.md', '.html'), htmlContent, 'utf8');
}

export async function convertAllMarkdown(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            await convertAllMarkdown(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            await convertMarkdownFile(fullPath);
        }
    }
}
