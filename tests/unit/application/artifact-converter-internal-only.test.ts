// tests/unit/application/artifact-converter-internal-only.test.ts
//
// Loop 03 — `internalOnly` option of artifactToEdgeList.
//
// By DEFAULT (no options / internalOnly omitted) the converter keeps its
// historical behavior: an external-module import produces an external module
// node + an external import edge. With `{ internalOnly: true }` the external
// branch is skipped entirely — no external node, no external import edge — but
// internal (workspace file→file) import edges are still emitted.
//
// GRAMMAR-FREE: we hand-build FileArtifacts (mirroring the sibling
// resolve-import-target test) so no tree-sitter grammar is required.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { artifactToEdgeList } from '../../../src/application/artifact-converter';
import { isExternalModuleId } from '../../../src/core/ids';
import type { FileArtifact, Loc, ImportSpec } from '../../../src/parser/types';

const LOC: Loc = {
    startByte: 0,
    endByte: 0,
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
};

function importSpec(source: string, names: string[]): ImportSpec {
    return {
        kind: 'es',
        source,
        resolvedPath: null,
        specifiers: names.map((name) => ({ name })),
        typeOnly: false,
        loc: LOC,
    };
}

function artifact(fileId: string, imports: ImportSpec[]): FileArtifact {
    return {
        schemaVersion: 'python-ts-v1',
        file: { id: fileId, path: fileId, language: 'typescript' },
        imports,
        exports: [],
        entities: [],
    };
}

// Importer at src/feature/a.ts with one EXTERNAL import (`react`) and one
// INTERNAL relative import (`./sibling`).
const importerId = 'src/feature/a.ts';
function fixture(): FileArtifact {
    return artifact(importerId, [
        importSpec('react', ['useState']),
        importSpec('./sibling', ['helper']),
    ]);
}

const INTERNAL_TARGET = 'src/feature/sibling.ts';

describe('artifactToEdgeList — internalOnly option', () => {
    test('default (no options): external import edge + external module node present, internal edge present', () => {
        const { nodes, importEdges } = artifactToEdgeList(fixture(), importerId);

        // External module node `react` exists.
        const reactNode = nodes.find((n) => n.id === 'react');
        assert.ok(reactNode, 'expected external `react` module node by default');

        // External import edge to `react` exists.
        const externalEdge = importEdges.find((e) => e.target === 'react');
        assert.ok(externalEdge, 'expected external import edge to react by default');
        assert.ok(isExternalModuleId(externalEdge!.target));

        // Internal import edge still present.
        const internalEdge = importEdges.find((e) => e.target === INTERNAL_TARGET);
        assert.ok(internalEdge, `expected internal edge to ${INTERNAL_TARGET}`);
    });

    test('{ internalOnly: true }: NO external import edge, NO external module node, internal edge still present', () => {
        const { nodes, importEdges } = artifactToEdgeList(fixture(), importerId, {
            internalOnly: true,
        });

        // No external module node.
        assert.equal(
            nodes.some((n) => n.id === 'react'),
            false,
            'external `react` node must NOT be created in internal-only mode',
        );

        // No external import edge.
        assert.equal(
            importEdges.some((e) => e.target === 'react'),
            false,
            'external import edge must NOT be emitted in internal-only mode',
        );

        // No edge target should be an external module id at all.
        assert.ok(
            importEdges.every((e) => !isExternalModuleId(e.target)),
            `no external-shaped import edge expected; got: ${importEdges.map((e) => e.target).join(', ')}`,
        );

        // Internal import edge IS still present.
        const internalEdge = importEdges.find((e) => e.target === INTERNAL_TARGET);
        assert.ok(
            internalEdge,
            `internal edge to ${INTERNAL_TARGET} must survive; got: ${importEdges.map((e) => e.target).join(', ')}`,
        );
        assert.equal(importEdges.length, 1, 'exactly one (internal) import edge in internal-only mode');
    });

    test('{ internalOnly: false } is explicit back-compat — externals included', () => {
        const { nodes, importEdges } = artifactToEdgeList(fixture(), importerId, {
            internalOnly: false,
        });
        assert.ok(nodes.some((n) => n.id === 'react'), 'external node present when internalOnly=false');
        assert.ok(importEdges.some((e) => e.target === 'react'), 'external edge present when internalOnly=false');
    });
});

describe('artifactToEdgeList — root-level files (regression, 2026-07-13 bug 1.1)', () => {
    // A file at the repo ROOT has no '/' in its id. Its relative imports
    // resolve to slashless ids too (`./b` from `a.ts` → `b.ts`), which the
    // old classifier mistook for external modules — so internal-only scans
    // dropped EVERY import edge of a flat repo (0 edges for a real a<->b
    // cycle). The extension-aware classifier keeps them internal.
    test('root importer + root target: internal edge survives internalOnly', () => {
        const rootArtifact = artifact('a.ts', [importSpec('./b', ['helper'])]);

        const { importEdges } = artifactToEdgeList(rootArtifact, 'a.ts', {
            internalOnly: true,
        });

        assert.equal(
            importEdges.length,
            1,
            `expected exactly one internal edge; got: ${importEdges.map((e) => e.target).join(', ') || '(none)'}`,
        );
        assert.equal(importEdges[0].source, 'a.ts');
        assert.equal(importEdges[0].target, 'b.ts');
    });

    test('root importer + bare external specifier: still dropped in internalOnly', () => {
        const rootArtifact = artifact('a.ts', [importSpec('react', ['useState'])]);

        const { importEdges } = artifactToEdgeList(rootArtifact, 'a.ts', {
            internalOnly: true,
        });

        assert.equal(importEdges.length, 0, 'bare specifier must remain external');
    });
});
