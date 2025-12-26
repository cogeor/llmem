/**
 * Test absolute Python imports with dot notation
 * Verifies that workspace imports are converted to file paths
 */

import * as path from 'path';
import * as fs from 'fs';

async function main() {
    console.log('=== Testing Absolute Python Imports ===\n');

    // Create a test Python file with absolute imports
    const testContent = `"""Test file with absolute imports"""
from src.db.models import ticker
from src.db.repositories.ticker_repo import TickerRepository
import json
import pathlib
from pathlib import Path

def main():
    repo = TickerRepository()
    data = json.loads('{}')
    p = Path('.')
`;

    const testFile = path.join(__dirname, 'fixtures/absolute_test.py');
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

        const { nodes, importEdges, callEdges } = artifactToEdgeList(artifact, 'test/fixtures/absolute_test.py');

        console.log('--- Import Edges Created ---');
        console.log(`Total import edges: ${importEdges.length}\n`);

        // Group by type
        const workspaceImports = importEdges.filter(e => e.target.includes('/') && e.target.endsWith('.py'));
        const externalImports = importEdges.filter(e => !e.target.includes('/') && !e.target.endsWith('.py'));

        console.log(`Workspace imports (${workspaceImports.length}):`);
        workspaceImports.forEach(e => {
            console.log(`  ${e.source} → ${e.target}`);
        });

        console.log(`\nExternal imports (${externalImports.length}):`);
        externalImports.forEach(e => {
            console.log(`  ${e.source} → ${e.target}`);
        });

        console.log('\n--- Verification ---');

        // Check that workspace imports have correct format
        const srcDbModels = importEdges.find(e => e.target === 'src/db/models.py' || e.target === 'src/db/models/ticker.py');
        console.log(`✓ Workspace import (src.db.models): ${srcDbModels ? 'CORRECT FORMAT (src/db/models.py or src/db/models/ticker.py)' : 'WRONG FORMAT'}`);

        const srcDbRepo = importEdges.find(e => e.target === 'src/db/repositories/ticker_repo.py');
        console.log(`✓ Workspace import (src.db.repositories.ticker_repo): ${srcDbRepo ? 'CORRECT FORMAT (src/db/repositories/ticker_repo.py)' : 'WRONG FORMAT'}`);

        // Check that external imports stay as module names
        const jsonImport = importEdges.find(e => e.target === 'json');
        console.log(`✓ External import (json): ${jsonImport ? 'CORRECT (json)' : 'WRONG FORMAT'}`);

        const pathlibImport = importEdges.find(e => e.target === 'pathlib');
        console.log(`✓ External import (pathlib): ${pathlibImport ? 'CORRECT (pathlib)' : 'WRONG FORMAT'}`);

        // Check for incorrect dot notation
        const dotNotationImports = importEdges.filter(e => e.target.includes('.') && !e.target.endsWith('.py'));
        if (dotNotationImports.length > 0) {
            console.log(`\n❌ Found imports with dot notation (should be file paths):`);
            dotNotationImports.forEach(e => {
                console.log(`  ${e.source} → ${e.target} (WRONG - should be file path with .py)`);
            });
        }

        console.log('\n=== Test Complete ===');

        // Verify all checks passed
        const hasSrcDbModels = !!srcDbModels;
        const hasSrcDbRepo = !!srcDbRepo;
        const hasJsonImport = !!jsonImport;
        const hasPathlibImport = !!pathlibImport;
        const noDotNotation = dotNotationImports.length === 0;

        if (!hasSrcDbModels || !hasSrcDbRepo || !hasJsonImport || !hasPathlibImport || !noDotNotation) {
            console.error('\n❌ Some verifications failed!');
            process.exit(1);
        }

        console.log('\n✅ All verifications passed!');

    } finally {
        // Clean up test file
        fs.unlinkSync(testFile);
    }
}

main();
