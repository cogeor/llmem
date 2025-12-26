/**
 * Test relative Python imports with leading dots
 * Verifies that dots are properly handled (not kept in paths)
 */

import * as path from 'path';
import * as fs from 'fs';

async function main() {
    console.log('=== Testing Relative Python Imports ===\n');

    // Create test directory structure
    const testDir = path.join(__dirname, 'fixtures/relative_test');
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }

    // Create test files with relative imports
    const testContent = `"""Test file with relative imports"""
from .helper import process
from .utils.formatter import format_data
from ..parent_module import ParentClass
from . import shared

def main():
    process()
    format_data()
`;

    const testFile = path.join(testDir, 'module.py');
    fs.writeFileSync(testFile, testContent);

    try {
        const { PythonExtractor } = await import('../src/parser/python');
        const { artifactToEdgeList } = await import('../src/graph/artifact-converter');

        const extractor = new PythonExtractor(path.join(__dirname, '..'));
        const artifact = await extractor.extract(testFile);

        if (!artifact) {
            console.error('Failed to extract artifact');
            process.exit(1);
        }

        const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, 'test/fixtures/relative_test/module.py');

        console.log('--- Import Edges Created ---');
        console.log(`Total import edges: ${importEdges.length}\n`);

        importEdges.forEach(e => {
            console.log(`  ${e.source} → ${e.target}`);
        });

        console.log('\n--- Verification ---');

        // Check that dots are NOT in the target paths (except file extensions)
        const dotsInPaths = importEdges.filter(e => {
            // Remove file extension, then check for dots
            const withoutExt = e.target.replace(/\.[^.]+$/, '');
            return withoutExt.includes('.');
        });

        if (dotsInPaths.length > 0) {
            console.log('❌ Found dots in import paths (should be removed):');
            dotsInPaths.forEach(e => {
                console.log(`  ${e.target} (WRONG - contains dots)`);
            });
        } else {
            console.log('✓ No dots in import paths (correct)');
        }

        // Check specific cases
        const helperImport = importEdges.find(e =>
            e.target === 'test/fixtures/relative_test/helper.py'
        );
        console.log(`✓ Same folder import (.helper): ${helperImport ? 'CORRECT (test/fixtures/relative_test/helper.py)' : 'WRONG'}`);

        const utilsImport = importEdges.find(e =>
            e.target === 'test/fixtures/relative_test/utils/formatter.py'
        );
        console.log(`✓ Nested import (.utils.formatter): ${utilsImport ? 'CORRECT (test/fixtures/relative_test/utils/formatter.py)' : 'WRONG'}`);

        const parentImport = importEdges.find(e =>
            e.target === 'test/fixtures/parent_module.py'
        );
        console.log(`✓ Parent folder import (..parent_module): ${parentImport ? 'CORRECT (test/fixtures/parent_module.py)' : 'WRONG'}`);

        const packageImport = importEdges.find(e =>
            e.target === 'test/fixtures/relative_test.py' ||
            e.target === 'test/fixtures/relative_test/__init__.py'
        );
        console.log(`✓ Package import (. import): ${packageImport ? 'CORRECT' : 'WRONG'}`);

        console.log('\n=== Test Complete ===');

        // Verify all checks passed
        const allCorrect = dotsInPaths.length === 0 && helperImport && utilsImport && parentImport;

        if (!allCorrect) {
            console.error('\n❌ Some verifications failed!');
            process.exit(1);
        }

        console.log('\n✅ All verifications passed!');

    } finally {
        // Clean up test files
        if (fs.existsSync(testFile)) {
            fs.unlinkSync(testFile);
        }
        if (fs.existsSync(testDir)) {
            fs.rmdirSync(testDir);
        }
    }
}

main();
