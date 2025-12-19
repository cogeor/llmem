import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    initializeArtifactService,
    createArtifact,
    listArtifacts,
    deleteArtifact,
    ensureArtifacts,
    saveFolderSummary
} from '../../artifact/service';

describe('Artifact Service', async () => {
    let testRoot: string;

    before(async () => {
        const tmpDir = os.tmpdir();
        testRoot = await fs.mkdtemp(path.join(tmpDir, 'llmem-test-'));
        console.log(`Test root: ${testRoot}`);
        await initializeArtifactService(testRoot);
    });

    after(async () => {
        // Cleanup
        try {
            await fs.rm(testRoot, { recursive: true, force: true });
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    });

    it('should create an artifact manually', async () => {
        const sourcePath = 'src/test/example.ts';
        const type = 'summary';
        const content = '# Summary\nThis is a test summary artifact.';

        const metadata = await createArtifact(sourcePath, type, content);

        assert.ok(metadata.id, 'Artifact ID should be generated');
        assert.strictEqual(metadata.sourcePath, sourcePath);
        assert.strictEqual(metadata.type, type);

        // Verify file exists on disk
        const fileContent = await fs.readFile(metadata.artifactPath, 'utf-8');
        assert.strictEqual(fileContent, content);
    });

    it('should list artifacts with filtering', async () => {
        const pathA = 'src/a.ts';
        const pathB = 'src/b.ts';

        await createArtifact(pathA, 'type1', 'A1');
        await createArtifact(pathA, 'type2', 'A2');
        await createArtifact(pathB, 'type1', 'B1');

        const all = await listArtifacts();
        assert.ok(all.length >= 3);

        const type1 = await listArtifacts({ type: 'type1' });
        const type1Sources = type1.map(a => a.sourcePath);
        assert.ok(type1Sources.includes(pathA));
        assert.ok(type1Sources.includes(pathB));

        const srcA = await listArtifacts({ sourcePath: pathA });
        assert.strictEqual(srcA.length, 2);
    });

    // DISABLED: ensureArtifacts is disabled in edge list migration
    // Legacy test kept for reference when lazy loading is implemented
    it.skip('should ensure artifacts for a folder (generate from source) - LEGACY', async () => {
        // Create dummy source file
        const folder = path.join(testRoot, 'src', 'code');
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, 'app.ts'), 'function main() { return 1; }');

        const relativeFolder = path.join('src', 'code');
        const result = await ensureArtifacts(relativeFolder);

        assert.strictEqual(result.length, 1);
        const artifact = result[0];

        const expectedPath = path.join('src', 'code', 'app.ts');
        assert.strictEqual(artifact.metadata.sourcePath, expectedPath);

        const jsonContent = JSON.parse(artifact.content);
        assert.ok(jsonContent.entities.length > 0, 'Should have entities');
        assert.ok(jsonContent.entities.some((e: any) => e.name === 'main'), 'Should find main function');
    });

    it('ensureArtifacts returns empty when disabled', async () => {
        const result = await ensureArtifacts('src/code');
        assert.strictEqual(result.length, 0, 'Should return empty array when disabled');
    });

    // DISABLED: saveFolderSummary is disabled in edge list migration
    it.skip('should save folder summary - LEGACY', async () => {
        const folder = 'src/domain';
        const summary = '# Domain Summary';

        const metadata = await saveFolderSummary(folder, summary);

        assert.strictEqual(metadata.type, 'folder_summary');

        const content = await fs.readFile(metadata.artifactPath, 'utf-8');
        assert.strictEqual(content, summary);
    });

    it('saveFolderSummary returns stub when disabled', async () => {
        const metadata = await saveFolderSummary('src/domain', '# Summary');
        assert.strictEqual(metadata.type, 'folder_summary');
        assert.strictEqual(metadata.artifactPath, '', 'Should return empty path when disabled');
    });

    it('should delete an artifact', async () => {
        const sourcePath = 'src/delete_me.ts';
        const created = await createArtifact(sourcePath, 'temp', 'delete me');

        const deleted = await deleteArtifact(created.id);
        assert.strictEqual(deleted, true);

        // Verify file is gone
        try {
            await fs.access(created.artifactPath);
            assert.fail('File should be deleted');
        } catch {
            // Expected
        }
    });
});
