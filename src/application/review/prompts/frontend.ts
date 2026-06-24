/**
 * `FRONTEND_REVIEW_PROMPT` — the frontend specialization of the review methodology,
 * distilled from `memo/frontend-architecture-review-skill-2026-06-24.md`.
 *
 * Same G→L operating model, same recall-strength scale, same coverage discipline as the
 * general prompt — this section adds the one reframe that matters for UI code
 * (instruction-as-recall), the platform/paradigm gating, and the frontend-specific
 * standing cautions. The rendered checklist supplies each frontend item's own
 * instruction; this is the framing those instructions assume.
 */
export const FRONTEND_REVIEW_PROMPT = `# Frontend / webview review — methodology

Use this IN ADDITION TO the general methodology, not instead of it: the general
categories (duplication, dead code, dependency/layering, interface width, state,
cohesion, error semantics, local correctness) all still apply to UI code. This section
adds the UI-specific items and sharpens recall for the ones the frontend stresses hardest.
Scope: browser/webview UI — VS Code webviews, framework-less or framework UIs, custom
canvas/SVG renderers.

## Operating model — instruction is also recall

Identical G→L pipeline: every item is graph recall then LLM filter, never graph-only,
never LLM-only. The one reframe that matters for frontend:

> The graph is one input to llmem, not the whole of it. llmem's value is the graph PLUS
> this skill driving an agent. So "recall" can come from a graph edge OR from a checklist
> instruction that tells you exactly what to look for.

An item with no current graph signal is NOT a blind spot — it is a ●○○ item whose
narrowing is done by the *instruction* ("for a VS Code webview, open the tree renderer and
check for \`treeitem\` roles") rather than by an edge. A ●○○ frontend item still has FULL
recall, because the instruction names the precise place to look. The frontend's hardest
defects are edgeless by nature — ambient globals, listener lifecycle, untyped transport,
DOM-as-source — and the checklist carries them as instruction-narrowed ●○○ items today.
Walking the list still visits each candidate; that is precisely why an agent reading with
this checklist already recovers them.

## Platform / paradigm gating

A check is only as good as the paradigm it fits. State which apply before you judge:

- VS Code webview vs browser SPA. FB (host boundary), FP (postMessage protocol), FS3
  (host theme), and \`getState\`/\`setState\` persistence apply to the IDE host; browser/HTTP
  mode swaps these for \`prefers-color-scheme\`, \`fetch\`, and snapshot bootstrap. The IDE
  host, an HTTP-served host, and an immutable \`file://\` snapshot have materially different
  capabilities — name the host you are reviewing and gate accordingly.
- Framework vs framework-less. FL2 (uniform lifecycle contract) is the framework-less
  tax; with a framework, instead check that lifecycle hooks OWN external
  listeners/observers rather than re-checking presence. The imperative-render items
  (innerHTML density, full-subtree replacement) are acute framework-less and largely moot
  under a declarative framework.
- Custom renderer vs library. The hand-rolled-renderer items (justification, synchronous
  heavy layout, layout/draw separation) apply only when a custom canvas/SVG render stack
  exists; skip them for a pure library renderer.
- Parser-coverage gaps. CSS and HTML are not in the graph today, so styling and
  shell/template-clone recall is instruction-driven. The prompt MUST say so, so a
  "0 candidates" there is NOT read as "clean." This is the instruction-as-recall path, not
  a gap in coverage.

## Frontend standing cautions

Apply these before calling any UI candidate a defect — or a non-issue:

- A host-lifetime singleton listener is not a leak. A register-without-release only counts
  when the entity actually remounts or is disposed; an app-lifetime singleton that listens
  for the whole session is fine.
- A deliberate memoized projection is not a multi-owner defect. A server payload held by
  two-plus modules is a smell only when each is an authoritative copy that must be
  separately refreshed — a read-through memoized projection of a single source is not.
- An instruction-narrowed item with no graph edge is still in-scope, not a blind spot.
  Open the named file and read for the named thing; absence of a candidate list is the
  expected state for FB1-pre-edge, FL1-pre-edge, and all of FS*/FA*, not permission to
  skip.
- DOM is output, not source. Treat reading model facts back out of rendered DOM
  (\`textContent\`, \`.dataset\`, scraped SVG node text) as a defect to confirm, not a
  convenience.`;
