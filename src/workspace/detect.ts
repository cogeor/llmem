/**
 * Neutral workspace-root detector.
 *
 * Single-responsibility module — the one home for `detectWorkspace`. Body
 * lifted verbatim from the previous in-command copies in
 * `commands/serve.ts:36-61` and `commands/scan.ts:31-56`. Marker list and
 * walk-up semantics are unchanged: `['.git', 'package.json', '.llmem',
 * '.arch', '.artifacts']` checked from `process.cwd()` upward.
 *
 * Lives under the neutral `src/workspace/` namespace (not a host-specific
 * one) so
 * host-agnostic consumers — CLI commands AND the install adapters under
 * `src/install/` — can resolve a workspace root without coupling to the
 * Claude namespace. `detectWorkspace` is a pure helper with no dependency on
 * any `CliContext` shape: workspace detection is a pre-context concern
 * (callers need a root before constructing IO).
 *
 * Error contract: when an explicit path is supplied that does not exist, this
 * function THROWS `WorkspaceNotFoundError` (from `src/core/errors`) rather than
 * calling `process.exit`. It is a lower layer than the CLI, so it must not own
 * process termination: the CLI's `main()` catches the error and exits 1, and
 * the install adapters let it propagate to their host. This keeps the detector
 * composable / in-process testable (A-grade #2).
 */

import * as path from 'path';
import * as fs from 'fs';
import { WorkspaceNotFoundError } from '../core/errors';

/**
 * Detect workspace root.
 *
 * - When `explicit` is supplied: resolves the path. If it does not exist,
 *   throws `WorkspaceNotFoundError` (the caller owns process termination).
 * - Otherwise: walks up from `process.cwd()` looking for one of the
 *   marker files/dirs (`.git`, `package.json`, `.llmem`, `.arch`,
 *   `.artifacts`). Returns the first match.
 * - Fallback: `process.cwd()`.
 */
export function detectWorkspace(explicit?: string): string {
    if (explicit) {
        if (!fs.existsSync(explicit)) {
            throw new WorkspaceNotFoundError(explicit);
        }
        return path.resolve(explicit);
    }

    // Auto-detect
    const markers = ['.git', 'package.json', '.llmem', '.arch', '.artifacts'];
    let current = process.cwd();
    const root = path.parse(current).root;

    while (current !== root) {
        for (const marker of markers) {
            if (fs.existsSync(path.join(current, marker))) {
                return current;
            }
        }
        current = path.dirname(current);
    }

    // Fallback to cwd
    return process.cwd();
}
