import { FileOutline } from '../parser';

export interface ArtifactData {
    sourcePath: string;
    lastModified: number;
    structure: FileOutline;
    enrichment?: ArtifactEnrichment;
}

export interface ArtifactEnrichment {
    summary?: string;
    functions?: Record<string, FunctionEnrichment>;
    classes?: Record<string, ClassEnrichment>;
}

export interface FunctionEnrichment {
    description?: string;
    inputs?: string[];
    outputs?: string[];
}

export interface ClassEnrichment {
    description?: string;
}

export interface ArtifactMetadata {
    id: string;
    sourcePath: string;
    artifactPath: string;
    type: string;           // "mirror", "summary", "dependencies", etc.
    createdAt: string;      // ISO timestamp
    promptHash?: string;
}

export interface ArtifactRecord {
    metadata: ArtifactMetadata;
    content: string; // JSON string for mirror artifacts
    data?: ArtifactData; // Parsed object
}

// Simple tree structure: keys are paths (directories) or file references
// For a simplified implementation, we might just list artifacts, but a tree is nice for UI.
// Let's stick to the plan's implication of a tree structure if possible, 
// or just a flat list logic wrapper in tree.ts.
// For now, let's define a flexible tree node.
export interface ArtifactTreeNode {
    path: string;
    isDirectory: boolean;
    children?: ArtifactTreeNode[];
    artifacts?: ArtifactMetadata[]; // If it's a file node, it might have associated artifacts
}

export type ArtifactTree = ArtifactTreeNode;
