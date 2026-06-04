// tests/unit/graph/python-from-import-call.test.ts
//
// Loop PC-07 — cross-file relative-import resolution (§8 from-import case).
//
// Validates tier-2 of the language-agnostic call resolver in
// artifact-converter.ts: a module that does `from .util import f` and then
// calls `f()` must produce a call edge into the `util` file's `f` entity.
//
// This is GRAMMAR-FREE: we hand-build the FileArtifact for `pkg/mod.py`
// (carrying the relative ImportSpec for `.util` + a caller entity whose calls
// include calleeName 'f') and the target artifact `pkg/util.py` (defining `f`),
// then run them through artifactToEdgeList and assert the call edge targets
// makeEntityId('pkg/util.py', 'f'). No tree-sitter-python required.
//
// The relative-import dot-counting under test lives in resolveImportTarget
// (~141-185): `.util` from `pkg/mod.py` -> `pkg/util.py` (same-dir, one dot).
// `..pkg.mod` -> parent-dir, dotted module path. Both are covered below.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { artifactsToEdgeList } from '../../../src/application/artifact-converter';
import { makeEntityId } from '../../../src/core/ids';
import type { FileArtifact, Loc, ImportSpec, Entity } from '../../../src/parser/types';

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
        loc: LOC,
    };
}

function entity(name: string, calls: Entity['calls'] = []): Entity {
    return {
        id: `${name}-0`,
        kind: 'function',
        name,
        isExported: true,
        loc: LOC,
        calls,
    };
}

function artifact(fileId: string, imports: ImportSpec[], entities: Entity[]): FileArtifact {
    return {
        schemaVersion: 'python-ts-v1',
        file: { id: fileId, path: fileId, language: 'python' },
        imports,
        exports: [],
        entities,
    };
}

describe('PC-07 cross-file from-import call resolution (tier-2)', () => {
    test('`from .util import f` then `f()` -> call edge into pkg/util.py::f', () => {
        const modFileId = 'pkg/mod.py';
        const utilFileId = 'pkg/util.py';

        const modArtifact = artifact(
            modFileId,
            [importSpec('.util', ['f'])],
            [
                entity('caller', [
                    { callSiteId: 'f@0', kind: 'function', calleeName: 'f', loc: LOC },
                ]),
            ],
        );
        const utilArtifact = artifact(utilFileId, [], [entity('f')]);

        const { callEdges } = artifactsToEdgeList([
            { fileId: modFileId, artifact: modArtifact },
            { fileId: utilFileId, artifact: utilArtifact },
        ]);

        const expectedSource = makeEntityId(modFileId, 'caller');
        const expectedTarget = makeEntityId(utilFileId, 'f');
        const edge = callEdges.find(
            (e) => e.source === expectedSource && e.target === expectedTarget,
        );
        assert.ok(
            edge,
            `expected tier-2 call edge ${expectedSource} -> ${expectedTarget}; got: ${callEdges
                .map((e) => `${e.source}->${e.target}`)
                .join(', ')}`,
        );
    });

    test('`from ..pkg.mod import g` then `g()` -> call edge into pkg/mod.py::g (parent-dir dotted path)', () => {
        // Caller lives at pkg/sub/leaf.py; `..pkg.mod` climbs one level
        // (pkg/) then descends pkg/mod -> pkg/mod.py.
        const leafFileId = 'pkg/sub/leaf.py';
        const targetFileId = 'pkg/pkg/mod.py';

        const leafArtifact = artifact(
            leafFileId,
            [importSpec('..pkg.mod', ['g'])],
            [
                entity('caller', [
                    { callSiteId: 'g@0', kind: 'function', calleeName: 'g', loc: LOC },
                ]),
            ],
        );
        const targetArtifact = artifact(targetFileId, [], [entity('g')]);

        const { callEdges } = artifactsToEdgeList([
            { fileId: leafFileId, artifact: leafArtifact },
            { fileId: targetFileId, artifact: targetArtifact },
        ]);

        const expectedSource = makeEntityId(leafFileId, 'caller');
        const expectedTarget = makeEntityId(targetFileId, 'g');
        const edge = callEdges.find(
            (e) => e.source === expectedSource && e.target === expectedTarget,
        );
        assert.ok(
            edge,
            `expected tier-2 call edge ${expectedSource} -> ${expectedTarget}; got: ${callEdges
                .map((e) => `${e.source}->${e.target}`)
                .join(', ')}`,
        );
    });

    test('aliased from-import `from .util import f as g` then `g()` resolves to pkg/util.py::f', () => {
        // Local name is the alias (g); the edge must target the ORIGINAL
        // export name (f) in the util file — tier-2 matches spec.alias for the
        // callee but keys makeEntityId on spec.name.
        const modFileId = 'pkg/mod.py';
        const utilFileId = 'pkg/util.py';

        const aliasedImport: ImportSpec = {
            kind: 'es',
            source: '.util',
            resolvedPath: null,
            specifiers: [{ name: 'f', alias: 'g' }],
            loc: LOC,
        };

        const modArtifact = artifact(
            modFileId,
            [aliasedImport],
            [
                entity('caller', [
                    { callSiteId: 'g@0', kind: 'function', calleeName: 'g', loc: LOC },
                ]),
            ],
        );
        const utilArtifact = artifact(utilFileId, [], [entity('f')]);

        const { callEdges } = artifactsToEdgeList([
            { fileId: modFileId, artifact: modArtifact },
            { fileId: utilFileId, artifact: utilArtifact },
        ]);

        const edge = callEdges.find(
            (e) =>
                e.source === makeEntityId(modFileId, 'caller') &&
                e.target === makeEntityId(utilFileId, 'f'),
        );
        assert.ok(edge, 'aliased from-import resolves to the original export name in util.py');
    });
});
