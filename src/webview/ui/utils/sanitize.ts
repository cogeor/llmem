/**
 * HTML sanitizer for browser-side markdown injection.
 *
 * Loop 13: design documents are rendered server-side through `marked`, then
 * shipped to the webview as HTML. A malicious `.arch/<file>.md` could carry
 * `<script>` tags or `onerror` handlers; we strip those here before any
 * `innerHTML = ...` assignment that injects markdown-derived HTML.
 *
 * The allowlist is intentionally narrow — exactly the tags `marked` produces
 * for standard CommonMark + GFM tables — plus a small set of safe attributes.
 * URL-bearing attributes (`href`, `src`) get a default `javascript:` strip
 * via DOMPurify's URL handling.
 */
import DOMPurify from 'dompurify';

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

export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        // Belt-and-suspenders: explicitly forbid anything dangerous even if
        // it sneaks back into ALLOWED_TAGS via a refactor.
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['style', 'on*'],
    });
}
