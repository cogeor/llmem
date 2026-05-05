
import { DataProvider } from './dataProvider';
import { StaticDataProvider } from './staticDataProvider';
import { VSCodeDataProvider } from './vscodeDataProvider';
import { WebviewLogger } from './webview-logger';

declare const acquireVsCodeApi: (() => any) | undefined;

/**
 * Factory to create the appropriate DataProvider based on the environment.
 *
 * - In VS Code webview: returns VSCodeDataProvider (receives data via postMessage)
 * - In standalone HTML: returns StaticDataProvider (reads from window.* globals)
 *
 * Loop 14: `logger` is optional. main.ts passes one in; tests / other
 * call sites that don't supply one fall back to each provider's silent
 * default (errors/warnings still surface; log/debug are gated).
 */
export function createDataProvider(logger?: WebviewLogger): DataProvider {
    // Check if we're in VS Code webview context
    if (typeof acquireVsCodeApi !== 'undefined') {
        return new VSCodeDataProvider(logger);
    }

    // Fallback to static provider (standalone mode)
    return new StaticDataProvider(logger);
}
