/**
 * Python imports integration test (Loop 17 merge).
 *
 * Combines what was previously three free-standing scripts under
 * `test/test-{absolute,relative,external}-imports.ts`. Each script tested a
 * different facet of the Python import resolver; together they exercise the
 * three contracts:
 *
 *   1. Absolute, dot-notation workspace imports get rewritten to file paths
 *      (e.g. `from src.db.models import x` -> `src/db/models.py`).
 *   2. Relative imports (leading `.` / `..`) collapse to file paths without
 *      retaining the dots in the resolved target.
 *   3. External modules become first-class graph nodes (Loop 16
 *      `ExternalModuleNode` shape: `kind: 'external'` at runtime via
 *      `parseGraphId`).
 *
 * The fixture for the third describe block lives at
 * `tests/fixtures/python/sample.py` (moved from `test/fixtures/sample.py`
 * in Loop 17). The first two describe blocks build their own inline fixtures
 * because the assertions are about resolution paths, which depend on where
 * the fixture is rooted.
 */

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { PythonExtractor } from '../../src/parser/python';
import { artifactToEdgeList } from '../../src/graph/artifact-converter';
import { parseGraphId } from '../../src/core/ids';

// Skip the whole file when the optional `tree-sitter-python` peer dep isn't
// installed. The Python extractor lazily requires it inside its constructor
// (so the rest of the codebase can import the parser registry without
// forcing tree-sitter-python). When absent the suite would otherwise fail
// with `Cannot find module 'tree-sitter-python'`. We probe once here and
// pass the result to every `describe` block as `{ skip }`.
function probePythonExtractor(): string | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('tree-sitter-python');
        return undefined;
    } catch {
        return 'tree-sitter-python not installed (optional peer dependency)';
    }
}

const SKIP_REASON = probePythonExtractor();

// -----------------------------------------------------------------------------
// Block 1: absolute (dot-notation) imports -> file paths
// -----------------------------------------------------------------------------

describe('python imports — absolute', { skip: SKIP_REASON }, () => {
    let workspaceRoot: string;
    let testFile: string;

    before(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-py-abs-'));
        const fixturesDir = path.join(workspaceRoot, 'fixtures');
        fs.mkdirSync(fixturesDir, { recursive: true });
        testFile = path.join(fixturesDir, 'absolute_test.py');
        fs.writeFileSync(testFile, [
            '"""Test file with absolute imports"""',
            'from src.db.models import ticker',
            'from src.db.repositories.ticker_repo import TickerRepository',
            'import json',
            'import pathlib',
            'from pathlib import Path',
            '',
            'def main():',
            '    repo = TickerRepository()',
            '    data = json.loads("{}")',
            '    p = Path(".")',
            '',
        ].join('\n'));
    });

    after(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test('workspace imports resolve to file paths and externals stay bare', async () => {
        const extractor = new PythonExtractor(workspaceRoot);
        const artifact = await extractor.extract(testFile);
        assert.ok(artifact, 'Python extractor returned an artifact');

        const fileId = 'fixtures/absolute_test.py';
        const { importEdges } = artifactToEdgeList(artifact!, fileId);

        // Workspace imports: `src.db.models` -> some `src/db/models{.py,/ticker.py,/__init__.py}`.
        const srcDbModels = importEdges.find((e) =>
            e.target === 'src/db/models.py' ||
            e.target === 'src/db/models/ticker.py' ||
            e.target === 'src/db/models/__init__.py',
        );
        assert.ok(
            srcDbModels,
            `Expected workspace import for src.db.models in: ${importEdges.map((e) => e.target).join(', ')}`,
        );

        const srcDbRepo = importEdges.find((e) =>
            e.target === 'src/db/repositories/ticker_repo.py',
        );
        assert.ok(srcDbRepo, 'Expected workspace import to src/db/repositories/ticker_repo.py');

        // External imports stay bare module specifiers.
        const jsonImport = importEdges.find((e) => e.target === 'json');
        assert.ok(jsonImport, 'Expected external import for json');

        const pathlibImport = importEdges.find((e) => e.target === 'pathlib');
        assert.ok(pathlibImport, 'Expected external import for pathlib');

        // No edge target should be a Python dot-notation specifier (the
        // resolver must rewrite them or leave them as bare external module
        // names — never a half-resolved `src.db.models`).
        const dotNotation = importEdges.filter((e) => {
            const withoutExt = e.target.replace(/\.[^.]+$/, '');
            return withoutExt.includes('.');
        });
        assert.equal(
            dotNotation.length,
            0,
            `Found dot-notation import targets: ${dotNotation.map((e) => e.target).join(', ')}`,
        );
    });
});

// -----------------------------------------------------------------------------
// Block 2: relative imports (leading dots) -> file paths
// -----------------------------------------------------------------------------

describe('python imports — relative', { skip: SKIP_REASON }, () => {
    let workspaceRoot: string;
    let testDir: string;
    let testFile: string;

    before(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-py-rel-'));
        // Layout (relative to workspaceRoot):
        //   fixtures/parent_module.py            (target of `from ..parent_module`)
        //   fixtures/relative_test/module.py     (the file under test)
        //   fixtures/relative_test/helper.py     (target of `from .helper`)
        //   fixtures/relative_test/utils/formatter.py (target of `from .utils.formatter`)
        const fixturesDir = path.join(workspaceRoot, 'fixtures');
        testDir = path.join(fixturesDir, 'relative_test');
        const utilsDir = path.join(testDir, 'utils');
        fs.mkdirSync(utilsDir, { recursive: true });

        testFile = path.join(testDir, 'module.py');
        fs.writeFileSync(testFile, [
            '"""Test file with relative imports"""',
            'from .helper import process',
            'from .utils.formatter import format_data',
            'from ..parent_module import ParentClass',
            'from . import shared',
            '',
            'def main():',
            '    process()',
            '    format_data()',
            '',
        ].join('\n'));
    });

    after(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test('relative imports resolve into file paths without dot-notation', async () => {
        const extractor = new PythonExtractor(workspaceRoot);
        const artifact = await extractor.extract(testFile);
        assert.ok(artifact, 'Python extractor returned an artifact');

        const fileId = 'fixtures/relative_test/module.py';
        const { importEdges } = artifactToEdgeList(artifact!, fileId);

        // No edge target should retain a `.foo` Python module path. We strip
        // file extensions before scanning so `.py` itself is fine.
        const dotsInPaths = importEdges.filter((e) => {
            const withoutExt = e.target.replace(/\.[^.]+$/, '');
            return withoutExt.includes('.');
        });
        assert.equal(
            dotsInPaths.length,
            0,
            `Found dot-notation import targets: ${dotsInPaths.map((e) => e.target).join(', ')}`,
        );

        // Sibling import: .helper -> fixtures/relative_test/helper.py
        const helperImport = importEdges.find((e) =>
            e.target === 'fixtures/relative_test/helper.py',
        );
        assert.ok(helperImport, 'Expected import for .helper to resolve to fixtures/relative_test/helper.py');

        // Nested import: .utils.formatter -> fixtures/relative_test/utils/formatter.py
        const utilsImport = importEdges.find((e) =>
            e.target === 'fixtures/relative_test/utils/formatter.py',
        );
        assert.ok(
            utilsImport,
            'Expected import for .utils.formatter to resolve to fixtures/relative_test/utils/formatter.py',
        );

        // Parent-folder import: ..parent_module -> fixtures/parent_module.py
        const parentImport = importEdges.find((e) =>
            e.target === 'fixtures/parent_module.py',
        );
        assert.ok(parentImport, 'Expected import for ..parent_module to resolve to fixtures/parent_module.py');
    });
});

// -----------------------------------------------------------------------------
// Block 3: external module nodes (Loop 16 ExternalModuleNode)
// -----------------------------------------------------------------------------

describe('python imports — external modules', { skip: SKIP_REASON }, () => {
    const FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'python', 'sample.py');
    // The sample fixture lives under tests/fixtures/python/. Use that
    // directory as the workspace root so the relative file IDs are stable.
    const workspaceRoot = path.resolve(__dirname, '..', 'fixtures', 'python');

    test('imports of pathlib produce an external module node and call edges', async () => {
        const extractor = new PythonExtractor(workspaceRoot);
        const artifact = await extractor.extract(FIXTURE);
        assert.ok(artifact, 'Python extractor returned an artifact');

        const fileId = 'sample.py';
        const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact!, fileId);

        // pathlib should appear as an external module: a top-level node with
        // id === 'pathlib' AND parseGraphId returns kind 'external'.
        const pathlibNode = nodes.find((n) => n.id === 'pathlib');
        assert.ok(pathlibNode, 'Expected node with id "pathlib"');
        assert.equal(parseGraphId(pathlibNode!.id).kind, 'external');

        // pathlib::Path should appear as a class entity hanging off pathlib.
        const pathClassNode = nodes.find((n) => n.id === 'pathlib::Path');
        assert.ok(pathClassNode, 'Expected node with id "pathlib::Path"');
        // The entity ID kind: parseGraphId on `pathlib::Path` returns
        // `entity` with fileId === 'pathlib'. We assert that the fileId
        // itself is an external module (delegating to parseGraphId).
        const parsed = parseGraphId(pathClassNode!.id);
        assert.equal(parsed.kind, 'entity');
        if (parsed.kind === 'entity') {
            assert.equal(parseGraphId(parsed.fileId).kind, 'external');
        }

        // Import edge: sample.py -> pathlib.
        const pathlibImport = importEdges.find((e) =>
            e.source === 'sample.py' && e.target === 'pathlib',
        );
        assert.ok(pathlibImport, 'Expected import edge sample.py -> pathlib');

        // Call edge: main calls pathlib::Path.
        const pathCall = callEdges.find((e) =>
            e.source.includes('main') && e.target === 'pathlib::Path',
        );
        assert.ok(pathCall, 'Expected call edge from main to pathlib::Path');
    });
});
