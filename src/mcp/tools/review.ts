/**
 * MCP tool: review (phase 1 of the architecture-review pair).
 *
 * Builds the served review prompt for one `path`: the embedded methodology
 * prompt(s) for the requested `ruleset`, a separator, then the recalled
 * checklist (every registry item, graph candidates attached, all boxes
 * `not-yet-checked`). Mirrors `file_info` exactly — validate request +
 * workspace, reuse the server-shared `WorkspaceContext` via `getStoredContext`,
 * and return a `prompt_ready` response chaining to `report_review`.
 *
 * The host LLM is instructed to resolve EVERY box and call `report_review`;
 * `report_review` then re-validates completeness server-side and refuses to
 * persist a checklist with any box left `not-yet-checked` (the hard guarantee).
 */

import { z } from 'zod';
import {
    McpResponse,
    validateRequest,
    formatError,
    formatPromptResponse,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import {
    validateWorkspaceRoot,
    validateWorkspacePath,
} from '../path-utils';
import { getStoredContext } from '../server';
import { assertWorkspaceRootMatch } from './shared';
import { runReviewRecall } from '../../application/review/recall';
import { renderReviewChecklist } from '../../application/review/render';
import { selectPrompts } from '../../application/review/prompts';

export const ReviewSchema = z.object({
    workspaceRoot: z
        .string()
        .describe('Absolute path to workspace root (current project directory)'),
    path: z
        .string()
        .describe('Path to file/folder to review (relative to workspace root; "" = whole repo)'),
    ruleset: z
        .enum(['general', 'frontend', 'both'])
        .default('both')
        .describe(
            "Which checklist ruleset(s) to serve. 'general' (language-agnostic " +
            "architecture), 'frontend' (UI/webview), or 'both' (default).",
        ),
});

export type ReviewInput = z.infer<typeof ReviewSchema>;

/** The closing instruction appended after the rendered checklist. */
const CLOSING_INSTRUCTION =
    'Resolve EVERY box to issue-validated | non-issue; then call report_review ' +
    'with { workspaceRoot, path, ruleset, checklist:[{id,status,note?}] } for ALL ' +
    'items. A box left not-yet-checked will be REJECTED.';

async function handleReviewImpl(
    args: unknown,
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReviewSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath } = validation.data!;
    // Zod's `.default('both')` guarantees a value at runtime; the `?? 'both'`
    // only narrows the inferred input-side `| undefined` for the type checker.
    const ruleset = validation.data!.ruleset ?? 'both';

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const ctx = await getStoredContext();
    const checklist = await runReviewRecall(ctx, relativePath, ruleset);

    const prompt = [
        selectPrompts(ruleset),
        renderReviewChecklist(checklist),
        CLOSING_INSTRUCTION,
    ].join('\n\n---\n\n');

    return formatPromptResponse(prompt, 'report_review', {
        workspaceRoot,
        path: relativePath,
        ruleset,
    });
}

export const handleReview = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'review',
        },
        handleReviewImpl,
    )(args);

export const reviewTool = {
    name: 'review',
    description:
        'Run the LLMem architecture-review checklist over a file/folder. Returns the ' +
        'embedded review methodology plus a recalled, graph-backed checklist and a prompt ' +
        'for LLM enrichment. You MUST process the returned prompt through the LLM, resolving ' +
        'EVERY box, then call report_review with the per-item verdicts to record the review.',
    schema: ReviewSchema,
    handler: handleReview,
};
