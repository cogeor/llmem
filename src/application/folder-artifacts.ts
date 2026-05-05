/**
 * Shared helper to build and persist folder artifacts (Loop 10).
 *
 * Reads `import-edgelist.json` + `call-edgelist.json` from `ctx.artifactRoot`,
 * walks `.arch/` for documented folders, calls the loop-08 aggregators
 * (`buildFolderTree`, `buildFolderEdges`), and persists the results via
 * the loop-09 stores.
 *
 * Two call sites share this helper:
 *   - `src/claude/server/regenerator.ts:regenerateWebview` — runs on every
 *     static-webview regeneration event.
 *   - `src/claude/cli/commands/scan.ts` — runs after `scanFolderRecursive`
 *     to keep the user-facing CLI emitting all four artifacts.
 *
 * The helper does NOT modify the import or call edge lists; it only
 * loads them. The pre-existing scan flow continues to own those writes.
 *
 * No console output. Callers (regenerator, CLI) own user-visible logging.
 *
 * Loop 04: signature is now `(ctx)` — the parallel `(artifactDir, io)` bag
 * is gone. The artifact directory comes from `ctx.artifactRoot`.
 */

import { ImportEdgeListStore, CallEdgeListStore } from '../graph/edgelist';
import { buildFolderTree } from '../graph/folder-tree';
import { buildFolderEdges } from '../graph/folder-edges';
import { FolderTreeStore } from '../graph/folder-tree-store';
import { FolderEdgelistStore } from '../graph/folder-edges-store';
import { scanArchFolders } from '../docs/arch-store';
import { parseGraphId } from '../core/ids';
import type { WorkspaceContext } from './workspace-context';

/**
 * Read import + call edge lists from `ctx.artifactRoot`, walk `.arch/` for
 * documented folders, build folder-tree + folder-edges, and persist both
 * artifacts to `ctx.artifactRoot`.
 *
 * Pre-condition: `import-edgelist.json` and `call-edgelist.json` exist
 * in `ctx.artifactRoot`. The caller (regenerator or CLI scan command) is
 * responsible for running the scan first. Missing edge lists → the
 * stores' `load()` returns an empty in-memory state (the
 * `BaseEdgeListStore` convention), which still produces valid empty
 * folder artifacts.
 *
 * Idempotent: re-running with no source changes produces equal data
 * (only `timestamp` differs, which is re-stamped on every save).
 *
 * Order of writes: tree first, then edges. The order matters only if a
 * future loader does cross-validation; today they are independent files.
 */
export async function buildAndSaveFolderArtifacts(
    ctx: WorkspaceContext,
): Promise<void> {
    const { artifactRoot: artifactDir, io } = ctx;

    // Load existing edge lists. Loop 07: `io` is now the second
    // (mandatory) constructor argument; `BaseEdgeListStore` falls back to
    // its internal `createLogger` when no logger is supplied.
    const importStore = new ImportEdgeListStore(artifactDir, io);
    const callStore = new CallEdgeListStore(artifactDir, io);
    await importStore.load();
    await callStore.load();

    // Walk `.arch/` for documented folders.
    const documentedFolders = await scanArchFolders(io);

    // Build the fileOf map. The map resolves entity IDs (and file IDs)
    // back to file IDs. Walk both stores' nodes once, then provide a
    // `parseGraphId` fallback for IDs not in the map (defensive — should
    // not happen in well-formed edge lists, but call edges may reference
    // entity IDs that were not registered as nodes if a parser regressed).
    const fileOfMap = new Map<string, string>();
    for (const node of importStore.getNodes()) {
        fileOfMap.set(node.id, node.fileId);
    }
    for (const node of callStore.getNodes()) {
        fileOfMap.set(node.id, node.fileId);
    }
    const fileOf = (id: string): string | null => {
        const cached = fileOfMap.get(id);
        if (cached !== undefined) return cached;
        const parsed = parseGraphId(id);
        if (parsed.kind === 'file') return parsed.fileId;
        if (parsed.kind === 'entity') return parsed.fileId;
        return null; // external module ID — drop in folder-edges aggregator
    };

    // Filter to file-kind nodes — buildFolderTree only consumes the `id`
    // field, so passing entity-kind nodes would double-count. The current
    // parser produces only file-kind nodes in import-edgelist.json, but
    // the schema allows entity kinds, so we defend.
    //
    // `loc` is intentionally omitted — `NodeEntry` does not carry per-file
    // LOC and adding it is out of scope for this loop. `totalLOC` will be
    // 0 across the tree.
    const fileNodes = importStore.getNodes().filter((n) => n.kind === 'file');
    const folderTree = buildFolderTree({
        importNodes: fileNodes.map((n) => ({ id: n.id })),
        documentedFolders,
    });

    const folderEdges = buildFolderEdges({
        importEdges: importStore.getEdges(),
        callEdges: callStore.getEdges(),
        fileOf,
    });

    // Persist via the two stores. Both stores re-stamp `timestamp` and
    // `schemaVersion` on save (loop 09 contract).
    const treeStore = new FolderTreeStore(artifactDir, io);
    const edgesStore = new FolderEdgelistStore(artifactDir, io);
    await treeStore.save(folderTree);
    await edgesStore.save(folderEdges);
}
