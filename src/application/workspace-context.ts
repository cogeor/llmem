/**
 * Per-host shared workspace runtime object.
 *
 * Module purpose
 * --------------
 * Today, hosts (CLI, HTTP server, VS Code extension panel, MCP) construct
 * `workspaceRoot` / `artifactRoot` / `io` / `logger` independently and
 * thread them through application services as parallel arguments. This
 * module declares the aggregate `WorkspaceContext` that every host can
 * build once at startup and pass through, plus the `RuntimeConfig`
 * superset that the upcoming HTTP middleware needs.
 *
 * Why it lives in `src/application/`
 * ----------------------------------
 * Host-neutral: consumed by `src/cli`, `src/http-server`,
 * `src/extension`, and `src/mcp`. None of those host-specific modules
 * are dependencies of this file; this file only depends on `core/`,
 * `workspace/`, `docs/`, and the config defaults at the repo root.
 *
 * Constraint
 * ----------
 * This module is **Node-only** — `fs`, `path` are fair game. Do not
 * import from this module in any file under `src/webview/ui/`. The
 * browser-purity scan (`tests/arch/browser-purity.test.ts`) only walks
 * `src/webview/ui/**`, so it will not flag the `fs`/`path` imports
 * here, but the discipline is documented as the human rule.
 *
 * Loop reference
 * --------------
 * Loop 03 — pure additive. Defines types + factory + helpers; does NOT
 * migrate any caller. Loop 04 owns caller migration (CLI / server /
 * panel / MCP entrypoints).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    WorkspaceRoot,
    AbsPath,
    RelPath,
} from '../core/paths';
import {
    asWorkspaceRoot,
    asRelPath,
    toAbs,
    toRel,
    assertContained,
} from '../core/paths';
import { WorkspaceNotFoundError } from '../core/errors';
import type { Logger } from '../core/logger';
import { NoopLogger } from '../core/logger';
import { WorkspaceIO } from '../workspace/workspace-io';
import type { Config } from '../core/config-types';
import { DEFAULT_CONFIG } from '../config-defaults';
import { getDocsRoot, DOCS_DIR } from '../docs/doc-store';
import { migrateDocs } from './migrate-docs';

// ---------------------------------------------------------------------------
// RuntimeConfig
// ---------------------------------------------------------------------------

/**
 * Per-workspace runtime configuration. Superset of `Config` (the core
 * extension settings) plus the host-server knobs that loop 05's HTTP
 * middleware needs.
 *
 * `Config` (artifactRoot/maxFilesPerFolder/maxFileSizeKB/maxFileLines) is the
 * lowest-common-denominator shape; `RuntimeConfig` adds optional
 * fields used by the Claude HTTP server. Hosts that don't need the
 * optional fields just omit them.
 */
export interface RuntimeConfig extends Config {
    /** Optional API token gate for mutating HTTP routes (loop 05). */
    readonly apiToken?: string;
    /** Optional bound port for the graph HTTP server. */
    readonly port?: number;
}

/**
 * Build a `RuntimeConfig` with all-default values. Test helper + sane
 * starting point for hosts that build configs incrementally.
 */
export function defaultRuntimeConfig(): RuntimeConfig {
    return { ...DEFAULT_CONFIG };
}

// ---------------------------------------------------------------------------
// WorkspaceContext + factory
// ---------------------------------------------------------------------------

/**
 * Per-workspace runtime context shared across hosts. Created once per
 * workspace at host startup (CLI, server, panel, MCP) and threaded
 * through application services. Replaces the parallel `workspaceRoot`
 * / `artifactRoot` / `io` / `logger` arguments that scan / document /
 * viewer services accept today.
 */
export interface WorkspaceContext {
    readonly workspaceRoot: WorkspaceRoot;
    readonly artifactRoot: AbsPath;
    readonly artifactRootRel: RelPath;
    readonly docsRoot: AbsPath;
    readonly docsRootRel: RelPath;
    readonly io: WorkspaceIO;
    readonly config: RuntimeConfig;
    readonly logger: Logger;
}

/**
 * Input to `createWorkspaceContext`. Two shapes:
 *
 *   1. Loose input — `{ workspaceRoot: string; configOverrides? }`. The
 *      factory resolves and realpath-validates the root, computes
 *      artifact / arch paths from `config.artifactRoot`, and builds a
 *      fresh `WorkspaceIO`.
 *
 *   2. Resolved input — supply `{ workspaceRoot, config, io, logger? }`
 *      already-built (e.g. from a parent context that already paid the
 *      realpath cost). The factory still recomputes `artifactRoot` /
 *      `docsRoot` to keep them authoritative.
 *
 * Both shapes must end up with a realpath-validated root; the factory
 * rejects with `WorkspaceNotFoundError` if the root does not exist or
 * fails realpath.
 */
export type CreateWorkspaceContextInput =
    | {
          readonly workspaceRoot: string;
          readonly configOverrides?: Partial<RuntimeConfig>;
          readonly logger?: Logger;
      }
    | {
          readonly workspaceRoot: WorkspaceRoot;
          readonly config: RuntimeConfig;
          readonly io: WorkspaceIO;
          readonly logger?: Logger;
      };

/**
 * Build a `WorkspaceContext` from either a loose input
 * (`{ workspaceRoot: string; configOverrides? }`) or a fully-resolved
 * input (`{ workspaceRoot, config, io, logger? }`).
 *
 * Order of operations (loose arity):
 *   1. `path.resolve(input.workspaceRoot)`.
 *   2. `WorkspaceIO.create(...)` — realpath-validates the root; throws
 *      `WorkspaceNotFoundError` on ENOENT/ENOTDIR/EACCES.
 *   3. Rebrand `workspaceRoot` to the realpath form (matters on macOS
 *      where `/var` → `/private/var`) so `artifactRoot`/`docsRoot`
 *      resolve against the canonical root.
 *   4. Merge `configOverrides` over `defaultRuntimeConfig()`.
 *
 * Order of operations (resolved arity):
 *   1. Validate that `realpath(workspaceRoot)` matches `io.getRealRoot()`;
 *      throw `WorkspaceNotFoundError` on mismatch (catches a hand-rolled
 *      bag with mismatched fields).
 *
 * Then in both arities: derive `artifactRoot` from `config.artifactRoot`
 * (with containment assertion), derive `docsRoot` via `getDocsRoot()`
 * (single source of truth for the `.llmem/docs` prefix), and assemble.
 */
export async function createWorkspaceContext(
    input: CreateWorkspaceContextInput,
): Promise<WorkspaceContext> {
    const logger = input.logger ?? NoopLogger;

    let workspaceRoot: WorkspaceRoot;
    let config: RuntimeConfig;
    let io: WorkspaceIO;

    if ('config' in input) {
        // Resolved arity. The caller has already built `io`; we
        // re-validate that `io.getRealRoot()` matches the supplied
        // workspaceRoot's realpath. Mismatch → throw.
        workspaceRoot = input.workspaceRoot;
        config = input.config;
        io = input.io;
        let real: string;
        try {
            real = await fs.realpath(path.resolve(workspaceRoot));
        } catch {
            throw new WorkspaceNotFoundError(workspaceRoot);
        }
        if (real !== io.getRealRoot()) {
            throw new WorkspaceNotFoundError(workspaceRoot);
        }
    } else {
        // Loose arity. Resolve + realpath the supplied path. Failure
        // surfaces as `WorkspaceNotFoundError` (the same error
        // `WorkspaceIO.create` throws on non-existent root).
        const resolved = path.resolve(input.workspaceRoot);
        workspaceRoot = asWorkspaceRoot(resolved);
        io = await WorkspaceIO.create(workspaceRoot);
        // Rebrand workspaceRoot to the realpath form so artifactRoot /
        // docsRoot are computed against the canonical root.
        workspaceRoot = asWorkspaceRoot(io.getRealRoot());
        config = {
            ...defaultRuntimeConfig(),
            ...(input.configOverrides ?? {}),
        };
    }

    // artifactRoot / docsRoot derivations.
    const artifactRootAbs = toAbs(config.artifactRoot, workspaceRoot);
    assertContained(artifactRootAbs, workspaceRoot);
    // `toRel` yields OS-native separators; normalize to forward slashes so
    // the relpath matches `docsRootRel` (derived from the forward-slash
    // `DOCS_DIR` const) and stays stable across platforms for routes / DTOs.
    // Matters now that the default is multi-segment (`.llmem/graph`).
    const artifactRootRel = asRelPath(
        toRel(artifactRootAbs, workspaceRoot).replace(/\\/g, '/'),
    );

    // `getDocsRoot` / `DOCS_DIR` are the single source of truth for the
    // docs-tree prefix (`.llmem/docs`; see `src/docs/doc-store.ts`). It
    // returns AbsPath but does NOT call `assertContained`; we do it here
    // for parity (cheap textual check; cannot fail given `path.join` with
    // the literal `DOCS_DIR`, but explicit is better). `docsRootRel` is
    // derived from the same const so it never drifts from the abs form.
    const archRootAbs = getDocsRoot(workspaceRoot);
    assertContained(archRootAbs, workspaceRoot);
    const docsRootRel = asRelPath(DOCS_DIR);

    return {
        workspaceRoot,
        artifactRoot: artifactRootAbs,
        artifactRootRel,
        docsRoot: archRootAbs,
        docsRootRel,
        io,
        config,
        logger,
    };
}

/**
 * Host-startup factory: build a `WorkspaceContext` AND run the one-time docs
 * migration (`.arch` → `.llmem/docs`).
 *
 * This is the entry every *host* should use at startup (CLI command,
 * HTTP/graph server, MCP server, VS Code panel). It is `createWorkspaceContext`
 * plus an explicit, idempotent, conflict-safe migration side effect — kept
 * separate from the pure factory so that "construct a context" and "mutate the
 * workspace on disk" are never silently the same call (the regrade's issue #5).
 *
 * The migration runs on every init but warm inits short-circuit cheaply (a
 * single `exists()` check) and it never crashes startup — failures leave
 * `.arch` intact and warn. See `src/application/migrate-docs.ts`.
 *
 * Non-host, one-off context builders (the static webview generator fallback,
 * dev scripts, test fixtures) call the pure `createWorkspaceContext` directly:
 * they operate on a workspace a host has already initialized, so re-running the
 * migration there is unnecessary.
 */
export async function initWorkspaceContext(
    input: CreateWorkspaceContextInput,
): Promise<WorkspaceContext> {
    const ctx = await createWorkspaceContext(input);
    await migrateDocs(ctx.workspaceRoot, ctx.logger);
    return ctx;
}

// ---------------------------------------------------------------------------
// Helper accessors
// ---------------------------------------------------------------------------

/** Workspace-relative path of the artifact root (for routes / DTOs). */
export function getArtifactRootRel(ctx: WorkspaceContext): RelPath {
    return ctx.artifactRootRel;
}

/** Workspace-relative path of the docs root (`.llmem/docs`; for design-doc keys). */
export function getArchRootRel(ctx: WorkspaceContext): RelPath {
    return ctx.docsRootRel;
}

/**
 * Resolve a workspace-relative path under the artifact root, with
 * containment assertion. Replaces ad-hoc
 * `path.join(ctx.artifactRoot, sub)` call sites in loop 04.
 */
export function resolveArtifactPath(
    ctx: WorkspaceContext,
    rel: string,
): AbsPath {
    const abs = toAbs(rel, ctx.artifactRoot);
    assertContained(abs, ctx.artifactRoot);
    return abs;
}

/** Symmetric helper for docs-tree paths. */
export function resolveArchPath(
    ctx: WorkspaceContext,
    rel: string,
): AbsPath {
    const abs = toAbs(rel, ctx.docsRoot);
    assertContained(abs, ctx.docsRoot);
    return abs;
}

// ---------------------------------------------------------------------------
// Narrow slices (Task 3)
// ---------------------------------------------------------------------------

/**
 * Narrow path-only slice of `WorkspaceContext`. Services that compute
 * paths (e.g. artifact / arch resolution helpers) but do not perform
 * I/O or log can take this instead of the whole context. Loop 04
 * picks which migrated caller uses this slice.
 *
 * Using `Pick<>` keeps this slice automatically in sync with
 * `WorkspaceContext` — adding a new path field to the context flows
 * through.
 */
export type WorkspacePaths = Pick<
    WorkspaceContext,
    'workspaceRoot' | 'artifactRoot' | 'artifactRootRel' | 'docsRoot' | 'docsRootRel'
>;

/**
 * Narrow services-only slice of `WorkspaceContext`. Application
 * services that perform I/O and log progress (e.g. scan, document,
 * watch) can take this — `io` for realpath-strong reads / writes,
 * `logger` for progress, and `config` for knobs — without taking on
 * path-derivation responsibility.
 */
export type WorkspaceServices = Pick<
    WorkspaceContext,
    'io' | 'logger' | 'config'
>;
