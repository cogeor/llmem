/**
 * Request-ID generation for `VSCodeDataProvider`.
 *
 * Extracted from `services/vscodeDataProvider.ts` (Loop 22 file-size split).
 * Pure browser code — no node/vscode imports.
 *
 * We prefer `crypto.randomUUID()` because the VS Code webview runtime, the
 * static-mode browser bundle, and modern jsdom all expose it. If it's
 * unavailable (older jsdom in some test environments) we fall back to a
 * module-local counter so the keying behaviour stays correct — uniqueness
 * only has to hold within one `VSCodeDataProvider` instance, not across
 * processes.
 */

/**
 * Minimal shape of the VS Code webview API. The full type lives in
 * `@types/vscode-webview`, but pulling it in here would force every
 * webview consumer to compile against `vscode` types — instead we keep a
 * structural alias and feed `acquireVsCodeApi()` (typed as the same shape)
 * straight into `this.vscode`. The result is privately stored: components
 * never see the raw API (Loop 14 / static review).
 */
export interface VsCodeWebviewApi {
    postMessage(msg: unknown): void;
}

let nextRequestIdCounter = 0;

/**
 * Generate a fresh request ID. Prefers `crypto.randomUUID()`, falling back
 * to a module-local counter when it is unavailable.
 */
export function generateRequestId(): string {
    const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoRef?.randomUUID) {
        return cryptoRef.randomUUID();
    }
    return `req-${++nextRequestIdCounter}`;
}
