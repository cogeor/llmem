/**
 * The review-checklist registry (WS-1, pure data).
 *
 * `REVIEW_REGISTRY` is the single source of truth for the architecture-review
 * skill's item set: one `ChecklistItem` per defect class, transcribed from
 *   - `memo/architecture-review-skill-proposal-2026-06-24.md` (general block), and
 *   - `memo/frontend-architecture-review-skill-2026-06-24.md` (frontend block),
 * in memo order (general first, then frontend). Title, recall-strength glyph,
 * category, and the condensed "Graph surfaces … · LLM judges …" promptInstruction
 * are pulled straight from those memos.
 *
 * This loop wires NOTHING: `recallQuery` is just a string label. For items the
 * already-shipped analyzers feed it names the analyzer key ('cycles', 'clones',
 * 'interface-width'); every other item is 'instruction' (instruction-as-recall)
 * until Loop 02 / WS-4 rewire them. The array is `Object.freeze`d and
 * stable-ordered for deterministic iteration — no Date, no Math.random.
 */

import type { ChecklistItem } from './types';

export const REVIEW_REGISTRY: readonly ChecklistItem[] = Object.freeze([
    // ============================ GENERAL ============================

    // --- 2.1 Duplication & single-source-of-truth drift ---
    {
        id: 'D1',
        category: 'Duplication & SSOT drift',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Duplicated logic across files',
        recallQuery: 'clones',
        promptInstruction:
            'Graph surfaces clusters of structurally-equal function bodies / shared literal payloads spanning multiple files. LLM judges one concept needing a canonical owner, or justified divergence — and names the owner.',
    },
    {
        id: 'D2',
        category: 'Duplication & SSOT drift',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Overlapping constant / config sets',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces set/array literals (extension lists, ignore lists, default values, separators, magic numbers) whose members overlap across ≥2 modules. LLM judges should be single-sourced; which is canonical; is any copy already stale.',
    },
    {
        id: 'D3',
        category: 'Duplication & SSOT drift',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Producer/consumer format mismatch',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a value built by one helper/format but looked up / parsed via a different helper/format (key construction vs index keying; id minting vs id parsing). LLM judges whether the mismatch silently yields empty/wrong results.',
    },
    {
        id: 'D4',
        category: 'Duplication & SSOT drift',
        ruleset: 'general',
        scope: 'repo',
        recallStrength: '●○○',
        title: '"Canonical / single source of truth" claims',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) doc comments asserting authority over a concept. LLM judges whether a parallel implementation exists that contradicts the claim. Paradigm (typed): also surface structurally-equal type/DTO shapes across boundaries.',
    },

    // --- 2.2 Dead / unreachable / misleading code ---
    {
        id: 'DC1',
        category: 'Dead / unreachable / misleading code',
        ruleset: 'general',
        scope: 'repo',
        recallStrength: '●●●',
        title: 'Unreferenced surface',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces exported/public symbols with zero inbound call and import edges, minus entrypoints. LLM judges truly dead vs reached dynamically (reflection, registries, config-wiring, DI, separate bundles) — a confirm-not-delete check.',
    },
    {
        id: 'DC2',
        category: 'Dead / unreachable / misleading code',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Locally dead code',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces branches with provably-constant conditions; loops whose body unconditionally returns/throws/breaks on the first iteration; unused imports and locals. LLM judges dead-and-inert vs dead-and-masking.',
    },
    {
        id: 'DC3',
        category: 'Dead / unreachable / misleading code',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Comment/behavior mismatch',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) the unit. LLM judges does a comment promise behavior the code doesn\'t implement.',
    },

    // --- 2.3 Dependency structure & layering ---
    {
        id: 'DEP1',
        category: 'Dependency structure & layering',
        ruleset: 'general',
        scope: 'repo',
        recallStrength: '●●●',
        title: 'Cycles',
        recallQuery: 'cycles',
        promptInstruction:
            'Graph surfaces strongly-connected components in the module graph, split by whether the closing edge is runtime or erased/deferred. LLM judges load-bearing (init-order risk) vs hygiene-only; which edge to invert or relocate. Type-only/lazy imports closing a cycle are hygiene, not a runtime hazard.',
    },
    {
        id: 'DEP2',
        category: 'Dependency structure & layering',
        ruleset: 'general',
        scope: 'repo',
        recallStrength: '●●●',
        title: 'Layer-rank violations',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces import edges from a lower layer to a higher one, given a declared layer order. LLM judges real violation vs a mis-declared layer; whether to invert the dependency or move the type.',
    },
    {
        id: 'DEP3',
        category: 'Dependency structure & layering',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Boundary/adapter bypass',
        recallQuery: 'ambient',
        promptInstruction:
            'Graph surfaces host/boundary modules importing infrastructure/persistence directly instead of an application service. LLM judges should route through a service; which command/query it becomes.',
    },
    {
        id: 'DEP4',
        category: 'Dependency structure & layering',
        ruleset: 'general',
        scope: 'folder',
        recallStrength: '●●○',
        title: 'Concern-mixing module',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a folder whose files import across many distinct concern-clusters (e.g. pure algorithms + persistence + presentation). LLM judges split into layered submodules.',
    },

    // --- 2.4 Encapsulation, representation & interface shape ---
    {
        id: 'ENC1',
        category: 'Encapsulation, representation & interface shape',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Returned internal mutable reference',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces methods/functions returning a private field or internal collection directly. LLM judges is it mutable and genuinely leaked (caller can corrupt invariants / bypass a dirty flag). FP form: returning a closure over mutable captured state.',
    },
    {
        id: 'ENC2',
        category: 'Encapsulation, representation & interface shape',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Accessor bag / representation leak',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces setters whose body is a single field assignment; per-field get+set pairs. LLM judges representation leak (accessors guard no invariant) → collapse to intention-revealing operations that own the writes.',
    },
    {
        id: 'ENC3',
        category: 'Encapsulation, representation & interface shape',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Interface width',
        recallQuery: 'interface-width',
        promptInstruction:
            'Graph surfaces, per module, count of members reached from outside, how concentrated inbound traffic is, and how much implementation sits behind them. LLM judges deep (narrow over large hidden impl) vs shallow pass-throughs. Critical filter: separate production from incidental callers by reading who they are — not by path/name.',
    },
    {
        id: 'ENC4',
        category: 'Encapsulation, representation & interface shape',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Near-duplicate member families',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces members sharing a name stem with high body overlap (e.g. handleX/handleY, getAByB/getAByC). LLM judges collapse to one parameterized operation, or genuinely distinct.',
    },
    {
        id: 'ENC5',
        category: 'Encapsulation, representation & interface shape',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Fat / optional-method interfaces (ISP)',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces interfaces with many members and/or optional methods that force capability discovery by callers. LLM judges split into role interfaces.',
    },

    // --- 2.5 State, concurrency & lifecycle ---
    {
        id: 'ST1',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Global mutable state / singletons',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces module-level mutable bindings. LLM judges a hidden process-global that blocks multiple instances / leaks across tests / requires explicit reset APIs.',
    },
    {
        id: 'ST2',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Read-modify-write without isolation',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces read→mutate→write (load/save) sequences on shared storage not enclosed by a transaction/lock. LLM judges can it race a concurrent writer; is a sibling path enclosed while this one isn\'t (asymmetry is the tell).',
    },
    {
        id: 'ST3',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Non-atomic multi-resource publish',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces multiple related stores/outputs saved independently. LLM judges partial-failure leaves a torn snapshot → stage and publish atomically.',
    },
    {
        id: 'ST4',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Resource lifecycle',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces acquisitions (open/watch/listen/subscribe/connect) without a matching release on all paths. LLM judges leak on error or teardown.',
    },
    {
        id: 'ST5',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Guard / single-flight integrity',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) a guarded operation and its call sites. LLM judges do all entry points pass through the guard, or can some bypass it; when busy, does it drop work or queue/coalesce.',
    },
    {
        id: 'ST6',
        category: 'State, concurrency & lifecycle',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Query with hidden write (CQS)',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) get/is/query-named members. LLM judges does a nominally-pure query mutate state.',
    },

    // --- 2.6 Module cohesion & boundaries ---
    {
        id: 'CO1',
        category: 'Module cohesion & boundaries',
        ruleset: 'general',
        scope: 'folder',
        recallStrength: '●○○',
        title: 'Cohesion vs grab-bag',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a wide module plus its member name-clusters. LLM judges one concern (a legitimate deep namespace — leave it) vs ≥2 orthogonal clusters (a grab-bag — split). No pure metric decides this.',
    },
    {
        id: 'CO2',
        category: 'Module cohesion & boundaries',
        ruleset: 'general',
        scope: 'folder',
        recallStrength: '●●○',
        title: 'Facade integrity',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a folder with an index/barrel whose external production callers reach ≥2 internal files. LLM judges a genuinely missing facade vs legitimate direct access.',
    },
    {
        id: 'CO3',
        category: 'Module cohesion & boundaries',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Param-bag split',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) modules whose parameters/state mirror a single other object. LLM judges extracted only to satisfy a size budget while preserving the original coupling — a smaller file, not a smaller unit.',
    },
    {
        id: 'CO4',
        category: 'Module cohesion & boundaries',
        ruleset: 'general',
        scope: 'repo',
        recallStrength: '●●○',
        title: 'Boundary-type sprawl',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces structurally-equal types defined across module boundaries. LLM judges name each boundary representation explicitly and centralize conversion, rather than relying on accidental structural compatibility.',
    },

    // --- 2.7 Error & outcome semantics ---
    {
        id: 'ER1',
        category: 'Error & outcome semantics',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Error-type discipline',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces error classes not descending from a common base / lacking a discriminable code; structurally-identical error classes. LLM judges unify under a base with codes so callers can branch.',
    },
    {
        id: 'ER2',
        category: 'Error & outcome semantics',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Outcome conflation',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) functions returning nullable/boolean where a richer result is plausible. LLM judges does it collapse absent / unsupported / failed / skipped / successfully-empty into one value → replace with a discriminated outcome.',
    },
    {
        id: 'ER3',
        category: 'Error & outcome semantics',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Swallowed failure',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) catch/except sites. LLM judges converts a failure into misleading success or an empty result; catches where the layer can\'t actually recover.',
    },
    {
        id: 'ER4',
        category: 'Error & outcome semantics',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Inconsistent failure shape',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) sibling handlers within one boundary. LLM judges some throw, some return an error envelope, envelopes differ — callers can\'t rely on one contract.',
    },

    // --- 2.8 Local correctness & classification ---
    {
        id: 'LC1',
        category: 'Local correctness & classification',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Predicate-subject errors',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) classification/predicate calls. LLM judges is the predicate applied to the correct subject (e.g. a classifier testing the wrong AST child / the wrong field), silently mis-categorizing.',
    },
    {
        id: 'LC2',
        category: 'Local correctness & classification',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Boundary / index arithmetic',
        recallQuery: 'instruction',
        promptInstruction:
            'LLM judges off-by-one in spans, slices, ranges, depth/index math.',
    },
    {
        id: 'LC3',
        category: 'Local correctness & classification',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Exhaustiveness',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces switch/match over a union/enum lacking a default / never-guard. LLM judges missing case handling. Paradigm: typed / ADT languages.',
    },
    {
        id: 'LC4',
        category: 'Local correctness & classification',
        ruleset: 'general',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Parse-error blindness',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces parser/compiler-frontend invocations whose error/diagnostic channel is unchecked. LLM judges silent acceptance of a partial/failed parse. Paradigm: parser/compiler tooling.',
    },

    // ============================ FRONTEND ============================

    // --- 2.1 Dead / dormant UI surface (FD) ---
    {
        id: 'FD1',
        category: 'Dead / dormant UI surface',
        ruleset: 'frontend',
        scope: 'repo',
        recallStrength: '●●●',
        title: 'Orphan UI modules',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces components/services with zero inbound import and zero inbound call edges, minus the registered entrypoints. LLM judges retired vs reached via registry/dynamic mount.',
    },
    {
        id: 'FD2',
        category: 'Dead / dormant UI surface',
        ruleset: 'frontend',
        scope: 'repo',
        recallStrength: '●●○',
        title: 'Unreachable routes/views',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces members of a route/view-name union with no matching registration call. LLM judges dormant-pending vs delete. (graph add: B3 route-literal reachability.)',
    },
    {
        id: 'FD3',
        category: 'Dead / dormant UI surface',
        ruleset: 'frontend',
        scope: 'repo',
        recallStrength: '●●○',
        title: 'Dormant dependency / asset',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a bundled library or <script> asset whose only importer is an FD1/FD2 orphan. LLM judges ship-for-nothing vs lazy-loaded-on-demand.',
    },
    {
        id: 'FD4',
        category: 'Dead / dormant UI surface',
        ruleset: 'frontend',
        scope: 'repo',
        recallStrength: '●●○',
        title: 'Duplicate shell/template source',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces structurally-equal markup across a static template file and a render function; or a parity test pinning two artifacts in sync (an SSOT violation in disguise). LLM judges which is canonical; delete or generate-from-canonical. (graph add: C1 template clones.)',
    },

    // --- 2.2 Host boundary & ambient coupling (FB) ---
    {
        id: 'FB1',
        category: 'Host boundary & ambient coupling',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Ambient-global bypass',
        recallQuery: 'ambient',
        promptInstruction:
            'Graph surfaces modules reading injected globals (window.GRAPH_DATA, window.DESIGN_DOCS, window.<INJECTED>) that aren\'t the designated bootstrap/adapter. LLM judges boundary violation vs sanctioned single entry. Instruction (until A2 ships): grep the injected-global allow-list and read each non-adapter reader.',
    },
    {
        id: 'FB2',
        category: 'Host boundary & ambient coupling',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Host-capability conflation',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces one adapter/provider class importing ≥2 disjoint transport stacks (ambient globals + HTTP client + WebSocket). LLM judges distinct hosts (snapshot/HTTP/IDE) masquerading as one class with silent fallbacks → split into capability-typed adapters.',
    },
    {
        id: 'FB3',
        category: 'Host boundary & ambient coupling',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Logic on the wrong side of the boundary',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) webview modules that re-derive domain facts the host already computed. LLM judges "dumb client" violation → push computation to the host. Platform (VS Code): minimize webview surface; prefer host APIs.',
    },

    // --- 2.3 Resource single-source-of-truth (FR) ---
    {
        id: 'FR1',
        category: 'Resource single-source-of-truth',
        ruleset: 'frontend',
        scope: 'folder',
        recallStrength: '●●○',
        title: 'Multi-owned server payload',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a server DTO (GraphData, worktree, docs) held as a long-lived field by ≥2 modules. LLM judges authoritative copies that must each be refreshed vs deliberate memoized projections. (graph add: A3 payload-owner map.)',
    },
    {
        id: 'FR2',
        category: 'Resource single-source-of-truth',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Stored-derived state',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) state fields written from other state/data. LLM judges a value that can drift from its source → derive on read or via selector.',
    },

    // --- 2.4 Interface / host-protocol shape (FI / FP) ---
    {
        id: 'FI1',
        category: 'Interface / host-protocol shape',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●●',
        title: 'God-facade provider',
        recallQuery: 'interface-width',
        promptInstruction:
            'Graph surfaces a service interface with high surface width and many optional members consumed in disjoint caller subsets. LLM judges split into role interfaces (resource / commands / navigation / events). (graph add: B2 interface-width on interfaces.)',
    },
    {
        id: 'FP1',
        category: 'Interface / host-protocol shape',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Untyped transport boundary',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces message/event sinks whose payload is any/unknown with no validator before dispatch. LLM judges serialized transport needs a runtime codec (it is data, not a trusted call). Platform: VS Code/WebSocket/static-bootstrap all cross a serialization boundary. (graph add: B1 transport-boundary nodes.)',
    },
    {
        id: 'FP2',
        category: 'Interface / host-protocol shape',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Stringly-typed message protocol',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces message type string literals shared across both ends (clone/literal index). LLM judges scatter that requires coordinating literals across several files → one discriminated-union protocol module. Paradigm (typed): make invalid request/response combinations unrepresentable.',
    },

    // --- 2.5 Component lifecycle & resource disposal (FL) ---
    {
        id: 'FL1',
        category: 'Component lifecycle & resource disposal',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Listener/subscription leak',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces an entity that registers (addEventListener/subscribe/observe) in mount/constructor without a symmetric release on all teardown paths; a mount that re-subscribes without disposing the prior subscription. LLM judges real leak vs app-lifetime singleton. Instruction (until A1 ships): diff register vs release call counts. (graph add: A1 lifecycle balance.)',
    },
    {
        id: 'FL2',
        category: 'Component lifecycle & resource disposal',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Inconsistent lifecycle contract',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces components lacking a uniform mount/update/unmount shape — some async, some sync, teardown named unmount vs destroy vs absent. LLM judges standardize one contract so disposal is reliable. Platform: Web Components connect/disconnect is the canonical shape.',
    },
    {
        id: 'FL3',
        category: 'Component lifecycle & resource disposal',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Side-effect on import',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces module-top-level subscriptions/listener registration (runs at load, never torn down). LLM judges move into a lifecycle hook.',
    },
    {
        id: 'FL4',
        category: 'Component lifecycle & resource disposal',
        ruleset: 'frontend',
        scope: 'folder',
        recallStrength: '●○○',
        title: 'Routing without lifecycle',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) the router and its registered components. LLM judges does routing hide/show via DOM topology while leaving off-route components mounted and subscribed, instead of activate/deactivate.',
    },

    // --- 2.6 State-model integrity (FM) ---
    {
        id: 'FM1',
        category: 'State-model integrity',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●●',
        title: 'Leaked mutable state handle',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces a store getter returning the internal state object/collection by reference. LLM judges callers can mutate without notifying subscribers → return readonly/cloned, or expose intent operations.',
    },
    {
        id: 'FM2',
        category: 'State-model integrity',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Contradictable state shape',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) correlated flat fields. LLM judges fields that can disagree (path + type + origin as three independent slots) → one discriminated union; make invalid states unrepresentable.',
    },
    {
        id: 'FM3',
        category: 'State-model integrity',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'Scattered transition logic',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces count of distinct call sites mutating the store. LLM judges many ad-hoc set(partial) sites with no named transitions → actions + a pure reducer when the spread becomes hard to follow.',
    },
    {
        id: 'FM4',
        category: 'State-model integrity',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Coarse notification',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) subscribers that hand-diff the last value to detect what changed. LLM judges a whole-state notify forcing manual diffing → keyed/selector subscriptions.',
    },

    // --- 2.7 Rendering strategy (FV) ---
    {
        id: 'FV1',
        category: 'Rendering strategy',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●●○',
        title: 'DOM-as-source-of-truth',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces render-layer entities reading model facts back out of the DOM (querySelector(...).textContent, .dataset reads). LLM judges DOM should be output, not source → read from the model/view-model. (graph add: A4 DOM-read attribute.)',
    },
    {
        id: 'FV2',
        category: 'Rendering strategy',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Imperative innerHTML density',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) .innerHTML = assignment sites per component. LLM judges string-built DOM with interpolation (escaping burden, listener reattach, focus loss) → declarative/keyed templates; confirm every interpolation is escaped.',
    },
    {
        id: 'FV3',
        category: 'Rendering strategy',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Full-subtree replacement',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) components that rebuild their entire content on each update. LLM judges focus/state loss + re-attached listeners → keyed/incremental update; for large trees, render only expanded subtrees.',
    },
    {
        id: 'FV4',
        category: 'Rendering strategy',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Hand-rolled renderer without justification',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) a custom canvas/SVG render stack alongside (or instead of) an established lib. LLM judges is the hand-roll justified in writing (interaction or perf the lib can\'t express) or accidental cost; are layout and draw at least separated.',
    },
    {
        id: 'FV5',
        category: 'Rendering strategy',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Synchronous heavy layout',
        recallQuery: 'instruction',
        promptInstruction:
            'Graph surfaces (scoping) layout/render run on resize/refresh. LLM judges for large inputs, move pure layout off the UI thread (worker). Platform: only when measurements justify it — a perf-design call, not a defect.',
    },

    // --- 2.8 Styling & theming (FS) ---
    {
        id: 'FS1',
        category: 'Styling & theming',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Style ownership by type not feature',
        recallQuery: 'instruction',
        promptInstruction:
            'Instruction: read the stylesheet manifest. LLM judges styles grouped by technical type (base/layout/tree/graph) with feature behavior split across files + inline style= + element.style writes + JS color literals → colocate feature styles, semantic tokens, cascade layers.',
    },
    {
        id: 'FS2',
        category: 'Styling & theming',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Source-order / !important precedence',
        recallQuery: 'instruction',
        promptInstruction:
            'Instruction: scan for !important clusters and state-encoding selectors. LLM judges visual state (cycle/clone/highlight/faded) encoded by source order + !important is fragile to extend → data-attribute states + @layer. (graph add: C2.)',
    },
    {
        id: 'FS3',
        category: 'Styling & theming',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Theme model conflict',
        recallQuery: 'instruction',
        promptInstruction:
            'Instruction: open the theme manager. LLM judges a webview maintaining its own light/dark toggle that overrides the host theme and ignores high-contrast. Platform (VS Code): consume vscode-light/dark/high-contrast body classes + --vscode-* vars; browser uses prefers-color-scheme.',
    },

    // --- 2.9 Accessibility & semantics (FA) ---
    {
        id: 'FA1',
        category: 'Accessibility & semantics',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Non-semantic interactive elements',
        recallQuery: 'instruction',
        promptInstruction:
            'Instruction: open the tree/list/toggle renderers. LLM judges clickable divs acting as a tree without role=tree/treeitem/group, aria-expanded, keyboard focus + arrow navigation. Platform: W3C WAI-ARIA tree-view pattern.',
    },
    {
        id: 'FA2',
        category: 'Accessibility & semantics',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Control state semantics',
        recallQuery: 'instruction',
        promptInstruction:
            'Instruction: open toggle/tab controls. LLM judges missing aria-pressed/tab semantics; mouse-only SVG interactions with no keyboard path.',
    },
    {
        id: 'FA3',
        category: 'Accessibility & semantics',
        ruleset: 'frontend',
        scope: 'file',
        recallStrength: '●○○',
        title: 'Live-region feedback',
        recallQuery: 'instruction',
        promptInstruction:
            'LLM judges loading/error states announced (a LiveRegion) vs silent.',
    },
] as const);
