import { ArtifactExtractor } from './interfaces';

export class ExtractorRegistry {
    private extractors = new Map<string, ArtifactExtractor>();

    register(extension: string, extractor: ArtifactExtractor) {
        this.extractors.set(extension, extractor);
    }

    get(filePath: string): ArtifactExtractor | undefined {
        // Iterate to match extension (e.g. .ts endsWith .ts)
        // We could use a more complex matching if needed (regex etc)
        // But simple extension match is usually enough.
        // We prioritize longest match? Or just any match.
        for (const [ext, extractor] of this.extractors) {
            if (filePath.endsWith(ext)) {
                return extractor;
            }
        }
        return undefined;
    }

    getSupportedExtensions(): string[] {
        return Array.from(this.extractors.keys());
    }
}
