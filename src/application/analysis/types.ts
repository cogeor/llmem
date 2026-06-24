/**
 * Analysis capability-layer DTOs.
 *
 * Pure type declarations for the `src/application/analysis/` capability layer:
 * the health-report data structures (findings, cycle findings, the measurement
 * vector, the composed report) plus the Phase-2 MCP `Issue` schema (declared
 * now, consumed in a later loop).
 *
 * Determinism note: NONE of these carry a timestamp. `Finding.id` /
 * `CycleFinding.id` are derived deterministically from member ids + kind so the
 * same analysis input yields byte-identical reports across runs.
 */

/** Finding priority. */
export type Severity = 'high' | 'medium' | 'low';

/** Discriminator over the analysis dimensions. */
export type FindingKind =
    | 'import-cycle'
    | 'call-cycle'
    | 'clone'
    | 'hub'
    | 'recursion';

/** Base finding shared by all analyzers. */
export interface Finding {
    id: string; // stable, derived from members/kind (NO timestamp)
    type: FindingKind;
    severity: Severity;
    title: string; // human one-liner
    detail: string; // full text explanation
    relatedFiles: string[];
}

/** Import / call cycle finding. */
export interface CycleFinding extends Finding {
    type: 'import-cycle' | 'call-cycle' | 'recursion';
    kind: 'import-cycle' | 'call-cycle' | 'recursion'; // discriminator (call/recursion added Loop 04)
    members: string[]; // sorted SCC node ids
    shortestPath: string[]; // closed ordered node-id hop list (path[0] === path[last])
    // Loop 03 (type-only annotation): edge-count split + runtime-member
    // derivation. OPTIONAL so hand-built findings (Loop 01 determinism tests)
    // still type-check and the renderer can fall back deterministically.
    typeOnlyEdgeCount?: number; // in-cycle edges that are `import type` (erased)
    totalEdgeCount?: number;    // total in-cycle edges of this SCC
    runtimeMembers?: string[];  // members surviving type-only edge removal (sorted)
}

/**
 * Clone-cluster finding (Loop 06; `sharedKind` + shared-literal added Loop 07).
 * `members` are sorted entity ids.
 */
export interface CloneFinding extends Finding {
    type: 'clone';
    /**
     * Clone strength dimension (Loop 06 → 07): `exact-body` (Type-1/2 identical
     * normalized body) or `shared-literal` (same literal payload across distinct
     * functions). Strength order: exact-body > shared-literal.
     */
    cloneType: 'exact-body' | 'shared-literal';
    /** For `shared-literal`: which kind of payload is shared (Loop 07). */
    sharedKind?: 'string' | 'array' | 'regex' | 'numeric';
    similarity: number; // 1 for exact-body
    members: string[]; // sorted entity ids
}

/** Label distinguishing a healthy shared dependency from a risky hub. */
export type HubLabel = 'kernel' | 'unstable-hub';

/** Hub / instability finding for a single import-graph file node. */
export interface HubFinding extends Finding {
    type: 'hub';
    ca: number;          // fan-in: distinct incoming file→file deps
    ce: number;          // fan-out: distinct outgoing file→file deps
    instability: number; // I = ce / (ca + ce), 0 when ca+ce === 0
    label: HubLabel;
}

/** Result of `findCallCycles`: mutual-recursion cycles vs the low-priority self-recursion bucket. */
export interface CallCycleResult {
    cycles: CycleFinding[]; // multi-node SCCs (kind:'call-cycle')
    recursion: Finding[]; // size-1 self-loop SCCs (type/kind:'recursion')
}

/** A node-attached smell (webview-only consumer in later loops; type defined now). */
export interface Smell {
    kind: FindingKind;
    severity: Severity;
    title: string;
}

/** The measurement vector (spec §7 — fields VERBATIM, all numbers). */
export interface HealthVector {
    importCyclesRuntime: number;
    importCyclesInclTypeOnly: number;
    callCyclesMutual: number;
    callCyclesRecursion: number;
    cloneClustersHigh: number;
    cloneClustersTotal: number;
    maxFanIn: number;
    hubOutliers: number;
    filesOverBudget: number;
}

/** Composed report assembled by `runHealthScan`. */
export interface HealthReport {
    repo: string; // repo label (basename of workspace root)
    vector: HealthVector; // the scorecard
    importCycles: CycleFinding[];
    callCycles: CycleFinding[]; // multi-node call SCCs (Loop 04)
    recursion?: Finding[]; // Loop 04: direct self-recursion bucket (low priority)
    clones: CloneFinding[]; // Loop 06: exact-body clone clusters
    hubs: HubFinding[]; // Loop 05: hub / instability outliers (kernel|unstable-hub)
}

/** Phase-2 (MCP) issue schema — spec §0 VERBATIM. Type ONLY this loop. */
export interface Issue {
    id: string;
    type: 'import-cycle' | 'call-cycle' | 'clone' | 'hub' | 'recursion';
    severity: 'high' | 'medium' | 'low';
    title: string;
    detail: string;
    relatedFiles: string[];
    proposedFix: string;
    verified: boolean;
}

/** All-zeros `HealthVector` — convenience for composers / tests. Pure. */
export function zeroHealthVector(): HealthVector {
    return {
        importCyclesRuntime: 0,
        importCyclesInclTypeOnly: 0,
        callCyclesMutual: 0,
        callCyclesRecursion: 0,
        cloneClustersHigh: 0,
        cloneClustersTotal: 0,
        maxFanIn: 0,
        hubOutliers: 0,
        filesOverBudget: 0,
    };
}
