/**
 * Review-artifact persistence + filled-checklist renderer (WS-5).
 *
 * After `report_review` confirms completeness, the reported verdicts are
 * rendered to a deterministic, FILLED markdown checklist and written under
 * `<workspace>/.llmem/review/`. This mirrors the plain-`fs` write pattern in
 * `src/cli/commands/health.ts` (write to the WORKSPACE ROOT's `.llmem`, NOT
 * `ctx.artifactRoot` which is `.llmem/graph`).
 *
 * Determinism: the renderer carries no timestamp and uses no `Date` /
 * `Math.random`. Same `(path, ruleset, submitted)` in → byte-identical markdown
 * out (registry-ordered items, last-write-wins per id).
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { REVIEW_REGISTRY } from './registry';
import type { SubmittedItem } from './validate';

/** Directory (under the workspace root) review artifacts are written to. */
const REVIEW_DIR = path.join('.llmem', 'review');

/**
 * Sanitize a reviewed `path` to a single safe file name under
 * `.llmem/review/`. Replaces `/` and `\` with `__`, maps an empty / root path
 * to `repo`, and suffixes `.md`. Deterministic and IO-free.
 *
 * @example
 *   reviewArtifactRelPath('src/webview') === 'src__webview.md'
 *   reviewArtifactRelPath('')             === 'repo.md'
 */
export function reviewArtifactRelPath(reviewedPath: string): string {
    const trimmed = reviewedPath.trim();
    const base =
        trimmed === '' || trimmed === '/' || trimmed === '\\'
            ? 'repo'
            : trimmed.replace(/[/\\]/g, '__');
    return `${base}.md`;
}

/**
 * Render the FILLED checklist as deterministic, timestamp-free markdown. For
 * every required registry item (filtered by ruleset, in registry order) emit
 * `- [x] <id> — <title> — <status>` plus an indented `note:` line when the
 * submitted item carries one. Unresolved items cannot reach here — the
 * completeness validator rejects first — so the default status for an
 * (impossibly) missing id is rendered as `not-yet-checked` for safety.
 */
export function renderFilledReview(
    reviewedPath: string,
    ruleset: 'general' | 'frontend' | 'both',
    submitted: readonly SubmittedItem[],
): string {
    const byId = new Map<string, SubmittedItem>();
    for (const item of submitted) {
        byId.set(item.id, item);
    }

    const lines: string[] = [];
    lines.push(`# LLMem Architecture Review — ${reviewedPath}`);
    lines.push(`ruleset: ${ruleset}`);

    let lastCategory: string | null = null;
    for (const item of REVIEW_REGISTRY) {
        if (ruleset !== 'both' && item.ruleset !== ruleset) {
            continue;
        }

        if (item.category !== lastCategory) {
            lines.push('');
            lines.push(`## ${item.category}`);
            lastCategory = item.category;
        }

        const reported = byId.get(item.id);
        const status = reported?.status ?? 'not-yet-checked';
        lines.push(`- [x] ${item.id} — ${item.title} — ${status}`);
        if (reported?.note) {
            lines.push(`      note: ${reported.note}`);
        }
    }

    return lines.join('\n');
}

/**
 * Write `markdown` to `<workspace>/.llmem/review/<sanitized path>.md`,
 * creating the directory if needed. Returns the absolute artifact path.
 */
export async function persistReviewMarkdown(
    workspace: string,
    reviewedPath: string,
    markdown: string,
): Promise<string> {
    const dir = path.join(workspace, REVIEW_DIR);
    await fs.mkdir(dir, { recursive: true });
    const absPath = path.join(dir, reviewArtifactRelPath(reviewedPath));
    await fs.writeFile(absPath, markdown, 'utf8');
    return absPath;
}
