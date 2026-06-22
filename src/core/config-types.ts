/**
 * LLMem core configuration value type.
 *
 * The runtime loaders (`getConfig`/`loadConfig` in src/runtime/config.ts;
 * `getMcpConfig` in src/mcp/config.ts) construct values of this
 * type. The type itself lives here so that leaf modules
 * (src/config-defaults.ts, src/mcp/server.ts, src/scripts/*) can reference
 * it without depending on the VS Code extension layer.
 */
export interface Config {
    /** Root folder for artifacts (relative to workspace) */
    artifactRoot: string;
    /** Maximum files to include per folder when building context */
    maxFilesPerFolder: number;
    /** Maximum file size in KB to include in context */
    maxFileSizeKB: number;
    /** Maximum file length in lines to include when scanning */
    maxFileLines: number;
    /**
     * When true (the default), omit external-module import edges/nodes (deps
     * like react / sqlalchemy); only internal workspace file→file import edges
     * are emitted. All call edges are emitted regardless. Set false (env
     * `LLMEM_INTERNAL_ONLY=0`/`false`, or CLI `scan --external`) to include
     * external import edges/nodes.
     */
    internalOnly: boolean;
}
