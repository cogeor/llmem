import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    initializeArtifactService,
    createArtifact,
    getArtifact,
    listArtifacts,
    deleteArtifact
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

    it('should create an artifact', async () => {
        const sourcePath = path.join(testRoot, 'src/test/example.ts');
        const type = 'summary';
        const content = '# Summary\nThis is a test summary artifact.';

        const metadata = await createArtifact(sourcePath, type, content);

        assert.ok(metadata.id, 'Artifact ID should be generated');
        assert.strictEqual(metadata.sourcePath, sourcePath);
        assert.strictEqual(metadata.type, type);

        // Verify file exists on disk
        const fileContent = await fs.readFile(metadata.artifactPath, 'utf-8');
        assert.strictEqual(fileContent, content);

        // Verify creates .artifacts directory
        const artifactDir = path.dirname(metadata.artifactPath);
        assert.ok(artifactDir.includes('.artifacts'), 'Should be in .artifacts dir');
    });

    it('should get an existing artifact', async () => {
        const sourcePath = path.join(testRoot, 'src/test/file2.ts');
        const type = 'analysis';
        const content = 'Analysis result';

        const created = await createArtifact(sourcePath, type, content);

        // Get by ID
        const retrievedById = await getArtifact(created.id);
        assert.ok(retrievedById, 'Should find artifact by ID');
        assert.strictEqual(retrievedById?.content, content);

        // Get by Path
        const retrievedByPath = await getArtifact(created.artifactPath);
        assert.ok(retrievedByPath, 'Should find artifact by path');
        assert.strictEqual(retrievedByPath?.content, content);
    });

    it('should list artifacts with filtering', async () => {
        // Create a few artifacts
        const pathA = path.join(testRoot, 'src/a.ts');
        const pathB = path.join(testRoot, 'src/b.ts');

        await createArtifact(pathA, 'type1', 'A1');
        await createArtifact(pathA, 'type2', 'A2');
        await createArtifact(pathB, 'type1', 'B1');

        const all = await listArtifacts();
        assert.ok(all.length >= 3);

        const type1 = await listArtifacts({ type: 'type1' });
        const type1Sources = type1.map(a => a.sourcePath);
        assert.ok(type1Sources.includes(pathA));
        assert.ok(type1Sources.includes(pathB));
        assert.ok(!type1Sources.includes(pathA) || !type1.find(a => a.type === 'type2')); // Ensure no type2

        const srcA = await listArtifacts({ sourcePath: pathA });
        assert.strictEqual(srcA.length, 2);
    });

    it('should delete an artifact', async () => {
        const sourcePath = path.join(testRoot, 'src/delete_me.ts');
        const created = await createArtifact(sourcePath, 'temp', 'delete me');

        const deleted = await deleteArtifact(created.id);
        assert.strictEqual(deleted, true);

        const check = await getArtifact(created.id);
        assert.strictEqual(check, null);

        // Verify file is gone
        try {
            await fs.access(created.artifactPath);
            assert.fail('File should be deleted');
        } catch {
            // Expected
        }
    });
});
