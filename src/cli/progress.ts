/**
 * Scan-progress rendering for the CLI (B3, 2026-07-13).
 *
 * The application layer exposes an `onFile` callback seam
 * (`ScanFolderRequest.onFile`) and stays console-free; THIS module owns the
 * printing (CLI layer — console allowed by tests/arch/console-discipline).
 *
 * TTY: one overwriting status line (`\r  indexed N files — <rel>`), cleared
 * by `finish()` so the summary line lands on a clean row. Non-TTY (CI,
 * piped): a dot every 25 files, closed by a newline — no control characters
 * in logs.
 */

const TTY_LINE_WIDTH = 78;
const DOT_EVERY = 25;

export interface ScanProgress {
    /** Pass as `ScanFolderRequest.onFile`. */
    onFile: (relPath: string) => void;
    /** Clear the status line / close the dot row. Safe to call when idle. */
    finish: () => void;
}

export function createScanProgress(
    stream: NodeJS.WriteStream = process.stdout,
): ScanProgress {
    const isTTY = stream.isTTY === true;
    let count = 0;
    let wroteDots = false;

    return {
        onFile(relPath: string): void {
            count++;
            if (isTTY) {
                const line = `  indexed ${count} files — ${relPath}`;
                stream.write('\r' + line.slice(0, TTY_LINE_WIDTH).padEnd(TTY_LINE_WIDTH));
            } else if (count % DOT_EVERY === 0) {
                stream.write('.');
                wroteDots = true;
            }
        },
        finish(): void {
            if (isTTY && count > 0) {
                stream.write('\r' + ' '.repeat(TTY_LINE_WIDTH) + '\r');
            } else if (wroteDots) {
                stream.write('\n');
            }
        },
    };
}
