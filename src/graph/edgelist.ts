/**
 * Edge List Storage
 * 
 * Split storage for import and call graph edges.
 * Import edges are stored in import-edgelist.json
 * Call edges are stored in call-edgelist.json
 * 
 * Optimized for in-memory operations with periodic disk persistence.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface EdgeListData {
    version: string;
    timestamp: string;
    nodes: NodeEntry[];
    edges: EdgeEntry[];
}

export interface NodeEntry {
    id: string;           // "src/parser/ts-service.ts::getTypeScriptFiles"
    name: string;         // "getTypeScriptFiles"
    kind: 'file' | 'function' | 'class' | 'method' | 'arrow' | 'const';
    fileId: string;       // "src/parser/ts-service.ts"
}

export interface EdgeEntry {
    source: string;       // node ID (for calls) or file ID (for imports)
    target: string;       // node ID (for calls) or file ID (for imports)
    kind: 'import' | 'call';
}

// ============================================================================
// Constants
// ============================================================================

const EDGELIST_VERSION = '1.0.0';
const IMPORT_EDGELIST_FILENAME = 'import-edgelist.json';
const CALL_EDGELIST_FILENAME = 'call-edgelist.json';

// ============================================================================
// Base EdgeListStore (shared logic)
// ============================================================================

abstract class BaseEdgeListStore {
    protected data: EdgeListData;
    protected filePath: string;
    protected dirty: boolean = false;
    protected readonly edgeKind: 'import' | 'call';

    constructor(artifactRoot: string, filename: string, edgeKind: 'import' | 'call') {
        this.filePath = path.join(artifactRoot, filename);
        this.edgeKind = edgeKind;
        this.data = this.createEmpty();
    }

    protected createEmpty(): EdgeListData {
        return {
            version: EDGELIST_VERSION,
            timestamp: new Date().toISOString(),
            nodes: [],
            edges: []
        };
    }

    // ========================================================================
    // Persistence
    // ========================================================================

    async load(): Promise<void> {
        try {
            if (fsSync.existsSync(this.filePath)) {
                const content = await fs.readFile(this.filePath, 'utf-8');
                this.data = JSON.parse(content);
                console.error(`[${this.constructor.name}] Loaded ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            } else {
                this.data = this.createEmpty();
                console.error(`[${this.constructor.name}] No existing edge list, starting fresh`);
            }
        } catch (e) {
            console.error(`[${this.constructor.name}] Failed to load, starting fresh:`, e);
            this.data = this.createEmpty();
        }
        this.dirty = false;
    }

    async save(): Promise<void> {
        if (!this.dirty) {
            console.error(`[${this.constructor.name}] No changes to save`);
            return;
        }

        try {
            const dir = path.dirname(this.filePath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }

            this.data.timestamp = new Date().toISOString();
            const content = JSON.stringify(this.data, null, 2);
            await fs.writeFile(this.filePath, content, 'utf-8');
            console.error(`[${this.constructor.name}] Saved ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            this.dirty = false;
        } catch (e) {
            console.error(`[${this.constructor.name}] Failed to save:`, e);
            throw e;
        }
    }

    isDirty(): boolean {
        return this.dirty;
    }

    // ========================================================================
    // Node Operations
    // ========================================================================

    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
        this.dirty = true;
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    removeNodesByFile(fileId: string): void {
        const before = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => n.fileId !== fileId);
        if (this.data.nodes.length !== before) {
            this.dirty = true;
        }
    }

    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }

    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    /**
     * Get all nodes within a folder (or exact file match).
     * Works for both folder paths and file paths.
     */
    getNodesByFolder(folderPath: string): NodeEntry[] {
        return this.data.nodes.filter(n =>
            n.fileId === folderPath ||
            n.fileId.startsWith(folderPath + '/')
        );
    }

    // ========================================================================
    // Edge Operations
    // ========================================================================

    addEdge(edge: EdgeEntry): void {
        // Ensure edge kind matches this store
        if (edge.kind !== this.edgeKind) {
            console.warn(`[${this.constructor.name}] Ignoring ${edge.kind} edge, expected ${this.edgeKind}`);
            return;
        }

        const exists = this.data.edges.some(
            e => e.source === edge.source && e.target === edge.target
        );
        if (!exists) {
            this.data.edges.push(edge);
            this.dirty = true;
        }
    }

    addEdges(edges: EdgeEntry[]): void {
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }

    removeEdgesBySourceFile(fileId: string): void {
        const before = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => {
            // For import edges: source is the file ID
            // For call edges: source contains the file ID (e.g., "fileId::functionName")
            return !e.source.startsWith(fileId);
        });
        if (this.data.edges.length !== before) {
            this.dirty = true;
        }
    }

    getEdges(): EdgeEntry[] {
        return this.data.edges;
    }

    // ========================================================================
    // Bulk Operations
    // ========================================================================

    updateFile(fileId: string, nodes: NodeEntry[], edges: EdgeEntry[]): void {
        this.removeNodesByFile(fileId);
        this.removeEdgesBySourceFile(fileId);
        this.addNodes(nodes);
        this.addEdges(edges);
    }

    clear(): void {
        this.data = this.createEmpty();
        this.dirty = true;
    }

    /**
     * Remove all nodes and edges for a given folder path (or file path).
     * Handles both exact file matches and folder prefix matches.
     */
    removeByFolder(folderPath: string): void {
        const normalizedPath = folderPath.replace(/\\/g, '/');

        // Remove nodes in this folder/file
        const beforeNodes = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => {
            const normalizedFileId = n.fileId.replace(/\\/g, '/');
            return normalizedFileId !== normalizedPath &&
                !normalizedFileId.startsWith(normalizedPath + '/');
        });

        // Remove edges with sources in this folder/file
        const beforeEdges = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => {
            const normalizedSource = e.source.replace(/\\/g, '/');
            return !normalizedSource.startsWith(normalizedPath + '/') &&
                !normalizedSource.startsWith(normalizedPath + '#') &&
                normalizedSource !== normalizedPath;
        });

        if (this.data.nodes.length !== beforeNodes || this.data.edges.length !== beforeEdges) {
            this.dirty = true;
            console.error(`[${this.constructor.name}] Removed data for ${normalizedPath}: ${beforeNodes - this.data.nodes.length} nodes, ${beforeEdges - this.data.edges.length} edges`);
        }
    }

    getData(): EdgeListData {
        return this.data;
    }

    getStats(): { nodes: number; edges: number } {
        return {
            nodes: this.data.nodes.length,
            edges: this.data.edges.length
        };
    }
}

// ============================================================================
// ImportEdgeListStore - for file-to-file import relationships
// ============================================================================

export class ImportEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string) {
        super(artifactRoot, IMPORT_EDGELIST_FILENAME, 'import');
    }
}

// ============================================================================
// CallEdgeListStore - for entity-to-entity call relationships
// ============================================================================

export class CallEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string) {
        super(artifactRoot, CALL_EDGELIST_FILENAME, 'call');
    }
}

// ============================================================================
// Legacy EdgeListStore (for backwards compatibility during migration)
// ============================================================================

const LEGACY_EDGELIST_FILENAME = 'edgelist.json';

export class EdgeListStore {
    private data: EdgeListData;
    private filePath: string;
    private dirty: boolean = false;

    constructor(artifactRoot: string) {
        this.filePath = path.join(artifactRoot, LEGACY_EDGELIST_FILENAME);
        this.data = this.createEmpty();
    }

    private createEmpty(): EdgeListData {
        return {
            version: EDGELIST_VERSION,
            timestamp: new Date().toISOString(),
            nodes: [],
            edges: []
        };
    }

    async load(): Promise<void> {
        try {
            if (fsSync.existsSync(this.filePath)) {
                const content = await fs.readFile(this.filePath, 'utf-8');
                this.data = JSON.parse(content);
                console.error(`[EdgeListStore] Loaded ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            } else {
                this.data = this.createEmpty();
                console.error('[EdgeListStore] No existing edge list, starting fresh');
            }
        } catch (e) {
            console.error('[EdgeListStore] Failed to load, starting fresh:', e);
            this.data = this.createEmpty();
        }
        this.dirty = false;
    }

    async save(): Promise<void> {
        if (!this.dirty) {
            console.error('[EdgeListStore] No changes to save');
            return;
        }

        try {
            const dir = path.dirname(this.filePath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }

            this.data.timestamp = new Date().toISOString();
            const content = JSON.stringify(this.data, null, 2);
            await fs.writeFile(this.filePath, content, 'utf-8');
            console.error(`[EdgeListStore] Saved ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            this.dirty = false;
        } catch (e) {
            console.error('[EdgeListStore] Failed to save:', e);
            throw e;
        }
    }

    isDirty(): boolean {
        return this.dirty;
    }

    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
        this.dirty = true;
    }

    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    removeNodesByFile(fileId: string): void {
        const before = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => n.fileId !== fileId);
        if (this.data.nodes.length !== before) {
            this.dirty = true;
        }
    }

    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }

    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    addEdge(edge: EdgeEntry): void {
        const exists = this.data.edges.some(
            e => e.source === edge.source && e.target === edge.target && e.kind === edge.kind
        );
        if (!exists) {
            this.data.edges.push(edge);
            this.dirty = true;
        }
    }

    addEdges(edges: EdgeEntry[]): void {
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }

    removeEdgesBySourceFile(fileId: string): void {
        const before = this.data.edges.length;
        this.data.edges = this.data.edges.filter(e => {
            return !e.source.startsWith(fileId);
        });
        if (this.data.edges.length !== before) {
            this.dirty = true;
        }
    }

    getEdges(): EdgeEntry[] {
        return this.data.edges;
    }

    getEdgesByKind(kind: 'import' | 'call'): EdgeEntry[] {
        return this.data.edges.filter(e => e.kind === kind);
    }

    updateFile(fileId: string, nodes: NodeEntry[], edges: EdgeEntry[]): void {
        this.removeNodesByFile(fileId);
        this.removeEdgesBySourceFile(fileId);
        this.addNodes(nodes);
        this.addEdges(edges);
    }

    clear(): void {
        this.data = this.createEmpty();
        this.dirty = true;
    }

    getData(): EdgeListData {
        return this.data;
    }

    getStats(): { nodes: number; edges: number; importEdges: number; callEdges: number } {
        return {
            nodes: this.data.nodes.length,
            edges: this.data.edges.length,
            importEdges: this.data.edges.filter(e => e.kind === 'import').length,
            callEdges: this.data.edges.filter(e => e.kind === 'call').length
        };
    }
}
