/**
 * Shared Configuration Defaults
 *
 * Single source of truth for all default config values and environment variable
 * names used across the LLMem extension, Claude Code mode, and MCP server.
 */

import type { Config } from './core/config-types';

/**
 * Default configuration values shared by all LLMem modules.
 */
export const DEFAULT_CONFIG: Config = {
    artifactRoot: '.artifacts',
    maxFilesPerFolder: 20,
    maxFileSizeKB: 512,
};

/**
 * Canonical environment variable names for LLMem configuration.
 * All env vars use the `LLMEM_` prefix.
 */
export const ENV_VARS = {
    WORKSPACE: 'LLMEM_WORKSPACE',
    ARTIFACT_ROOT: 'LLMEM_ARTIFACT_ROOT',
    MAX_FILES_PER_FOLDER: 'LLMEM_MAX_FILES_PER_FOLDER',
    MAX_FILE_SIZE_KB: 'LLMEM_MAX_FILE_SIZE_KB',
} as const;

/** Upper-bound cap for maxFilesPerFolder */
export const MAX_FILES_PER_FOLDER_CAP = 500;

/** Upper-bound cap for maxFileSizeKB */
export const MAX_FILE_SIZE_KB_CAP = 10240;

/**
 * Default port for the graph webview HTTP server.
 *
 * Single source of truth — referenced by the CLI flag default
 * (`commands/serve.ts`), the `GraphServer` constructor / `startServer`
 * helper (`server/index.ts`), the help text (`cli/main.ts`), and the
 * `init` TOML stub (`commands/init.ts`). Change here and rebuild.
 */
export const DEFAULT_PORT = 7474;
