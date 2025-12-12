import { FileArtifact } from './types';

export interface ArtifactExtractor {
    /**
     * Extracts artifact data from a file.
     * @param filePath The absolute path to the file.
     * @param content Optional content (if not provided, read from disk or memory).
     */
    extract(filePath: string, content?: string): Promise<FileArtifact | null>;
}
