/**
 * DesignTextView shadow-DOM styles (Loop 15 split).
 *
 * Extracted from `DesignTextView.ts` to keep the orchestrator file under
 * the 400-line file-size budget. The shadow DOM is set up by injecting
 * this string verbatim into `this.shadow.innerHTML` — see
 * `DesignTextView.ts` constructor. No interpolation, no user data.
 *
 * Pinned by the file-size-budget arch test
 * (`tests/arch/file-size-budget.test.ts`).
 */

// Inline styles for the Shadow DOM (works in both VS Code and standalone).
// safe: author-controlled static string literal; no interpolation, no
// user data. Consumed by `DesignTextView.ts` constructor.
export const DESIGN_TEXT_VIEW_STYLES = `
<style>
/* ===== Shadow DOM Host ===== */
:host {
    display: block;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    white-space: normal !important;  /* Override parent pre-wrap from .detail-view */
}

/* ===== View Mode: Rendered HTML ===== */
.design-view-content {
    width: 100%;
    padding: 16px;
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--foreground, #333);
    box-sizing: border-box;
}

/* Headings */
.design-view-content h1,
.design-view-content h2,
.design-view-content h3,
.design-view-content h4,
.design-view-content h5,
.design-view-content h6 {
    color: var(--foreground, #333);
    margin-bottom: 0.5em;
}

/* Links */
.design-view-content a {
    color: var(--focus-outline, #007acc);
    text-decoration: none;
}
.design-view-content a:hover {
    text-decoration: underline;
}

/* Code blocks (fenced with backticks) */
.design-view-content pre {
    background-color: var(--code-background, #f5f5f5);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid var(--border-color, #ddd);
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

/* Inline code (single backticks) */
.design-view-content code {
    background-color: var(--code-background, #f5f5f5);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
}

/* Code inside pre blocks - reset inline code styling */
.design-view-content pre code {
    background-color: transparent;
    padding: 0;
    border: none;
}

/* ===== Edit Mode: Markdown Textarea ===== */
.design-markdown-editor {
    width: 100%;
    min-height: 100%;
    padding: 16px;
    margin: 0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
    border: none;
    outline: none;
    resize: none;
    overflow: hidden;
    box-sizing: border-box;
    background-color: var(--background, #fff);
    color: var(--foreground, #333);
}

/* ===== Empty/Loading States ===== */
.detail-empty {
    padding: 24px;
    color: var(--foreground-muted, #888);
    text-align: left;
}

.detail-empty h3 {
    margin: 0 0 16px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--foreground, #ccc);
}

.detail-empty p {
    margin: 0 0 12px 0;
    font-size: 13px;
    line-height: 1.5;
}

.detail-empty code {
    background-color: var(--code-background, #2d2d2d);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 12px;
}

.detail-empty .hint {
    margin-top: 16px;
    padding: 12px;
    background-color: var(--code-background, #2d2d2d);
    border-radius: 4px;
    border-left: 3px solid var(--focus-outline, #007acc);
}

.detail-loading {
    padding: 24px;
    color: var(--foreground-muted, #888);
}
</style>
`;
