/**
 * `GENERAL_REVIEW_PROMPT` — the methodology + standing cautions that frame how an
 * agent works the rendered review checklist. Distilled from
 * `memo/architecture-review-skill-proposal-2026-06-24.md`.
 *
 * This is deliberately NOT a copy of all 34 item bodies: the registry already carries
 * each item's `promptInstruction`, and the rendered checklist supplies them inline. What
 * lives here is the operating model (G→L), the recall-strength scale, the three passes,
 * coverage discipline, and the §5 standing filter cautions — the framing the per-item
 * instructions assume.
 */
export const GENERAL_REVIEW_PROMPT = `# General architecture review — methodology

A language- and codebase-agnostic review methodology. Walked per-file and per-folder it
recovers defects of every class on the checklist. The rendered checklist below carries
each item's own instruction; THIS section is the operating model and the standing
cautions that frame how you work every one of them.

## Operating model — every item is G→L (graph recall → LLM filter)

There is no "graph-only" or "LLM-only" check. Every item is a pipeline:

1. Graph recall — the tool produces a *candidate* set from the persisted graph (imports,
   calls, entities) + a local AST walk + duplication index. A candidate is never a verdict.
2. LLM filter — you read the candidate's code and decide: real defect, or justified.

The graph never decides alone (structure is not intent); you never start blind (the graph
at minimum scopes the unit, and usually pre-narrows it). What varies between items is only
*recall strength* — how tightly the graph narrows before you read:

- ●●● strong — exact candidate list from an edge/AST pattern; little noise.
- ●●○ partial — heuristic candidates; real noise you must clear.
- ●○○ scoping — the graph mainly hands you the *unit to read*; the signal is weak and the
  judgment is almost entirely yours.

Recall strength is NOT a category and NOT a license to skip the LLM step. A ●●● hit still
requires confirmation; a ●○○ item still gets a scoped starting point you must read. It
only tells you how much reading the graph saved you, so the cheap precise checks run
before the read-everything ones.

## The three passes

- P0 — Recall (run once). The tool executes the graph/AST query behind *every* item and
  attaches the candidate lists, scoped per file and per folder. This is the no-skip
  guarantee: you are *handed* every candidate rather than having to remember to look.
- P1 — Per file. For each non-test source file: judge every candidate P0 attached to it,
  and read for the scoping-level items the graph cannot pre-narrow.
- P2 — Per folder / module. Cohesion, boundaries, layering, cross-sibling duplication,
  aggregates.
- P3 — Per repo (once). Drift, cycles, cross-cutting consistency, boundary-type sprawl.

Categories are ordered by descending recall strength, so you work the precise checks first.

## Coverage discipline (the point)

A defect escapes only if it maps to NO item. When that happens the remedy is mechanical:
add the item, which permanently closes that *class* for every future repo. The list grows
by exactly that rule — a missed bug is a missing item, not a missed reviewer. That turns
"we reviewed it" into "defects of these classes cannot have been skipped, because the
process visits each candidate." So: visit each candidate. Do not pattern-match a category
title and move on.

## Standing filter cautions

These hold across every item; apply them before you call anything a defect — or a non-issue:

- Production-vs-incidental reach-in is *reasoned, not path-filtered.* When judging
  interface width / facade integrity, separate production callers from incidental ones
  (tests, diagnostics, tooling) by READING WHO THEY ARE. Do not filter by path or name —
  test code hides under many naming conventions. A surface wide only because of white-box
  tests is not an architecture smell.
- Cohesive-wide is not grab-bag. A wide module can be one legitimate deep namespace (leave
  it) or two-plus orthogonal concern-clusters (split it). No pure metric decides this; it
  is your call from reading the members.
- Structure is not intent. The graph supplies existence and shape — who refers to whom,
  what repeats, what is unreachable, what closes a cycle. It does not supply meaning. You
  decide whether a duplicate should be one thing, whether a comment lies, whether a return
  type conflates outcomes, whether a guard covers every path.
- A graph blind spot is not a clean bill. Wherever the graph cannot see the wiring —
  dynamic dispatch, reflection, config-driven composition, DI, a separately-bundled
  target — items degrade to scoping-level for those edges. A false "0 candidates" there
  must NOT be read as "clean": READ for it instead.`;
