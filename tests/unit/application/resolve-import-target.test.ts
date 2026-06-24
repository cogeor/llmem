// tests/unit/application/resolve-import-target.test.ts
//
// Covers the absolute / workspace import branch of resolveImportTarget
// (exercised indirectly through artifactToEdgeList's import-edge construction).
//
// The resolver is pure: for an absolute dotted import it anchors the module at
// the importing file's own source root by locating the import's top segment as
// a DIRECTORY segment of the importer's path. Internal targets become repo-
// relative file paths (with a '/'); externals stay bare module ids that
// isExternalModuleId() classifies as external.
//
// GRAMMAR-FREE: we hand-build FileArtifacts (mirroring
// tests/unit/graph/python-from-import-call.test.ts) so tree-sitter-python is
// not required.

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
        file: { id: fileId, path: fileId, language: 'python' },
        imports,
        exports: [],
        entities: [],
    };
}

describe('resolveImportTarget — absolute import anchoring at importer source root', () => {
    const importerId = 'src/pkg/sub/a.py';

    test('`from pkg.b import x` anchors at src/ → src/pkg/b.py', () => {
        const { importEdges } = artifactToEdgeList(
            artifact(importerId, [importSpec('pkg.b', ['x'])]),
            importerId,
        );
        const edge = importEdges.find((e) => e.target === 'src/pkg/b.py');
        assert.ok(
            edge,
            `expected internal edge to src/pkg/b.py; got: ${importEdges.map((e) => e.target).join(', ')}`,
        );
    });

    test('`from pkg.sub.c import x` → src/pkg/sub/c.py', () => {
        const { importEdges } = artifactToEdgeList(
            artifact(importerId, [importSpec('pkg.sub.c', ['x'])]),
            importerId,
        );
        const edge = importEdges.find((e) => e.target === 'src/pkg/sub/c.py');
        assert.ok(
            edge,
            `expected internal edge to src/pkg/sub/c.py; got: ${importEdges.map((e) => e.target).join(', ')}`,
        );
    });

    test('relative `from . import sibling` still → src/pkg/sub/sibling.py (regression guard)', () => {
        const { importEdges } = artifactToEdgeList(
            artifact(importerId, [importSpec('.sibling', ['x'])]),
            importerId,
        );
        const edge = importEdges.find((e) => e.target === 'src/pkg/sub/sibling.py');
        assert.ok(
            edge,
            `expected relative edge to src/pkg/sub/sibling.py; got: ${importEdges.map((e) => e.target).join(', ')}`,
        );
    });

    test('`from sqlalchemy.ext.asyncio import X` → external (not a src/ path)', () => {
        const { importEdges } = artifactToEdgeList(
            artifact(importerId, [importSpec('sqlalchemy.ext.asyncio', ['X'])]),
            importerId,
        );
        // Exactly one import edge, and its target is an external module id.
        assert.equal(importEdges.length, 1, 'expected a single import edge');
        const target = importEdges[0].target;
        assert.ok(
            isExternalModuleId(target),
            `expected external module id, got internal-looking target: ${target}`,
        );
        assert.ok(
            !/^src\/.*\.py$/.test(target),
            `external target must not be a src/...py path, got: ${target}`,
        );
        assert.equal(target, 'sqlalchemy', 'external multi-segment pkg collapses to top segment');
    });
});
