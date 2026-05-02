# LLMem Memos

Architectural notes, design specs, and migration plans. Treat this folder the way `aipr/memo` is treated: a long-lived record of how we want the system shaped, not a changelog.

## Layout

- `ARCHITECTURE.md` — proposed end-state folder structure, layer rules, dependency directions.
- `MIGRATION.md` — the concrete file-by-file plan to get from today's tree to the proposed one.
- `CURRENT_STATE_2026-05-02.md` — snapshot of pain points observed during the May 2 review. Anchors why the refactor is shaped the way it is.
- `design/` — short specs for each upcoming feature. Each file is intentionally small; flesh it out into a full plan when the work starts.

## Design specs

| # | File | What it covers |
|---|------|----------------|
| 01 | [`design/01_non_ts_call_graphs.md`](design/01_non_ts_call_graphs.md) | Call-graph strategy for Python/C++/Rust/R after tree-sitter proved too slow |
| 02 | [`design/02_folder_view.md`](design/02_folder_view.md) | Replace the graph-only navigator with a real folder view |
| 03 | [`design/03_spec_to_code_mapping.md`](design/03_spec_to_code_mapping.md) | Map markdown specs (`memo/`, `docs/`) back to the code files they describe |
| 04 | [`design/04_platform.md`](design/04_platform.md) | Private control plane + open-source viewer; "paste a git URL, get insight" |
| 05 | [`design/05_claude_integration.md`](design/05_claude_integration.md) | First-class CLI + Claude Skills so agents can drive LLMem |

## How to read these

The architecture memo is **opinionated and load-bearing** — every new module placement should be justifiable against it. The design specs are **deliberately short**: enough to argue for/against a shape, not enough to start implementing. Promote a design spec into a full plan (`memo/<feature>/PLAN.md`) when the work is scheduled.

When implementation and intent disagree, fix the implementation or update the memo in the same change. Don't leave the architecture implicit — the codebase has already drifted once (`src/artifact/` vs `src/graph/`) and the cost shows up in every new feature.
