/**
 * Parser System Integration Tests
 *
 * Tests the parser registry, TypeScript extraction, and multi-language support.
 */

import { strict as assert } from 'assert';
import { test, describe, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { TypeScriptService } from './ts-service';
import { TypeScriptExtractor } from './ts-extractor';
import { ParserRegistry } from './registry';
import { isSupportedExtension, isSupportedFile, getLanguageFromPath } from './config';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestWorkspace {
    root: string;
    cleanup: () => void;
}

function createTestWorkspace(): TestWorkspace {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmem-parser-test-'));

    // Create src directory
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create a TypeScript file with various constructs
    fs.writeFileSync(path.join(srcDir, 'example.ts'), `
/**
 * Example module demonstrating various TypeScript constructs
 */

import * as fs from 'fs';
import { join, resolve } from 'path';

// Constants
export const VERSION = '1.0.0';
export const MAX_SIZE = 1024;

// Type definitions
export interface Config {
    name: string;
    enabled: boolean;
}

export type Handler = (data: unknown) => void;

// Regular function
export function processData(input: string): string {
    return input.toUpperCase();
}

// Arrow function assigned to const
export const formatOutput = (data: string): string => {
    return \`[OUTPUT] \${data}\`;
};

// Async function
export async function fetchData(url: string): Promise<string> {
    return url;
}

// Class with methods
export class DataProcessor {
    private cache: Map<string, string> = new Map();

    constructor(private config: Config) {}

    process(input: string): string {
        const result = processData(input);
        this.cache.set(input, result);
        return result;
    }

    async processAsync(input: string): Promise<string> {
        const data = await fetchData(input);
        return formatOutput(data);
    }

    static create(name: string): DataProcessor {
        return new DataProcessor({ name, enabled: true });
    }
}

// Function that calls other functions
export function main(): void {
    const processor = DataProcessor.create('test');
    const result = processor.process('hello');
    console.log(formatOutput(result));
}
`.trim());

    // Create a JavaScript file
    fs.writeFileSync(path.join(srcDir, 'legacy.js'), `
/**
 * Legacy JavaScript module
 */

const utils = require('./utils');

function legacyProcess(data) {
    return utils.format(data);
}

module.exports = { legacyProcess };
`.trim());

    // Create tsconfig.json
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            allowJs: true,
            outDir: './dist'
        },
        include: ['src/**/*']
    }, null, 2));

    return {
        root,
        cleanup: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

// ============================================================================
// Config Tests
// ============================================================================

describe('Parser Configuration', () => {
    test('isSupportedExtension returns true for TypeScript', () => {
        assert.equal(isSupportedExtension('.ts'), true);
        assert.equal(isSupportedExtension('.tsx'), true);
        assert.equal(isSupportedExtension('.js'), true);
        assert.equal(isSupportedExtension('.jsx'), true);
    });

    test('isSupportedExtension returns true for tree-sitter languages', () => {
        assert.equal(isSupportedExtension('.py'), true);
        assert.equal(isSupportedExtension('.rs'), true);
        assert.equal(isSupportedExtension('.cpp'), true);
        assert.equal(isSupportedExtension('.c'), true);
        assert.equal(isSupportedExtension('.R'), true);
    });

    test('isSupportedExtension returns false for unsupported', () => {
        assert.equal(isSupportedExtension('.txt'), false);
        assert.equal(isSupportedExtension('.md'), false);
        assert.equal(isSupportedExtension('.json'), false);
    });

    test('isSupportedFile works with filenames', () => {
        assert.equal(isSupportedFile('example.ts'), true);
        assert.equal(isSupportedFile('script.py'), true);
        assert.equal(isSupportedFile('readme.md'), false);
    });

    test('getLanguageFromPath returns correct language', () => {
        assert.equal(getLanguageFromPath('src/file.ts'), 'typescript');
        assert.equal(getLanguageFromPath('src/file.tsx'), 'typescript');
        assert.equal(getLanguageFromPath('src/file.js'), 'javascript');
        assert.equal(getLanguageFromPath('src/file.py'), 'python');
        assert.equal(getLanguageFromPath('src/file.rs'), 'rust');
        assert.equal(getLanguageFromPath('src/file.cpp'), 'cpp');
        assert.equal(getLanguageFromPath('src/file.R'), 'r');
    });
});

// ============================================================================
// TypeScript Service Tests
// ============================================================================

describe('TypeScriptService', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('creates TypeScript program from workspace', () => {
        const service = new TypeScriptService(workspace.root);
        const program = service.getProgram();

        assert.ok(program, 'Should create program');

        // Should include our source files
        const sourceFiles = program.getSourceFiles();
        const ourFiles = sourceFiles.filter(sf =>
            sf.fileName.includes('example.ts') || sf.fileName.includes('legacy.js')
        );

        assert.ok(ourFiles.length >= 1, 'Should include our source files');
    });

    test('program provides type checker', () => {
        const service = new TypeScriptService(workspace.root);
        const program = service.getProgram();
        assert.ok(program, 'Should have program');

        const checker = program.getTypeChecker();
        assert.ok(checker, 'Should provide type checker');
    });

    test('program gets source file by path', () => {
        const service = new TypeScriptService(workspace.root);
        const program = service.getProgram();
        assert.ok(program, 'Should have program');

        const examplePath = path.join(workspace.root, 'src', 'example.ts');
        const sourceFile = program.getSourceFile(examplePath);

        assert.ok(sourceFile, 'Should get source file');
        assert.ok(sourceFile.fileName.includes('example.ts'));
    });
});

// ============================================================================
// TypeScript Extractor Tests
// ============================================================================

describe('TypeScriptExtractor', () => {
    let workspace: TestWorkspace;
    let extractor: TypeScriptExtractor;

    before(() => {
        workspace = createTestWorkspace();
        const service = new TypeScriptService(workspace.root);
        extractor = new TypeScriptExtractor(() => service.getProgram(), workspace.root);
    });

    after(() => {
        workspace.cleanup();
    });

    test('extracts file artifact with correct metadata', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');
        assert.equal(artifact.file.language, 'typescript');
        assert.ok(artifact.file.path.includes('example.ts'));
    });

    test('extracts imports correctly', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');
        assert.ok(artifact.imports.length >= 2, 'Should have at least 2 imports');

        // Check fs import
        const fsImport = artifact.imports.find(i => i.source === 'fs');
        assert.ok(fsImport, 'Should have fs import');
        assert.equal(fsImport.kind, 'namespace'); // import * as fs

        // Check path import - specifiers are objects with name property
        const pathImport = artifact.imports.find(i => i.source === 'path');
        assert.ok(pathImport, 'Should have path import');
        const specifierNames = pathImport.specifiers.map(s => s.name);
        assert.ok(specifierNames.includes('join'), 'Should import join');
        assert.ok(specifierNames.includes('resolve'), 'Should import resolve');
    });

    test('extracts exports correctly', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');

        // Should have exports for VERSION, MAX_SIZE, Config, Handler, processData, etc.
        assert.ok(artifact.exports.length >= 5, 'Should have multiple exports');

        const versionExport = artifact.exports.find(e => e.name === 'VERSION');
        assert.ok(versionExport, 'Should export VERSION');

        const processDataExport = artifact.exports.find(e => e.name === 'processData');
        assert.ok(processDataExport, 'Should export processData');

        const dataProcessorExport = artifact.exports.find(e => e.name === 'DataProcessor');
        assert.ok(dataProcessorExport, 'Should export DataProcessor');
    });

    test('extracts entities with correct kinds', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');

        // Find specific entities
        const processDataFn = artifact.entities.find(e => e.name === 'processData');
        assert.ok(processDataFn, 'Should find processData function');
        assert.equal(processDataFn.kind, 'function');
        assert.ok(processDataFn.signature?.includes('string'), 'Signature should mention string');

        const formatOutputFn = artifact.entities.find(e => e.name === 'formatOutput');
        assert.ok(formatOutputFn, 'Should find formatOutput arrow function');
        assert.ok(['arrow', 'const'].includes(formatOutputFn.kind), 'Should be arrow or const');

        const fetchDataFn = artifact.entities.find(e => e.name === 'fetchData');
        assert.ok(fetchDataFn, 'Should find fetchData async function');
        assert.ok(fetchDataFn.signature?.includes('Promise'), 'Should have Promise return type');

        const dataProcessorClass = artifact.entities.find(e => e.name === 'DataProcessor');
        assert.ok(dataProcessorClass, 'Should find DataProcessor class');
        assert.equal(dataProcessorClass.kind, 'class');
    });

    test('extracts method entities from classes', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');

        // Methods should be extracted as separate entities
        const processMethods = artifact.entities.filter(e =>
            e.name === 'process' || e.name === 'processAsync' || e.name === 'create'
        );

        assert.ok(processMethods.length >= 1, 'Should extract class methods');
    });

    test('extracts call sites correctly', async () => {
        const filePath = path.join(workspace.root, 'src', 'example.ts');
        const artifact = await extractor.extract(filePath);

        assert.ok(artifact, 'Should extract artifact');

        // The main function calls DataProcessor.create, processor.process, formatOutput
        const mainFn = artifact.entities.find(e => e.name === 'main');
        assert.ok(mainFn, 'Should find main function');
        assert.ok(mainFn.calls && mainFn.calls.length >= 2, 'main should have multiple calls');

        // Check for specific calls
        const callNames = mainFn.calls!.map(c => c.calleeName);
        assert.ok(
            callNames.some(n => n.includes('formatOutput') || n.includes('process') || n.includes('create')),
            'Should call formatOutput, process, or create'
        );
    });
});

// ============================================================================
// Parser Registry Tests
// ============================================================================

describe('ParserRegistry', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('singleton instance', () => {
        const registry1 = ParserRegistry.getInstance();
        const registry2 = ParserRegistry.getInstance();

        assert.strictEqual(registry1, registry2, 'Should return same instance');
    });

    test('TypeScript adapter is always available', () => {
        const registry = ParserRegistry.getInstance();
        const tsPath = path.join(workspace.root, 'src', 'example.ts');

        assert.ok(registry.isSupported(tsPath), 'Should support .ts files');

        const parser = registry.getParser(tsPath, workspace.root);
        assert.ok(parser, 'Should return parser for .ts files');
    });

    test('JavaScript files are supported', () => {
        const registry = ParserRegistry.getInstance();
        const jsPath = path.join(workspace.root, 'src', 'legacy.js');

        assert.ok(registry.isSupported(jsPath), 'Should support .js files');
    });

    test('getLanguageId returns correct ID', () => {
        const registry = ParserRegistry.getInstance();

        assert.equal(registry.getLanguageId('file.ts'), 'typescript');
        assert.equal(registry.getLanguageId('file.js'), 'typescript'); // JS uses TS parser
        assert.equal(registry.getLanguageId('file.tsx'), 'typescript');
    });

    test('getSupportedExtensions returns array', () => {
        const registry = ParserRegistry.getInstance();
        const extensions = registry.getSupportedExtensions();

        assert.ok(Array.isArray(extensions));
        assert.ok(extensions.includes('.ts'));
        assert.ok(extensions.includes('.js'));
    });

    test('unsupported files return null parser', () => {
        const registry = ParserRegistry.getInstance();

        assert.ok(!registry.isSupported('readme.md'));
        assert.ok(!registry.isSupported('data.json'));

        const parser = registry.getParser('readme.md', workspace.root);
        assert.equal(parser, null);
    });
});

// ============================================================================
// End-to-End Parser Pipeline Tests
// ============================================================================

describe('Parser Pipeline End-to-End', () => {
    let workspace: TestWorkspace;

    before(() => {
        workspace = createTestWorkspace();
    });

    after(() => {
        workspace.cleanup();
    });

    test('full extraction pipeline produces valid artifact', async () => {
        const registry = ParserRegistry.getInstance();
        const filePath = path.join(workspace.root, 'src', 'example.ts');

        // Get parser through registry
        const parser = registry.getParser(filePath, workspace.root);
        assert.ok(parser, 'Registry should return parser');

        // Extract artifact
        const artifact = await parser.extract(filePath);
        assert.ok(artifact, 'Should extract artifact');

        // Verify artifact structure
        assert.ok(artifact.file, 'Should have file metadata');
        assert.ok(artifact.file.id, 'File should have ID');
        assert.ok(artifact.file.path, 'File should have path');
        assert.ok(artifact.file.language, 'File should have language');

        assert.ok(Array.isArray(artifact.imports), 'Should have imports array');
        assert.ok(Array.isArray(artifact.exports), 'Should have exports array');
        assert.ok(Array.isArray(artifact.entities), 'Should have entities array');

        // Verify entities have required fields
        for (const entity of artifact.entities) {
            assert.ok(entity.name, 'Entity should have name');
            assert.ok(entity.kind, 'Entity should have kind');
            assert.ok(Array.isArray(entity.calls), 'Entity should have calls array');
        }
    });

    test('extraction handles files with syntax errors gracefully', async () => {
        // Create a file with invalid syntax
        const badFilePath = path.join(workspace.root, 'src', 'bad.ts');
        fs.writeFileSync(badFilePath, `
// This file has syntax errors
export function broken( {
    // Missing closing paren and brace
`.trim());

        const registry = ParserRegistry.getInstance();
        const parser = registry.getParser(badFilePath, workspace.root);

        // Should not throw, but may return null or partial artifact
        try {
            const artifact = await parser?.extract(badFilePath);
            // If it returns something, it should still be valid structure
            if (artifact) {
                assert.ok(artifact.file, 'Even partial artifact should have file');
            }
        } catch (e) {
            // It's acceptable to throw for invalid files
            assert.ok(e instanceof Error);
        }
    });
});
