import * as path from 'path';
import { ArtifactMetadata } from './types';
import { readFile, writeFile, exists } from './storage';
import { getArtifactsRoot } from './path-mapper';

const INDEX_FILE = '.index.json';

export class ArtifactIndex {
    private records: ArtifactMetadata[] = [];
    private workspaceRoot: string;
    private indexPath: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.indexPath = path.join(getArtifactsRoot(workspaceRoot), INDEX_FILE);
    }

    async load(): Promise<void> {
        if (await exists(this.indexPath)) {
            const content = await readFile(this.indexPath);
            if (content) {
                try {
                    this.records = JSON.parse(content);
                } catch (e) {
                    console.error('Failed to parse artifact index:', e);
                    this.records = [];
                }
            }
        } else {
            this.records = [];
        }
    }

    async save(): Promise<void> {
        // DISABLED: Artifact system deprecated, using edge list
        console.error('[ArtifactIndex] save() disabled - using edge list instead');
        return;
    }

    addRecord(record: ArtifactMetadata): void {
        // Remove existing record if it exists (update)
        this.records = this.records.filter(r => r.id !== record.id);
        this.records.push(record);
    }

    removeRecord(id: string): void {
        this.records = this.records.filter(r => r.id !== id);
    }

    removeRecordsForSource(sourcePath: string): void {
        // Normalize slashes for comparison if needed, but assuming standard paths
        this.records = this.records.filter(r => r.sourcePath !== sourcePath);
    }

    getAll(): ArtifactMetadata[] {
        return [...this.records];
    }

    query(filter: { sourcePath?: string; type?: string }): ArtifactMetadata[] {
        return this.records.filter(r => {
            if (filter.sourcePath && r.sourcePath !== filter.sourcePath) return false;
            if (filter.type && r.type !== filter.type) return false;
            return true;
        });
    }
}
