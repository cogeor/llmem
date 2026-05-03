// src/webview/markdown-renderer.ts
//
// Loop 19: single home for server-side markdown -> sanitized HTML.
// Replaces the four duplicated `new Function`-based dynamic-import shims
// that previously dynamic-imported `marked` from
// `src/webview/design-docs.ts`, `src/extension/panel.ts`,
// `src/extension/hot-reload.ts`, and `src/claude/server/arch-watcher.ts`.
//
// The dynamic-import shim is preserved here (marked v17 is ESM-only and
// `tsconfig.base.json` sets `module: commonjs`, which would otherwise downlevel
// `import('marked')` to `require('marked')` and fail at runtime). It now lives
// in exactly ONE place, marked with an inline `eslint-disable`. Spreading it
// back into call sites is forbidden — see PLAN Decision §1.
//
// We additionally run DOMPurify on the Node side so consumers receive HTML
// that is already safe; the webview still re-sanitizes at innerHTML injection
// (`src/webview/ui/utils/sanitize.ts`, used by `DesignRender.ts:109`) — that
// is intentional defense in depth (PLAN Decision §2).

import { JSDOM } from 'jsdom';
import createDOMPurify, { type WindowLike } from 'dompurify';

let markedInstance: { parse: (md: string) => string | Promise<string> } | null = null;
let purify: ReturnType<typeof createDOMPurify> | null = null;

async function ensureMarked(): Promise<{ parse: (md: string) => string | Promise<string> }> {
    if (markedInstance) return markedInstance;
    // Native dynamic import; TS would downlevel a static `import('marked')`
    // to require() under `module: commonjs`. The `new Function` wrapper
    // defeats that downlevel. This is the ONE place in the codebase that
    // does this — PLAN §19 invariant: `Grep "new Function\(" src/` returns
    // exactly one hit, located in this file.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const dynImport = new Function('s', 'return import(s)') as
        (s: string) => Promise<any>;
    const mod = await dynImport('marked');
    const marked = mod.marked;
    marked.setOptions({ gfm: true, breaks: false });
    markedInstance = marked;
    return marked;
}

function ensurePurify(): ReturnType<typeof createDOMPurify> {
    if (purify) return purify;
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    purify = createDOMPurify(dom.window as unknown as WindowLike);
    return purify;
}

// Allowlist mirrors `src/webview/ui/utils/sanitize.ts:16-52` exactly.
// PLAN Decision §3 defers extracting this into a shared module to Loop 39.
const ALLOWED_TAGS: string[] = [
    // Block-level
    'p', 'br', 'hr', 'div', 'span',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Inline formatting
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
    // Code
    'code', 'pre', 'kbd', 'samp', 'var',
    // Quotes
    'blockquote', 'q', 'cite',
    // Lists
    'ul', 'ol', 'li',
    // Links and images (URLs are filtered by DOMPurify defaults)
    'a', 'img',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    // Definition lists
    'dl', 'dt', 'dd',
    // Misc
    'sub', 'sup',
];

const ALLOWED_ATTR: string[] = [
    'href',
    'title',
    'class',
    'id',
    'src',
    'alt',
    'width',
    'height',
    // GFM tables emit align="..."
    'align',
    // Code blocks may carry language hints
    'data-language',
];

/**
 * Render a markdown string to sanitized HTML.
 *
 * Pipeline: GFM markdown rendering via `marked` -> DOMPurify.sanitize
 * (server-side). The output is safe to assign to innerHTML; the
 * browser-side sanitizer (`sanitize.ts`) will run again at injection time
 * as a second line of defense.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
    const md = await ensureMarked();
    const raw = md.parse(markdown);
    const dirty = typeof raw === 'string' ? raw : await raw;
    const dompurify = ensurePurify();
    return dompurify.sanitize(dirty, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['style', 'on*'],
    }) as unknown as string;
}
