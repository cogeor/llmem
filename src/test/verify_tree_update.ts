
import * as fs from 'fs';
import * as path from 'path';
import { generateWorkTree } from '../webview/worktree';

const TEST_DIR = path.join(__dirname, 'temp_tree_test');

function setup() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR);
}

function teardown() {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
}

async function runTest() {
    console.log('Setting up test environment...');
    setup();

    try {
        // 1. Create initial structure
        fs.writeFileSync(path.join(TEST_DIR, 'file1.txt'), 'content');
        fs.mkdirSync(path.join(TEST_DIR, 'sub'));
        fs.writeFileSync(path.join(TEST_DIR, 'sub/file2.txt'), 'content');

        // 2. Generate initial tree
        console.log('Generating initial tree...');
        const tree1 = await generateWorkTree(TEST_DIR, TEST_DIR);

        // Verify tree1 has file1.txt and sub/file2.txt
        const file1 = tree1.children?.find(c => c.name === 'file1.txt');
        const sub = tree1.children?.find(c => c.name === 'sub');
        const file2 = sub?.children?.find(c => c.name === 'file2.txt');

        if (!file1 || !sub || !file2) {
            throw new Error('Initial tree structure is incorrect');
        }
        console.log('Initial tree verified.');

        // 3. Add a new file
        console.log('Adding new file...');
        fs.writeFileSync(path.join(TEST_DIR, 'newfile.txt'), 'content');

        // 4. Generate tree again
        console.log('Generating updated tree...');
        const tree2 = await generateWorkTree(TEST_DIR, TEST_DIR);

        // Verify tree2 has newfile.txt
        const newFile = tree2.children?.find(c => c.name === 'newfile.txt');
        if (!newFile) {
            throw new Error('Updated tree missed the new file');
        }
        console.log('Update (Addition) verified.');

        // 5. Remove a file
        console.log('Removing a file...');
        fs.unlinkSync(path.join(TEST_DIR, 'file1.txt'));

        // 6. Generate tree again
        const tree3 = await generateWorkTree(TEST_DIR, TEST_DIR);

        // Verify file1.txt is gone
        const file1Gone = tree3.children?.find(c => c.name === 'file1.txt');
        if (file1Gone) {
            throw new Error('Updated tree still has deleted file');
        }
        console.log('Update (Deletion) verified.');

        console.log('TEST PASSED');

    } catch (e) {
        console.error('TEST FAILED:', e);
        process.exit(1);
    } finally {
        teardown();
    }
}

runTest();
