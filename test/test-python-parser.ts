/**
 * Test script for Python parser
 * Run with: npx ts-node test/test-python-parser.ts
 */

import * as path from 'path';
import { PythonExtractor } from '../src/parser/python';

async function main() {
    const testFile = path.join(__dirname, 'fixtures/sample.py');
    const extractor = new PythonExtractor(path.join(__dirname, '..'));

    console.log('=== Testing Python Parser ===\n');
    console.log(`Parsing: ${testFile}\n`);

    try {
        const result = await extractor.extract(testFile);

        if (!result) {
            console.error('Failed to extract file');
            process.exit(1);
        }

        console.log('--- File Info ---');
        console.log(`  ID: ${result.file.id}`);
        console.log(`  Language: ${result.file.language}`);

        console.log('\n--- Imports ---');
        for (const imp of result.imports) {
            const specs = imp.specifiers.map(s => s.alias ? `${s.name} as ${s.alias}` : s.name).join(', ');
            console.log(`  from "${imp.source}" import ${specs}`);
        }

        console.log('\n--- Entities ---');
        for (const entity of result.entities) {
            const exported = entity.isExported ? '(exported)' : '(private)';
            console.log(`\n  [${entity.kind}] ${entity.name} ${exported}`);
            console.log(`    Signature: ${entity.signature}`);
            console.log(`    Location: line ${entity.loc.startLine}-${entity.loc.endLine}`);

            if (entity.calls && entity.calls.length > 0) {
                console.log(`    Calls (${entity.calls.length}):`);
                for (const call of entity.calls) {
                    const resolved = call.resolvedDefinition
                        ? `→ ${call.resolvedDefinition.file}:${call.resolvedDefinition.name}`
                        : '→ (unresolved)';
                    console.log(`      - ${call.calleeName} ${resolved}`);
                }
            }
        }

        console.log('\n--- Exports ---');
        for (const exp of result.exports) {
            console.log(`  ${exp.name}`);
        }

        console.log('\n=== Summary ===');
        console.log(`  Imports: ${result.imports.length}`);
        console.log(`  Entities: ${result.entities.length}`);
        console.log(`  - Functions: ${result.entities.filter(e => e.kind === 'function').length}`);
        console.log(`  - Classes: ${result.entities.filter(e => e.kind === 'class').length}`);
        console.log(`  - Methods: ${result.entities.filter(e => e.kind === 'method').length}`);
        console.log(`  Exports: ${result.exports.length}`);

        const totalCalls = result.entities.reduce((sum, e) => sum + (e.calls?.length || 0), 0);
        console.log(`  Total Calls: ${totalCalls}`);

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
