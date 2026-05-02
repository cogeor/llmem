# Non-TS Call Graphs

Status: design sketch — promote to a full plan when scheduled.
Owners: parsers/*, graph-store, application/scan.

## Problem

TypeScript and JavaScript get full call graphs via the TS Compiler API. Every other supported language (Python, C++, Rust, R) is import-only because tree-sitter — the route we tried — did not give us call edges fast enough on real repos. Tree-sitter parses are fine; resolving "this call goes to that definition" across modules is what blew up the budget.

The product needs **something** for non-TS users. It does not need parity with TS.

## Constraints

- A typical user repo has 1k–50k files. Initial scan must finish in under 60s on a laptop; incremental updates on a single-file save must finish in under 2s.
- We are willing to ship a degraded but useful answer. Imports-only is "useful." Full whole-program call graph is "ideal but expensive."
- No long-lived language servers. Spawning `pyright` / `rust-analyzer` per session is too heavy.
- The platform (see `design/04_platform.md`) can spend more compute per repo than the local app can. The local path needs the cheap option; the platform path can afford the accurate one.

## Options considered

1. **Imports-only (status quo for non-TS).** Free, fast, already works. Downside: no call edges at all.
2. **Regex/scrape with language-aware patterns.** Cheap. Lossy: misses dynamic dispatch, decorators, attribute calls. Useful as a baseline if we admit it's a baseline.
3. **Tree-sitter + symbol resolution we write ourselves.** What we already tried. Symbol resolution across modules is the slow part, not the parse.
4. **SCIP indexers** (`scip-python`, `scip-clang`, `scip-rust`, etc. — Sourcegraph's open-source format). Each indexer is a single binary that produces a portable `.scip` index file with definitions and references. Fast on cold cache, faster on warm. Output is a stable protobuf format we can convert to our edge list.
5. **universal-ctags + readtags.** Very fast. Definitions are good; references require `--fields=+ne` and are imprecise but cheap.
6. **LSP-as-a-batch-job.** Run `pyright --outputjson` etc. once per scan, cache. Heavy, but accurate.
7. **LLM extraction at document-time.** The agent reads the file and returns the calls as structured output. Already works for `file_info`; doesn't scale to "show me the whole graph."

## Recommendation

Three-tier strategy, picked at scan-time per language:

### Tier 0 — Imports only (default)

Keep the current tree-sitter import extraction. This is the floor. Every supported language gets it.

### Tier 1 — Lightweight call extraction (local default for "I want some calls")

For Python and C++ specifically, ship a regex-style scraper that extracts:

- function-definition lines (`def foo(`, `class Foo:`, `void foo(`)
- direct calls within the same file (`foo(`, `self.foo(`, `Foo::foo(`)

Resolution is intra-file only. Cross-file calls become "import edge implies maybe-calls-something-in-target-module." We render those as a softer edge style in the viewer (see design/02). Cost: about the same as a tree-sitter parse, no symbol-resolution step.

Acceptance criteria: scan a 5k-Python-file repo in under 30s on a laptop; intra-file precision >90% on a labeled fixture set; no false negatives on top-level `def foo` declarations.

### Tier 2 — SCIP indexer (opt-in, default on the platform)

For users who care about accurate cross-file call edges:

- Detect a `.scip-index.scip` file in the workspace (or `.llmem/index.scip`). If present, prefer it over Tier 1 output.
- Provide `llmem index <language>` that shells out to the appropriate SCIP indexer if installed (`scip-python`, `scip-clang`, `scip-rust`, `scip-typescript`). Indexer binaries are not bundled — we wrap them.
- Convert SCIP `Document.occurrences` with `Definition` and `Reference` symbol roles into our `EdgeEntry` shape.

On the platform side, the indexer runs in a worker container per language and the result is part of the artifact bundle. The local viewer just consumes the bundle.

## Architecture placement

Per `ARCHITECTURE.md`:

- `packages/parsers/python/extractor.ts` (and equivalents) gain a `mode: 'imports' | 'tier1' | 'scip'` field on the extractor input.
- A new `packages/parsers/scip/` package contains the SCIP→edge-list converter. It is **not** language-specific — one converter handles all SCIP indexers.
- `packages/application/src/scan/index.ts` decides which tier to invoke per language at scan-time, based on user config and presence of SCIP indexes.

## Out of scope for this spec

- Whole-program type inference (Rust traits, Python protocols, C++ templates) — Tier 2 inherits whatever precision the SCIP indexer provides; we do not improve on it.
- JavaScript/TypeScript stays on the TS Compiler API path. The SCIP code path is available but not the default.
- Dynamic-dispatch resolution (Python `getattr`, C++ virtual through pointer). The SCIP indexers we wrap don't solve this either; we accept the limitation.

## Open questions

- What does the viewer look like when a graph mixes "hard" (TS Compiler / SCIP) and "soft" (Tier 1 regex) edges? See `design/02_folder_view.md` — soft edges should render visibly different.
- How do we ship indexer binaries? Probably "we don't" — point users to `brew install scip-python` etc., and the platform pre-installs them in the worker image.
- Should `llmem index` write into `.artifacts/` or `.llmem/`? Consolidate around `.llmem/` for human-edited config and `.artifacts/` for generated state, per `ARCHITECTURE.md`.
