/**
 * Idempotent, append-only `.gitignore` maintenance for the LLMem dot-folder.
 *
 * Background
 * ----------
 * The first scan / doc-gen silently creates the `.llmem/` dot-folder in the
 * user's repo. Without a `.gitignore` entry it can get committed. This helper
 * is called once, at the seam where the artifact / docs root is first created
 * (see `src/application/viewer-data.ts`), to ensure a single blanket
 * `.llmem/` ignore line exists.
 *
 * DECISION 2026-06-02: gitignore `.llmem/` ENTIRELY — one blanket line, docs
 * included. No cache-vs-docs split, no per-subdir constants.
 *
 * Behaviour
 * ---------
 *  - Only acts when the workspace is a git repo (a `.git` file OR dir exists).
 *    Non-git workspaces get a one-time stderr/log notice and NO file is written.
 *  - Idempotent: parses existing `.gitignore` lines; `.llmem` and `.llmem/`
 *    are treated as equivalent (trailing slash trimmed when comparing). If the
 *    entry is already present, does nothing.
 *  - Append-only: NEVER rewrites or reorders the user's file. When the entry is
 *    missing it appends a commented block (blank line, `# LLMem (generated)`,
 *    then `.llmem/`) at the END. If `.gitignore` does not exist yet (but `.git`
 *    does), it is created with that block.
 *
 * I/O goes through the realpath-strong `WorkspaceIO` surface (io.exists /
 * io.readFile / io.writeFile), NOT raw `fs`.
 */

import type { WorkspaceRoot } from '../core/paths';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';
import type { WorkspaceIO } from '../workspace/workspace-io';

/** Default entry to ensure: a single blanket ignore of the `.llmem/` tree. */
export const DEFAULT_GITIGNORE_ENTRY = '.llmem/';

const HEADER_COMMENT = '# LLMem (generated)';

/** Structured outcome of an `ensureGitignored` call (for tests + logging). */
export interface EnsureGitignoredResult {
    readonly action:
        | 'created' // .gitignore did not exist; created with the block
        | 'appended' // entry was missing; block appended at the end
        | 'present' // entry already present; no-op
        | 'not-git'; // no .git; nothing written
}

/** Normalize an ignore entry for equivalence comparison (trim trailing slash). */
function normalizeEntry(line: string): string {
    return line.trim().replace(/\/+$/, '');
}

/**
 * Returns true if the parsed `.gitignore` content already contains an entry
 * equivalent to `entry` (trailing slash is ignored when comparing). Comment
 * and blank lines are skipped.
 */
function hasEntry(content: string, entry: string): boolean {
    const target = normalizeEntry(entry);
    for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#')) continue;
        if (normalizeEntry(line) === target) return true;
    }
    return false;
}

/**
 * Ensure `entry` (default `.llmem/`) is present in the workspace `.gitignore`,
 * append-only and idempotent. See the module banner for the full contract.
 *
 * @param workspaceRoot The workspace root (used only for the not-git notice).
 * @param io            Realpath-strong WorkspaceIO for `.git` / `.gitignore`.
 * @param entry         Entry to ensure; defaults to the blanket `.llmem/`.
 * @param logger        Optional logger for the one-time not-git notice.
 */
export async function ensureGitignored(
    workspaceRoot: WorkspaceRoot,
    io: WorkspaceIO,
    entry: string = DEFAULT_GITIGNORE_ENTRY,
    logger: Logger = NoopLogger,
): Promise<EnsureGitignoredResult> {
    // Only maintain .gitignore inside an actual git repo. `.git` is a dir for
    // a normal clone and a file for worktrees / submodules — both count, and
    // io.exists() returns true for either.
    if (!(await io.exists('.git'))) {
        logger.info(
            `[ensureGitignored] ${workspaceRoot} is not a git repo (no .git); ` +
                'skipping .gitignore maintenance.',
        );
        return { action: 'not-git' };
    }

    const gitignoreExists = await io.exists('.gitignore');
    const block = `\n${HEADER_COMMENT}\n${entry}\n`;

    if (!gitignoreExists) {
        // Create fresh with just the block (sans the leading blank line —
        // there's no preceding user content to separate from).
        await io.writeFile('.gitignore', `${HEADER_COMMENT}\n${entry}\n`);
        return { action: 'created' };
    }

    const existing = await io.readFile('.gitignore');
    if (hasEntry(existing, entry)) {
        return { action: 'present' };
    }

    // Append-only: preserve the user's file verbatim, add the block at the end.
    // Ensure exactly one blank line separates prior content from our block.
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
    const appended = (needsLeadingNewline ? `${existing}\n` : existing) + block;
    await io.writeFile('.gitignore', appended);
    return { action: 'appended' };
}
