# Spec → Code Mapping

Status: design sketch.
Owners: packages/docs (new index module), application/linkSpec, platform-mcp (new tools).

## Problem

Markdown specs live in `memo/`, `docs/`, RFC folders, ADRs, the wiki. They describe code. The relationship is implicit — you have to read the spec and then go find the files. As specs accumulate, that linkage rots: the spec mentions `EdgeListStore`, the code now calls it `GraphStore`, and nothing flags the drift.

We want a two-way index:

- given a spec, list the code files it describes
- given a code file, list the specs that reference it
- surface drift when a spec mentions a symbol that no longer exists

## Sources of truth (the spec author's input)

A spec opts into the index in one of three ways, in order of precedence:

### 1. Front-matter `targets:`

```markdown
---
title: Folder view
targets:
  - packages/domain/src/folder-tree.ts
  - apps/web-viewer/src/features/folder-tree/**
  - "!apps/web-viewer/src/features/folder-tree/**/*.test.ts"
---
```

Globs are resolved against the workspace root. Negative patterns (`!...`) exclude. This is the canonical, explicit form — recommended for any new spec.

### 2. Inline `@code(...)` directives

For specs that describe many things, keep `targets:` empty and annotate sections:

```markdown
## Tree primitives

@code(packages/domain/src/folder-tree.ts)

The interface looks like ...
```

Each `@code(...)` line maps the **paragraph it sits in** to the named file. Useful for long specs where front-matter would be a flat list of 30 globs.

### 3. Implicit (last resort)

If neither is present, scan the spec for fenced paths in backticks (`` `src/...` ``) and identifier references that match exported symbol names from the graph. This is best-effort, lossy, and only enabled when the user opts in via `.llmem/config.toml` because false positives are noisy.

## Index shape

`packages/docs/src/spec-index.ts` produces and persists:

```ts
interface SpecIndex {
  version: string;
  byFile: Record<RelPath, SpecRef[]>;     // for "what specs reference this file?"
  bySpec: Record<RelPath, FileRef[]>;     // for "what files does this spec describe?"
  driftWarnings: DriftWarning[];          // see below
}

interface SpecRef {
  spec: RelPath;            // "memo/design/02_folder_view.md"
  section?: string;         // "## Tree primitives"
  sourceKind: 'frontmatter' | 'directive' | 'implicit';
}

interface DriftWarning {
  spec: RelPath;
  reference: string;        // e.g. "EdgeListStore" or a glob that matched zero files
  reason: 'missing-file' | 'missing-symbol' | 'glob-empty';
}
```

Persisted as `.artifacts/spec-index.json`. Rebuilt incrementally on save (chokidar watches `memo/**/*.md`, `docs/**/*.md`, and any folder configured in `.llmem/config.toml::specRoots`).

## How it shows up

### In the viewer

- Folder view (design/02) marks each file with `§` if any spec links to it. Click to expand a popup listing the specs.
- Right-panel can switch between "design doc for this file" (current behavior — `.arch/{path}.md`) and "specs that reference this file" (new tab fed by `byFile[path]`).
- Drift warnings render in a top-of-panel banner the first time a stale spec opens, with a "dismiss until next change" option.

### In MCP

Two new tools in `platform-mcp`:

- `specs_for_file(path)` → list of `SpecRef`. Used by agents that want to know what intent the file is supposed to satisfy.
- `files_for_spec(specPath)` → list of `FileRef`. Used by agents writing code from a spec — "here's the spec, here are the files I should be touching."

Both go through the same `application/linkSpec.ts` use case. No SDK calls live in `application`.

### In the CLI

```
llmem specs status               # summary: N specs, M files linked, K drifts
llmem specs lint                 # exit non-zero if drifts exist (CI gate)
llmem specs show <spec>          # list the files the spec references
llmem specs touching <file>      # list the specs that reference the file
```

`llmem specs lint` in CI catches the "spec talks about `EdgeListStore`, code renamed to `GraphStore`" rot before it ships.

## Architecture placement

Per `ARCHITECTURE.md`:

- `packages/docs/src/spec-index.ts` — pure indexer, no I/O outside `platform-fs`.
- `packages/application/src/spec/link.ts` — orchestrates "scan specs, build index, persist".
- `packages/platform-mcp/src/tools/specs-for-file.ts` and `files-for-spec.ts` — one tool per file, < 200 lines each.
- `apps/cli/src/commands/specs.ts` — the `llmem specs *` family.

## Open questions

- How permissive is the directive parser? Markdown is hostile to ad-hoc syntax. The proposal is "look for lines whose entire content is `@code(<glob>)`" — anything fancier and we're writing a parser for a new language.
- Do we treat `.arch/**/*.md` as specs? Probably not — those are *outputs* of the documentation workflow, not human-authored intent. Excluded by default; opt-in via config.
- Should we support cross-spec references (`@spec(memo/design/02_folder_view.md)`)? Useful but not v1.
- What happens when a glob matches zero files at index time? `glob-empty` drift warning. Don't fail — the spec might describe code not yet written, which is exactly the case `llmem specs lint` should *not* block.
