
import { DataProvider } from './dataProvider';
import { StaticDataProvider } from './staticDataProvider';
import { VSCodeDataProvider } from './vscodeDataProvider';

declare const acquireVsCodeApi: (() => any) | undefined;

/**
 * Factory to create the appropriate DataProvider based on the environment.
 * 
 * - In VS Code webview: returns VSCodeDataProvider (receives data via postMessage)
 * - In standalone HTML: returns StaticDataProvider (reads from window.* globals)
 */
export function createDataProvider(): DataProvider {
    // Check if we're in VS Code webview context
    if (typeof acquireVsCodeApi !== 'undefined') {
        return new VSCodeDataProvider();
    }

    // Fallback to static provider (standalone mode)
    return new StaticDataProvider();
}
