/**
 * Design Doc Cache Service
 *
 * Manages a cache of design documents with:
 * - Initial load from window.DESIGN_DOCS
 * - WebSocket incremental updates (arch:created, arch:updated, arch:deleted)
 * - Fetch individual docs via API
 * - Save docs via API
 */

import { DesignDoc } from '../types';
import { liveReloadClient, ArchEventData } from '../../live-reload';

type ChangeCallback = (path: string, doc: DesignDoc | null, type: 'created' | 'updated' | 'deleted') => void;

/**
 * Cache for design documents with real-time updates
 */
export class DesignDocCache {
    private cache: Map<string, DesignDoc> = new Map();
    private changeListeners: Set<ChangeCallback> = new Set();
    private baseUrl: string;

    constructor() {
        this.baseUrl = window.location.origin;

        // Initialize from window.DESIGN_DOCS
        this.initFromWindow();

        // Subscribe to WebSocket events
        this.subscribeToWebSocket();
    }

    /**
     * Initialize cache from window.DESIGN_DOCS
     */
    private initFromWindow(): void {
        const windowDocs = (window as any).DESIGN_DOCS || {};
        for (const [key, doc] of Object.entries(windowDocs)) {
            if (doc && typeof doc === 'object') {
                this.cache.set(key, doc as DesignDoc);
            }
        }
        console.log(`[DesignDocCache] Initialized with ${this.cache.size} docs from window`);
    }

    /**
     * Subscribe to WebSocket events for incremental updates
     */
    private subscribeToWebSocket(): void {
        // arch:created
        liveReloadClient.on('arch:created', (event) => {
            const data = event.data as ArchEventData;
            if (data?.path) {
                this.handleArchEvent('created', data);
            }
        });

        // arch:updated
        liveReloadClient.on('arch:updated', (event) => {
            const data = event.data as ArchEventData;
            if (data?.path) {
                this.handleArchEvent('updated', data);
            }
        });

        // arch:deleted
        liveReloadClient.on('arch:deleted', (event) => {
            const data = event.data as ArchEventData;
            if (data?.path) {
                this.handleArchEvent('deleted', data);
            }
        });
    }

    /**
     * Handle arch event from WebSocket
     */
    private handleArchEvent(type: 'created' | 'updated' | 'deleted', data: ArchEventData): void {
        const { path, markdown, html } = data;

        // Normalize path - convert from .arch relative path to cache key
        // .arch/src/parser.md -> src/parser.html (for legacy) or src/parser.md
        let key = path;
        if (key.endsWith('.md') && !key.toLowerCase().includes('readme')) {
            key = key.replace(/\.md$/, '.html');
        }

        if (type === 'deleted') {
            this.cache.delete(key);
            console.log(`[DesignDocCache] Deleted: ${key}`);
            this.notifyListeners(key, null, 'deleted');
        } else if (markdown !== undefined && html !== undefined) {
            const doc: DesignDoc = { markdown, html };
            this.cache.set(key, doc);
            console.log(`[DesignDocCache] ${type}: ${key}`);
            this.notifyListeners(key, doc, type);
        }
    }

    /**
     * Notify change listeners
     */
    private notifyListeners(path: string, doc: DesignDoc | null, type: 'created' | 'updated' | 'deleted'): void {
        for (const listener of this.changeListeners) {
            try {
                listener(path, doc, type);
            } catch (e) {
                console.error('[DesignDocCache] Error in change listener:', e);
            }
        }
    }

    /**
     * Subscribe to cache changes
     * @returns Unsubscribe function
     */
    onChange(callback: ChangeCallback): () => void {
        this.changeListeners.add(callback);
        return () => this.changeListeners.delete(callback);
    }

    /**
     * Get a design doc from cache
     */
    get(key: string): DesignDoc | undefined {
        return this.cache.get(key);
    }

    /**
     * Get all cached design docs
     */
    getAll(): Record<string, DesignDoc> {
        const result: Record<string, DesignDoc> = {};
        for (const [key, doc] of this.cache.entries()) {
            result[key] = doc;
        }
        return result;
    }

    /**
     * Check if a key exists in cache
     */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Fetch a design doc from server (for docs not in cache)
     * @param docPath Path relative to .arch (e.g., "src/parser")
     */
    async fetch(docPath: string): Promise<DesignDoc | null> {
        try {
            const response = await fetch(`${this.baseUrl}/api/arch?path=${encodeURIComponent(docPath)}`);
            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`Failed to fetch: ${response.statusText}`);
            }

            const data = await response.json();
            if (data.success && data.markdown && data.html) {
                const doc: DesignDoc = {
                    markdown: data.markdown,
                    html: data.html
                };

                // Update cache
                const key = docPath.endsWith('.md') ? docPath.replace(/\.md$/, '.html') : `${docPath}.html`;
                this.cache.set(key, doc);

                return doc;
            }
            return null;
        } catch (e) {
            console.error(`[DesignDocCache] Fetch error:`, e);
            return null;
        }
    }

    /**
     * Save a design doc to server
     * @param docPath Path relative to .arch (e.g., "src/parser" or "src/parser.md")
     * @param markdown Markdown content
     * @returns Success status
     */
    async save(docPath: string, markdown: string): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/arch`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: docPath,
                    markdown
                })
            });

            const data = await response.json();
            return data.success === true;
        } catch (e) {
            console.error(`[DesignDocCache] Save error:`, e);
            return false;
        }
    }
}

// Singleton instance
export const designDocCache = new DesignDocCache();
