/**
 * Browser logger for the webview bundle.
 *
 * This is the SOLE sanctioned `console.*` site under `src/webview/ui/**`.
 * Every other module in the browser bundle must route through this logger
 * (see `tests/arch/console-discipline.test.ts` — the architecture test
 * allow-lists this exact path and bans `console.log` / `console.debug` /
 * `console.info` everywhere else under `src/webview/ui/`).
 *
 * Gating contract — asymmetric levels:
 *   - `error` and `warn`  → ALWAYS emit, regardless of `enabled`.
 *     Real failures must be visible to engineers debugging issues even
 *     when the debug flag was not pre-set.
 *   - `log` and `debug`   → no-op when `enabled === false`. Routine
 *     diagnostic chatter is silent by default and only surfaces when a
 *     human opts in.
 *
 * The single switch that drives `enabled` is `window.LLMEM_DEBUG`
 * (declared on the global `Window` interface in `src/webview/ui/types.ts`).
 * Consumers construct one logger in `main.ts` via
 *   `createWebviewLogger({ enabled: Boolean(window.LLMEM_DEBUG) })`
 * and thread it down through component / service constructors. The flag
 * is read once at construction time — flipping `window.LLMEM_DEBUG` after
 * the webview has loaded does not retroactively re-gate live loggers.
 */

export interface WebviewLogger {
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
}

export function createWebviewLogger(opts: { enabled: boolean }): WebviewLogger {
    const enabled = opts.enabled;
    return {
        error(...args: unknown[]): void {
            // eslint-disable-next-line no-console
            console.error(...args);
        },
        warn(...args: unknown[]): void {
            // eslint-disable-next-line no-console
            console.warn(...args);
        },
        log(...args: unknown[]): void {
            if (!enabled) {
                return;
            }
            // eslint-disable-next-line no-console
            console.log(...args);
        },
        debug(...args: unknown[]): void {
            if (!enabled) {
                return;
            }
            // eslint-disable-next-line no-console
            console.debug(...args);
        },
    };
}
