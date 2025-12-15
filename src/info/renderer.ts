/**
 * Render file info as human-readable markdown
 */

import { FileInfo, FunctionInfo, ClassInfo, CallerInfo } from './types';

/**
 * Format a list of callers as markdown bullet points
 * Returns empty string if no callers found
 */
function formatCallers(callers: CallerInfo[]): string {
    if (callers.length === 0) {
        return '';
    }

    return callers
        .map(c => `- \`${c.name}\` in \`${c.file}\``)
        .join('\n') + '\n';
}

/**
 * Render a function/method as markdown
 */
function renderFunction(func: FunctionInfo, headingLevel: string): string {
    const lines: string[] = [];

    // Function heading with signature
    const exportMark = func.isExported ? ' *(exported)*' : '';
    lines.push(`${headingLevel} \`${func.signature}\`${exportMark}`);
    lines.push('');

    // Called by section - only if there are callers
    const callersText = formatCallers(func.calledBy);
    if (callersText) {
        lines.push('**Called by:**');
        lines.push(callersText);
    }

    return lines.join('\n');
}

/**
 * Render a class as markdown
 */
function renderClass(cls: ClassInfo): string {
    const lines: string[] = [];

    // Class heading
    const exportMark = cls.isExported ? ' *(exported)*' : '';
    lines.push(`### \`${cls.signature}\`${exportMark}`);
    lines.push('');

    if (cls.methods.length === 0) {
        lines.push('*No methods*');
        lines.push('');
    } else {
        lines.push('#### Methods');
        lines.push('');

        for (const method of cls.methods) {
            lines.push(renderFunction(method, '#####'));
        }
    }

    return lines.join('\n');
}

/**
 * Render complete file info as markdown
 * 
 * @param info The file info to render
 * @returns Human-readable markdown string
 */
export function renderFileInfoMarkdown(info: FileInfo): string {
    const lines: string[] = [];

    // File header
    lines.push(`# ${info.filePath}`);
    lines.push('');

    // Functions section
    if (info.functions.length > 0) {
        lines.push('## Functions');
        lines.push('');

        for (const func of info.functions) {
            lines.push(renderFunction(func, '###'));
        }
    }

    // Classes section
    if (info.classes.length > 0) {
        lines.push('## Classes');
        lines.push('');

        for (const cls of info.classes) {
            lines.push(renderClass(cls));
        }
    }

    // Handle empty files
    if (info.functions.length === 0 && info.classes.length === 0) {
        lines.push('*No functions or classes found in this file.*');
        lines.push('');
    }

    return lines.join('\n');
}
