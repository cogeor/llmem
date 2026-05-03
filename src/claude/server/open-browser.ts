/**
 * Cross-platform "open this URL in the user's browser" helper.
 *
 * Loop 11 lifted this out of `GraphServer` to keep `index.ts` focused on
 * lifecycle. Pure side-effect; no return value.
 */

import { execFile } from 'child_process';

export function openBrowser(url: string): void {
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
    execFile(cmd, args, (error) => {
        if (error) {
            console.error(`Failed to open browser: ${error.message}`);
            console.log(`Please open ${url} manually.`);
        }
    });
}
