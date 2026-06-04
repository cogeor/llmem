/**
 * GraphServer configuration.
 *
 * B8: lifted out of `index.ts` so the class shell stays under the 250-line
 * platform-handler budget, and so `server-context.ts` can reference the
 * config shape without importing back from `index.ts` (which would create
 * an import cycle). `index.ts` re-exports `ServerConfig` so the public
 * surface (`import { ServerConfig } from '../http-server'`) is unchanged.
 */

import { DEFAULT_PORT, DEFAULT_CONFIG } from '../config-defaults';

/**
 * Server configuration
 */
export interface ServerConfig {
    /** Port to listen on (default: DEFAULT_PORT from config-defaults.ts). Use 0 for an ephemeral port. */
    port?: number;
    /** Workspace root directory */
    workspaceRoot: string;
    /** Artifact root (default: DEFAULT_CONFIG.artifactRoot from config-defaults.ts) */
    artifactRoot?: string;
    /** Auto-open browser on start (default: false) */
    openBrowser?: boolean;
    /** Enable verbose logging (default: false) */
    verbose?: boolean;
    /** Optional Bearer token required for mutating endpoints. Empty = no auth. */
    apiToken?: string;
    /**
     * Loop 21 — optional explicit override for the webview asset directory.
     * Threaded into `RegenerateDeps.assetRoot` so the launcher can skip its
     * cwd-/repo-walk discovery when the embedder already knows the path.
     */
    assetRoot?: string;
}

/**
 * Apply defaults to a partial `ServerConfig`, producing the fully-resolved
 * shape the server holds. `assetRoot` stays '' (not undefined) for "use the
 * launcher's discovery chain"; `buildRegenDeps` translates '' → undefined
 * when forwarding so `Required<ServerConfig>` stays satisfied.
 */
export function normalizeConfig(config: ServerConfig): Required<ServerConfig> {
    return {
        port: config.port ?? DEFAULT_PORT,
        workspaceRoot: config.workspaceRoot,
        artifactRoot: config.artifactRoot || DEFAULT_CONFIG.artifactRoot,
        openBrowser: config.openBrowser || false,
        verbose: config.verbose || false,
        apiToken: config.apiToken || '',
        assetRoot: config.assetRoot || '',
    };
}
