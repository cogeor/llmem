/**
 * Browser-open helper for the Claude web launcher (Loop 15 split).
 *
 * Carved verbatim from the former `web-launcher.ts` monolith. NOTE: this is
 * a distinct helper from `src/http-server/open-browser.ts` (`openBrowser`)
 * — that variant prints a "Please open ... manually" stdout fallback on
 * failure, whereas this launcher variant only logs a warning. To preserve
 * ZERO behavior change for the launcher's public `openInBrowser` export, the
 * two are kept separate.
 *
 * Re-exported through the `web-launcher.ts` barrel so existing import sites
 * keep working unchanged.
 */

import { createLogger } from '../common/logger';

const log = createLogger('web-launcher');

/**
 * Open graph in default browser (platform-specific)
 *
 * Note: This requires child_process and may not work in all environments.
 * Recommend returning URL to Claude and letting user open it.
 *
 * @param url - file:// URL to open
 */
export function openInBrowser(url: string): void {
    const { execFile } = require('child_process');
    let cmd: string;
    let args: string[];
    if (process.platform === 'win32') {
        cmd = 'cmd';
        args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = [url];
    } else {
        cmd = 'xdg-open';
        args = [url];
    }
    execFile(cmd, args, (error: any) => {
        if (error) {
            log.warn('Failed to open browser', { error: error.message });
        }
    });
}
