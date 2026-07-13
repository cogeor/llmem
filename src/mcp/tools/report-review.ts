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
import { verifyReviewToken } from '../server';
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
    // C6: session token issued by the phase-1 `review` call (in its
    // callbackArgs). Required — a phase-2 report without a live phase-1
    // session is rejected.
    reviewToken: z
        .string()
        .describe('Session token from the review call (callbackArgs.reviewToken)'),
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
                    .describe(
                        'Justification / finding note. REQUIRED (non-empty, citing the ' +
                        'finding) when status is issue-validated.',
                    ),
            })
            // C6: "reviewed" must mean "cited" — an issue-validated verdict
            // with no note is an unusable finding.
            .refine(
                (item) =>
                    item.status !== 'issue-validated' ||
                    (typeof item.note === 'string' && item.note.trim().length > 0),
                {
                    message:
                        'issue-validated requires a non-empty note citing the finding',
                    path: ['note'],
                },
            ),
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

    // C6: the token is keyed by (path, ruleset), so a report against a
    // different ruleset than was recalled — or without any phase-1 call at
    // all — never verifies. Re-running `review` replaces the token, which
    // invalidates reports drafted against the earlier recall.
    if (!verifyReviewToken(relativePath, ruleset, validation.data!.reviewToken)) {
        return formatError(
            'Missing or stale review token for this path/ruleset. Call the review ' +
            'tool first (each call issues a fresh reviewToken in callbackArgs) and ' +
            'pass that token back unchanged.',
        );
    }

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
        'Record an architecture-review checklist for a file/folder. Requires the ' +
        'reviewToken issued by the review call. Rejects (persisting nothing) if any ' +
        'required box is left not-yet-checked or missing, or if an issue-validated item ' +
        'lacks a citing note; otherwise writes the filled checklist to ' +
        '.llmem/review/{path}.md in the workspace.',
    schema: ReportReviewSchema,
    handler: handleReportReview,
};
