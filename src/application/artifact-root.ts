/**
 * Artifact-root resolution for `createWorkspaceContext` (portable store).
 *
 * `config.artifactRoot` may be an ABSOLUTE path anywhere on disk (kept
 * as-is — the artifact store may live outside the workspace) or a path
 * relative to the workspace root (the classic in-tree `.llmem/graph`).
 * Either way this helper:
 *
 *   1. resolves the absolute form,
 *   2. `mkdir -p`s it (the documented side effect of context creation —
 *      the artifact-scoped `WorkspaceIO` below must realpath-anchor on an
 *      EXISTING directory),
 *   3. builds a second `WorkspaceIO` rooted AT the artifact root, so the
 *      containment invariant becomes "artifact I/O stays inside the
 *      artifact root" — uniform for in-tree and out-of-tree stores,
 *   4. computes the workspace-relative form (`null` when out-of-tree).
 *
 * Lives in `src/application/` because it is a `createWorkspaceContext`
 * internal (same layer, same dependencies: core + workspace).
 */

import * as fs from 'fs/promises';
import type { WorkspaceRoot, AbsPath, RelPath } from '../core/paths';
import { asWorkspaceRoot, asRelPath, toAbs, toRel } from '../core/paths';
import { PathEscapeError } from '../core/errors';
import { WorkspaceIO } from '../workspace/workspace-io';

/** Resolved artifact-store location + its scoped I/O surface. */
export interface ResolvedArtifactRoot {
    /** Canonical (realpath) absolute artifact root. */
    readonly artifactRoot: AbsPath;
    /** Workspace-relative form; `null` when the root is out-of-tree. */
    readonly artifactRootRel: RelPath | null;
    /** Realpath-strong I/O rooted at the artifact root. */
    readonly artifactIo: WorkspaceIO;
}

/**
 * Resolve `configArtifactRoot` against `workspaceRoot` (absolute values
 * kept as-is), create the directory, and build the artifact-scoped
 * `WorkspaceIO`. See the module banner for the containment rationale.
 */
export async function resolveArtifactRoot(
    configArtifactRoot: string,
    workspaceRoot: WorkspaceRoot,
): Promise<ResolvedArtifactRoot> {
    const resolved = toAbs(configArtifactRoot, workspaceRoot);
    // SIDE EFFECT (documented on `createWorkspaceContext`): ensure the
    // artifact root exists. Direct `fs.mkdir` by necessity — the artifact
    // IO cannot exist before its root does (WRITE_ALLOWLIST row in
    // tests/arch/workspace-paths.test.ts).
    await fs.mkdir(resolved, { recursive: true });
    const artifactIo = await WorkspaceIO.create(asWorkspaceRoot(resolved));
    const artifactRoot = artifactIo.getRealRoot();
    // `toRel` yields OS-native separators; normalize to forward slashes so
    // the relpath stays platform-stable for routes / DTOs. An out-of-tree
    // root has no workspace-relative form — `toRel` throws PathEscapeError
    // and we record `null` instead.
    let artifactRootRel: RelPath | null;
    try {
        artifactRootRel = asRelPath(
            toRel(artifactRoot, workspaceRoot).replace(/\\/g, '/'),
        );
    } catch (e) {
        if (!(e instanceof PathEscapeError)) throw e;
        artifactRootRel = null;
    }
    return { artifactRoot, artifactRootRel, artifactIo };
}
