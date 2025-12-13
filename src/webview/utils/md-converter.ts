import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';

export function convertMarkdownFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf8');
    const htmlContent = marked.parse(content);

    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${path.basename(filePath, '.md')}</title>
    <style>
        body { font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
        code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
        h1, h2, h3 { color: #333; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    ${htmlContent}
</body>
</html>
    `;

    const destPath = filePath.replace('.md', '.html');
    fs.writeFileSync(destPath, template, 'utf8');
}

export function convertAllMarkdown(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            convertAllMarkdown(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            convertMarkdownFile(fullPath);
        }
    }
}
