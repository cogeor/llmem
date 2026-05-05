import { FileArtifact } from './types';

export interface ArtifactExtractor {
    /**
     * Extract artifact data from a file.
     *
     * Contract:
     * - `filePath` is the canonical identity for the artifact. It is
     *   used for the returned `FileArtifact.file.path`, for computing
     *   `file.id` (relpath against workspace root), and for any
     *   path-based resolution (e.g. TypeScript import resolution).
     *   `filePath` MUST be an absolute path.
     * - `content` is optional. When OMITTED, the extractor reads
     *   `filePath` from disk. When PROVIDED, the extractor MUST use
     *   `content` as the source text and MUST NOT read `filePath`
     *   from disk for that file's bytes — this allows callers to
     *   parse unsaved buffers, in-memory edits, or virtual files
     *   that are addressed by `filePath` for resolution purposes
     *   but whose bytes do not (yet) live on disk.
     * - The extractor MAY still read OTHER files from disk while
     *   resolving imports (e.g. tsconfig.json, sibling source
     *   files). The `content` parameter only governs the bytes of
     *   `filePath` itself.
     *
     * @param filePath Absolute path to the file (canonical identity).
     * @param content  Optional source text. If provided, used in
     *                 place of reading `filePath` from disk.
     * @returns        A FileArtifact, or null if extraction failed.
     */
    extract(filePath: string, content?: string): Promise<FileArtifact | null>;
}
