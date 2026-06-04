/**
 * Adapter registry for `llmem install`.
 *
 * The single array the install command reads to know which clients exist. It
 * starts EMPTY: per-client adapters are appended by their own loops so this
 * file never needs restructuring as clients land.
 *
 *   - claude-code  → appended by LI-04
 *   - codex        → appended by LI-05
 *   - claude-desktop → appended by LI-07
 *
 * Until an adapter is appended, the command degrades gracefully: with no
 * adapters registered, auto-detect finds nothing and the command prints the
 * manual setup snippets (exit 0).
 */

import type { ClientAdapter } from './types';
import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { claudeDesktopAdapter } from './claude-desktop';

/**
 * Ordered list of supported client adapters. The install command iterates
 * this array for auto-detection and apply. Adapters are appended by their
 * loops (LI-04 claude-code, LI-05 codex, LI-07 claude-desktop).
 */
export const ADAPTERS: ClientAdapter[] = [
    claudeCodeAdapter,
    codexAdapter,
    claudeDesktopAdapter,
];
