/**
 * `llmem health` — run the codebase health scan and persist the report.
 *
 * Thin CLI adapter over the pure `runHealthScan` + `renderHealthReport`
 * capability (`src/application/analysis`). It:
 *   1. detects the workspace + guards that edge lists exist,
 *   2. builds a `WorkspaceContext` and runs the scan,
 *   3. writes `<workspace>/.llmem/health-report.{md,json}` to the WORKSPACE
 *      ROOT (NOT `ctx.artifactRoot`, which is `.llmem/graph`) — mirroring the
 *      plain-`fs` write pattern in `init.ts`,
 *   4. prints the markdown (or the JSON `HealthReport` under `--json`),
 *   5. exits non-zero under `--fail-on <kind>` iff a finding of that kind
 *      exists (the report files are already written, so the exit is silent).
 *
 * Report-file location, `--out` resolution, and the `--fail-on` predicate are
 * the only host concerns here; all analysis logic lives in the capability
 * layer. `--severity` / `--refresh` are parsed (so they appear in `describe`)
 * but forwarded as a no-op this loop — `HealthScanOptions` is still empty.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

import { hasEdgeLists } from '../../viewer-generator';
import { detectWorkspace } from '../../workspace';
import { runHealthScan, renderHealthReport } from '../../application/analysis';
import type { HealthReport } from '../../application/analysis';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';

const healthArgs = z.object({
    workspace: z.string().optional()
        .describe('Workspace root directory (auto-detected if omitted)'),
    json: z.boolean().default(false)
        .describe('Emit the JSON HealthReport to stdout instead of the markdown'),
    out: z.string().optional()
        .describe('Override the report output directory or .md path (default: <workspace>/.llmem)'),
    severity: z.enum(['high', 'medium', 'low']).optional()
        .describe('Minimum severity floor (reserved; forwarded to runHealthScan)'),
    failOn: z.string().optional()
        .describe('Exit non-zero if the report has >=1 finding of this kind (e.g. import-cycle)'),
    refresh: z.boolean().default(true)
        .describe('Refresh edge lists before scanning (use --no-refresh to skip)'),
});

/**
 * Resolve the markdown + JSON report paths, honoring `--out`.
 *
 * Default: `<workspace>/.llmem/health-report.{md,json}`. With `--out`:
 *   - if it ends in `.md`, it IS the markdown path and the JSON sibling is the
 *     same path with a `.json` extension;
 *   - otherwise it is a directory and both default filenames are joined under
 *     it.
 * A relative `--out` resolves against `workspace`.
 */
function resolveOutPaths(
    workspace: string,
    out: string | undefined,
): { mdPath: string; jsonPath: string } {
    if (out === undefined) {
        return {
            mdPath: path.join(workspace, '.llmem', 'health-report.md'),
            jsonPath: path.join(workspace, '.llmem', 'health-report.json'),
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
        mdPath: path.join(resolved, 'health-report.md'),
        jsonPath: path.join(resolved, 'health-report.json'),
    };
}

/**
 * True iff the report carries >=1 finding of `kind`. This loop only
 * `import-cycle` is populated; the other branches read the (stubbed) arrays so
 * they activate automatically once later loops fill them. An unrecognized kind
 * returns `false` (never fails the build on a typo this loop).
 */
function reportHasKind(report: HealthReport, kind: string): boolean {
    switch (kind) {
        case 'import-cycle': return report.importCycles.length > 0;
        case 'call-cycle':   return report.callCycles.length > 0;   // [] this loop
        case 'clone':        return report.clones.length > 0;       // [] this loop
        case 'hub':          return report.hubs.length > 0;         // [] this loop
        case 'recursion':    return report.callCycles.some(c => c.type === 'recursion');
        default: return false; // unknown kind -> never fails the build
    }
}

export const healthCommand: CommandSpec<typeof healthArgs> = {
    name: 'health',
    description: 'Run the codebase health scan and write .llmem/health-report.{md,json}',
    examples: [
        {
            scenario: 'Scan the auto-detected workspace and print the report',
            command: 'llmem health',
        },
        {
            scenario: 'Fail the build if any import cycle exists',
            command: 'llmem health --fail-on import-cycle',
        },
        {
            scenario: 'Emit the machine-readable report to stdout',
            command: 'llmem health --json',
        },
    ],
    args: healthArgs,
    async run(args, cli) {
        const workspace = detectWorkspace(args.workspace);

        if (!hasEdgeLists(workspace)) {
            throw new CliError('Error: No edge lists found. Please scan workspace first.', 1);
        }

        const ctx = await cli.createWorkspace(workspace);

        // TODO(Loop 09): forward refresh/severity once HealthScanOptions accepts
        // them. `HealthScanOptions` is empty this loop, so pass undefined to
        // avoid a TS excess-property error. The parsed flags exist for
        // `describe`; reference them so lint does not flag them unused.
        void args.refresh;
        void args.severity;
        const report = await runHealthScan(ctx);

        const md = renderHealthReport(report);
        const { mdPath, jsonPath } = resolveOutPaths(workspace, args.out);

        await fs.mkdir(path.dirname(mdPath), { recursive: true });
        await fs.writeFile(mdPath, md, 'utf8');
        await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

        // M1: `--json` switches stdout to the JSON report but STILL writes both
        // files (the durable artifact CI diffs).
        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(md);
        }

        if (args.failOn !== undefined && reportHasKind(report, args.failOn)) {
            // Silent non-zero exit: md/json already emitted. main.ts owns exit.
            throw new CliError('', 1);
        }
    },
};
