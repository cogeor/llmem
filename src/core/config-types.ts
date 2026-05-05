/**
 * LLMem core configuration value type.
 *
 * The runtime loaders (`getConfig`/`loadConfig` in src/runtime/config.ts;
 * `getClaudeConfig` in src/claude/config.ts) construct values of this
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
}
