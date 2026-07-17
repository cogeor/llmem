/**
 * `llmem health` — run the codebase health scan and persist the report.
 *
 * Thin CLI adapter over the pure `runHealthScan` + `renderHealthReport`
 * capability (`src/application/analysis`). It:
 *   1. detects the workspace + auto-scans if no edge lists exist (ensureGraph),
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

import { detectWorkspace } from '../../workspace';
import { runHealthScan, renderHealthReport, reportHasFindingKind } from '../../application/analysis';
import type { CommandSpec } from '../registry';
import { CliError } from '../errors';
import { ensureGraph } from './ensure-graph';

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
    artifactRoot: z.string().optional()
        .describe('Artifact store directory (absolute paths allowed, may be outside the workspace; overrides LLMEM_ARTIFACT_ROOT; default: .llmem/graph)'),
    store: z.enum(['repo', 'global']).optional()
        .describe('Artifact store location: repo (.llmem/graph in the workspace, default) or global (per-user store keyed by workspace path; overrides LLMEM_STORE; --artifact-root beats both)'),
}).strict();

/**
 * Resolve the markdown + JSON report paths, honoring `--out`.
 *
 * Default: `<defaultDir>/health-report.{md,json}`, where `defaultDir` is the
 * PARENT of the artifact root — i.e. the health report is always a sibling of
 * the graph dir. In-repo that is `<workspace>/.llmem` (unchanged); with an
 * out-of-tree store (`--store global` / an absolute `--artifact-root`) it
 * follows the store so a foreign repo is never written to. With `--out`:
 *   - if it ends in `.md`, it IS the markdown path and the JSON sibling is the
 *     same path with a `.json` extension;
 *   - otherwise it is a directory and both default filenames are joined under
 *     it.
 * A relative `--out` resolves against `workspace` (an explicit user choice).
 */
function resolveOutPaths(
    workspace: string,
    defaultDir: string,
    out: string | undefined,
): { mdPath: string; jsonPath: string } {
    if (out === undefined) {
        return {
            mdPath: path.join(defaultDir, 'health-report.md'),
            jsonPath: path.join(defaultDir, 'health-report.json'),
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

        const ctx = await cli.createWorkspace(
            workspace,
            { artifactRoot: args.artifactRoot },
            { store: args.store },
        );

        // A5: zero-config — auto-scan on first run instead of demanding a
        // prior `llmem scan`. Probes ctx.config.artifactRoot (bug 1.3: the
        // old guard probed the DEFAULT root, breaking LLMEM_ARTIFACT_ROOT).
        await ensureGraph(ctx, { requireGraph: true });

        // TODO(Loop 09): forward refresh/severity once HealthScanOptions accepts
        // them. `HealthScanOptions` is empty this loop, so pass undefined to
        // avoid a TS excess-property error. The parsed flags exist for
        // `describe`; reference them so lint does not flag them unused.
        void args.refresh;
        void args.severity;
        const report = await runHealthScan(ctx);

        const md = renderHealthReport(report);
        // Default the report next to the graph dir (parent of the artifact
        // root): `<workspace>/.llmem` in-repo, or the store dir out-of-tree so
        // a foreign repo stays clean. `--out` still overrides.
        const { mdPath, jsonPath } = resolveOutPaths(
            workspace,
            path.dirname(ctx.artifactRoot),
            args.out,
        );

        await fs.mkdir(path.dirname(mdPath), { recursive: true });
        await fs.writeFile(mdPath, md, 'utf8');
        await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

        // M1: `--json` switches stdout to the JSON report but STILL writes both
        // files (the durable artifact CI diffs). The emitted report carries no
        // timestamp; `.vector` is byte-stable across runs (measurement-loop
        // determinism).
        if (args.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            console.log(md);
        }

        // `--fail-on <kind>` keys on the pure analysis-layer predicate. The
        // full kind matrix (import-cycle|call-cycle|clone|hub|recursion) is
        // wired in `reportHasFindingKind`; `import-cycle` is keyed on the
        // RUNTIME cycle count, so a benign type-only cycle does NOT trip CI.
        if (args.failOn !== undefined && reportHasFindingKind(report, args.failOn)) {
            // Silent non-zero exit: md/json already emitted. main.ts owns exit.
            throw new CliError('', 1);
        }
    },
};
