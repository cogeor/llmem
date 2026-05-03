import * as fs from 'fs';
import * as path from 'path';
import { renderMarkdown } from '../markdown-renderer';

export async function convertMarkdownFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf8');
    // Loop 19: route through the centralized renderer. The output `.html`
    // is therefore already DOMPurify-sanitized; the webview's browser-side
    // sanitize pass at injection time is the second line of defense.
    const htmlContent = await renderMarkdown(content);

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
