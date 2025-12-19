/**
 * Edge List Storage
 * 
 * Single-file storage for graph edges and nodes.
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
// EdgeListStore
// ============================================================================

const EDGELIST_VERSION = '1.0.0';
const EDGELIST_FILENAME = 'edgelist.json';

export class EdgeListStore {
    private data: EdgeListData;
    private filePath: string;
    private dirty: boolean = false;

    constructor(artifactRoot: string) {
        this.filePath = path.join(artifactRoot, EDGELIST_FILENAME);
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

    // ========================================================================
    // Persistence
    // ========================================================================

    /**
     * Load edge list from disk. Creates empty if not exists.
     */
    async load(): Promise<void> {
        try {
            if (fsSync.existsSync(this.filePath)) {
                const content = await fs.readFile(this.filePath, 'utf-8');
                this.data = JSON.parse(content);
                console.log(`[EdgeListStore] Loaded ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            } else {
                this.data = this.createEmpty();
                console.log('[EdgeListStore] No existing edge list, starting fresh');
            }
        } catch (e) {
            console.error('[EdgeListStore] Failed to load, starting fresh:', e);
            this.data = this.createEmpty();
        }
        this.dirty = false;
    }

    /**
     * Save edge list to disk.
     */
    async save(): Promise<void> {
        if (!this.dirty) {
            console.log('[EdgeListStore] No changes to save');
            return;
        }

        try {
            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            if (!fsSync.existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }

            this.data.timestamp = new Date().toISOString();
            const content = JSON.stringify(this.data, null, 2);
            await fs.writeFile(this.filePath, content, 'utf-8');
            console.log(`[EdgeListStore] Saved ${this.data.nodes.length} nodes, ${this.data.edges.length} edges`);
            this.dirty = false;
        } catch (e) {
            console.error('[EdgeListStore] Failed to save:', e);
            throw e;
        }
    }

    /**
     * Check if there are unsaved changes.
     */
    isDirty(): boolean {
        return this.dirty;
    }

    // ========================================================================
    // Node Operations
    // ========================================================================

    /**
     * Add a node. Replaces if ID already exists.
     */
    addNode(node: NodeEntry): void {
        const idx = this.data.nodes.findIndex(n => n.id === node.id);
        if (idx >= 0) {
            this.data.nodes[idx] = node;
        } else {
            this.data.nodes.push(node);
        }
        this.dirty = true;
    }

    /**
     * Add multiple nodes at once.
     */
    addNodes(nodes: NodeEntry[]): void {
        for (const node of nodes) {
            this.addNode(node);
        }
    }

    /**
     * Remove all nodes belonging to a file.
     */
    removeNodesByFile(fileId: string): void {
        const before = this.data.nodes.length;
        this.data.nodes = this.data.nodes.filter(n => n.fileId !== fileId);
        if (this.data.nodes.length !== before) {
            this.dirty = true;
        }
    }

    /**
     * Get all nodes.
     */
    getNodes(): NodeEntry[] {
        return this.data.nodes;
    }

    /**
     * Get nodes by file.
     */
    getNodesByFile(fileId: string): NodeEntry[] {
        return this.data.nodes.filter(n => n.fileId === fileId);
    }

    // ========================================================================
    // Edge Operations
    // ========================================================================

    /**
     * Add an edge. Avoids duplicates.
     */
    addEdge(edge: EdgeEntry): void {
        const exists = this.data.edges.some(
            e => e.source === edge.source && e.target === edge.target && e.kind === edge.kind
        );
        if (!exists) {
            this.data.edges.push(edge);
            this.dirty = true;
        }
    }

    /**
     * Add multiple edges at once.
     */
    addEdges(edges: EdgeEntry[]): void {
        for (const edge of edges) {
            this.addEdge(edge);
        }
    }

    /**
     * Remove all edges originating from a file (for both import and call edges).
     */
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

    /**
     * Get all edges.
     */
    getEdges(): EdgeEntry[] {
        return this.data.edges;
    }

    /**
     * Get edges by kind.
     */
    getEdgesByKind(kind: 'import' | 'call'): EdgeEntry[] {
        return this.data.edges.filter(e => e.kind === kind);
    }

    // ========================================================================
    // Bulk Operations (for hot reload)
    // ========================================================================

    /**
     * Update all data for a single file.
     * Removes existing nodes/edges for the file and adds new ones.
     */
    updateFile(fileId: string, nodes: NodeEntry[], edges: EdgeEntry[]): void {
        this.removeNodesByFile(fileId);
        this.removeEdgesBySourceFile(fileId);
        this.addNodes(nodes);
        this.addEdges(edges);
    }

    /**
     * Clear all data.
     */
    clear(): void {
        this.data = this.createEmpty();
        this.dirty = true;
    }

    // ========================================================================
    // Data Access
    // ========================================================================

    /**
     * Get the full data object (for graph builders).
     */
    getData(): EdgeListData {
        return this.data;
    }

    /**
     * Get statistics.
     */
    getStats(): { nodes: number; edges: number; importEdges: number; callEdges: number } {
        return {
            nodes: this.data.nodes.length,
            edges: this.data.edges.length,
            importEdges: this.data.edges.filter(e => e.kind === 'import').length,
            callEdges: this.data.edges.filter(e => e.kind === 'call').length
        };
    }
}
