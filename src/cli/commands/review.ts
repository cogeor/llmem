/**
 * `llmem review [path]` — recall the architecture-review checklist for a unit.
 *
 * Thin CLI adapter over the pure WS-2 recall (`runReviewRecall`) + WS-3 render
 * (`renderReviewChecklist`) capability (`src/application/review`). It mirrors
 * `src/cli/commands/health.ts` exactly:
 *   1. detects the workspace + guards that edge lists exist (SAME CliError),
 *   2. builds a `WorkspaceContext`, runs the recall pass for `path` (empty =
 *      repo root, folder scope, whole tree),
 *   3. writes `<workspace>/.llmem/review/<sanitized path>.{md,json}` to the
 *      WORKSPACE ROOT (NOT `ctx.artifactRoot`) — same plain-`fs` write + `--out`
 *      resolution as health's dual write,
 *   4. prints the markdown (or the JSON `ReviewChecklist` under `--json`).
 *
 * No analysis logic lives here — pure host delegation. Determinism is owned by
 * the capability layer (`renderReviewChecklist` carries no timestamp).
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

import { hasEdgeLists } from '../../viewer-generator';
import { detectWorkspace } from '../../workspace';
import {
    runReviewRecall,
    renderReviewChecklist,
    reviewArtifactRelPath,
} from '../../application/review';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

const reviewArgs = z.object({
    workspace: z.string().optional()
        .describe('Workspace root directory (auto-detected if omitted)'),
    path: z.string().optional()
        .describe('File id or folder prefix to review (default: whole repo)'),
    ruleset: z.enum(['general', 'frontend', 'both']).default('both')
        .describe('Which checklist ruleset to recall (default: both)'),
    out: z.string().optional()
        .describe('Override the checklist output directory or .md path (default: <workspace>/.llmem/review)'),
    json: z.boolean().default(false)
        .describe('Emit the JSON ReviewChecklist to stdout instead of the markdown'),
    // Captures the positional arguments that main.ts collects into `flagMap._`.
    // Surfaces in `describe --json` as an internal flag so the loop 04 contract
    // test (which asserts every property has a `description`) keeps passing.
    _: z.array(z.string()).optional()
        .describe('(internal) Positional arguments routed by the dispatcher.'),
});

/**
 * Resolve the markdown + JSON checklist paths, honoring `--out`.
 *
 * Default: `<workspace>/.llmem/review/<reviewArtifactRelPath(path)>` for the md,
 * with the `.json` sibling sharing the base name. With `--out`:
 *   - if it ends in `.md`, it IS the markdown path and the JSON sibling is the
 *     same path with a `.json` extension;
 *   - otherwise it is a directory and the sanitized default filenames are joined
 *     under it.
 * A relative `--out` resolves against `workspace`. Mirrors health's
 * `resolveOutPaths` (PURE + exported for the unit test — no dist spawn).
 */
export function resolveReviewOutPaths(
    workspace: string,
    reviewPath: string,
    out: string | undefined,
): { mdPath: string; jsonPath: string } {
    // reviewArtifactRelPath already suffixes `.md` and maps '' → 'repo.md'.
    const mdName = reviewArtifactRelPath(reviewPath);
    const jsonName = mdName.slice(0, -'.md'.length) + '.json';

    if (out === undefined) {
        return {
            mdPath: path.join(workspace, '.llmem', 'review', mdName),
            jsonPath: path.join(workspace, '.llmem', 'review', jsonName),
        };
    }
    const resolved = path.isAbsolute(out) ? out : path.join(workspace, out);
    if (resolved.toLowerCase().endsWith('.md')) {
        return {
            mdPath: resolved,
            jsonPath: resolved.slice(0, -'.md'.length) + '.json',
        };
    }
    return {
        mdPath: path.join(resolved, mdName),
        jsonPath: path.join(resolved, jsonName),
    };
}

export const reviewCommand: CommandSpec<typeof reviewArgs> = {
    name: 'review',
    description: 'Recall the architecture-review checklist and write .llmem/review/<path>.{md,json}',
    examples: [
        {
            scenario: 'Review the whole repo (both rulesets) and print the checklist',
            command: 'llmem review',
        },
        {
            scenario: 'Review one subtree with the frontend ruleset',
            command: 'llmem review --path src/webview --ruleset frontend',
        },
        {
            scenario: 'Emit the machine-readable checklist to stdout',
            command: 'llmem review --json',
        },
    ],
    args: reviewArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        if (!hasEdgeLists(workspace)) {
            throw new CliError('Error: No edge lists found. Please scan workspace first.', 1);
        }

        const ctx = await cli.createWorkspace(workspace);

        // Empty path = whole-repo review (folder scope, every in-subtree
        // finding). `normalizeReviewPath('') === ''` and
        // `isUnderPath(x, '', 'folder') === true` already make '' match-all in
        // the capability layer, so the CLI needs no special case.
        const reviewPath = args.path ?? (args._ && args._[0]) ?? '';
        const checklist = await runReviewRecall(ctx, reviewPath, args.ruleset);

        const md = renderReviewChecklist(checklist);
        const { mdPath, jsonPath } = resolveReviewOutPaths(workspace, reviewPath, args.out);

        await fs.mkdir(path.dirname(mdPath), { recursive: true });
        await fs.writeFile(mdPath, md, 'utf8');
        await fs.writeFile(jsonPath, JSON.stringify(checklist, null, 2), 'utf8');

        // `--json` switches stdout to the JSON checklist but STILL writes both
        // files (the durable artifact). The emitted checklist carries no
        // timestamp; byte-stable across runs on identical input.
        if (args.json) {
            console.log(JSON.stringify(checklist, null, 2));
        } else {
            console.log(md);
        }
    },
};
