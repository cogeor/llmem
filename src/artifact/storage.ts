import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Ensures the directory exists before writing.
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, { encoding: 'utf-8' });
}

export async function readFile(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, { encoding: 'utf-8' });
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function deleteFile(filePath: string): Promise<boolean> {
    try {
        await fs.unlink(filePath);
        // Attempt to clean up empty parent directories? 
        // For now, let's keep it simple.
        return true;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

export async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}
