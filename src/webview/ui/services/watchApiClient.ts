/**
 * Watch API Client
 *
 * HTTP API client for managing watched files in standalone/HTTP mode.
 * Communicates with the server's watch endpoints.
 */

export interface WatchApiResponse {
    success: boolean;
    addedFiles?: string[];
    removedFiles?: string[];
    message: string;
}

export interface WatchStateResponse {
    watchedFiles: string[];
    totalFiles: number;
    lastUpdated: string;
}

/**
 * Client for watch API operations
 */
export class WatchApiClient {
    private baseUrl: string;

    constructor() {
        // Use current origin for API calls
        this.baseUrl = window.location.origin;
    }

    /**
     * Get current watch state
     */
    async getWatchState(): Promise<WatchStateResponse> {
        const response = await fetch(`${this.baseUrl}/api/watched`);
        if (!response.ok) {
            throw new Error(`Failed to get watch state: ${response.statusText}`);
        }
        return response.json();
    }

    /**
     * Add file or folder to watched state
     */
    async addToWatch(relativePath: string): Promise<WatchApiResponse> {
        const response = await fetch(`${this.baseUrl}/api/watch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: relativePath }),
        });

        if (!response.ok) {
            throw new Error(`Failed to add to watch: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Remove file or folder from watched state
     */
    async removeFromWatch(relativePath: string): Promise<WatchApiResponse> {
        const response = await fetch(`${this.baseUrl}/api/watch`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: relativePath }),
        });

        if (!response.ok) {
            throw new Error(`Failed to remove from watch: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Toggle watch state for a path
     */
    async toggleWatch(relativePath: string, watched: boolean): Promise<WatchApiResponse> {
        if (watched) {
            return this.addToWatch(relativePath);
        } else {
            return this.removeFromWatch(relativePath);
        }
    }
}
