/**
 * MCP tool: report_review (phase 2 of the architecture-review pair).
 *
 * Receives the host LLM's per-item verdicts for a reviewed `path` and persists
 * the FILLED checklist — but ONLY if every required box (per `ruleset`) is
 * resolved. The completeness gate (`validateCompleteness`) is the hard
 * guarantee this tool exists to enforce: a checklist with any box left
 * `not-yet-checked` (or missing) is REJECTED with a `formatError` naming the
 * unresolved ids, and NOTHING is written to disk.
 *
 * On success the filled checklist is rendered deterministically and written to
 * `<workspace>/.llmem/review/<sanitized path>.md` (mirroring `report_file_info`).
 */

import { z } from 'zod';
import {
    McpResponse,
    validateRequest,
    formatSuccess,
    formatError,
    generateCorrelationId,
} from '../handlers';
import { getDefaultObserver, withObservation } from '../observer';
import {
    validateWorkspaceRoot,
    validateWorkspacePath,
} from '../path-utils';
import { assertWorkspaceRootMatch } from './shared';
import { validateCompleteness } from '../../application/review/validate';
import type { SubmittedItem } from '../../application/review/validate';
import {
    renderFilledReview,
    persistReviewMarkdown,
} from '../../application/review/persist';

export const ReportReviewSchema = z.object({
    workspaceRoot: z.string().describe('Absolute path to workspace root'),
    path: z
        .string()
        .describe('Reviewed path (relative to workspace root; "" = whole repo)'),
    ruleset: z
        .enum(['general', 'frontend', 'both'])
        .default('both')
        .describe('Which checklist ruleset was reviewed (must match the review call)'),
    checklist: z
        .array(
            z.object({
                id: z.string().describe('Checklist item id (e.g. "D1", "FB1")'),
                status: z
                    .enum(['issue-validated', 'non-issue', 'not-yet-checked'])
                    .describe('Per-item verdict after reading the code'),
                note: z
                    .string()
                    .optional()
                    .describe('Optional justification / finding note'),
            }),
        )
        .describe('Per-item verdicts for ALL required items'),
});

export type ReportReviewInput = z.infer<typeof ReportReviewSchema>;

async function handleReportReviewImpl(
    args: unknown,
): Promise<McpResponse<unknown>> {
    const validation = validateRequest(ReportReviewSchema, args);
    if (!validation.success) {
        return formatError(validation.error!);
    }

    const { workspaceRoot, path: relativePath, checklist } = validation.data!;
    // Zod's `.default('both')` guarantees a value at runtime; the `?? 'both'`
    // only narrows the inferred input-side `| undefined` for the type checker.
    const ruleset = validation.data!.ruleset ?? 'both';

    validateWorkspaceRoot(workspaceRoot);
    assertWorkspaceRootMatch(workspaceRoot);
    validateWorkspacePath(workspaceRoot, relativePath);

    const submitted: SubmittedItem[] = checklist;
    const completeness = validateCompleteness(submitted, ruleset);
    if (!completeness.complete) {
        // HARD GUARANTEE: nothing is persisted for an incomplete checklist.
        return formatError(
            `Review incomplete — ${completeness.unresolved.length} item(s) still ` +
            `not-yet-checked or missing: ${completeness.unresolved.join(', ')}. ` +
            'Resolve every box before reporting.',
        );
    }

    const markdown = renderFilledReview(relativePath, ruleset, submitted);
    const artifactPath = await persistReviewMarkdown(
        workspaceRoot,
        relativePath,
        markdown,
    );

    return formatSuccess({
        message: 'Review checklist recorded',
        artifactPath,
        resolved: submitted.length,
    });
}

export const handleReportReview = (args: unknown) =>
    withObservation(
        getDefaultObserver(),
        {
            requestId: generateCorrelationId(),
            method: 'tools/call',
            toolName: 'report_review',
        },
        handleReportReviewImpl,
    )(args);

export const reportReviewTool = {
    name: 'report_review',
    description:
        'Record an architecture-review checklist for a file/folder. Rejects (persisting ' +
        'nothing) if any required box is left not-yet-checked or missing; otherwise writes ' +
        'the filled checklist to .llmem/review/{path}.md in the workspace.',
    schema: ReportReviewSchema,
    handler: handleReportReview,
};
