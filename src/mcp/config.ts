/**
 * MCP Server Configuration
 *
 * Configuration for the standalone MCP server entry point.
 * Uses shared defaults from config-defaults.ts.
 */

import type { Config } from '../core/config-types';
import { DEFAULT_CONFIG, ENV_VARS, MAX_FILES_PER_FOLDER_CAP, MAX_FILE_SIZE_KB_CAP, MAX_FILE_LINES_CAP } from '../config-defaults';
import { parseInternalOnly } from '../core/internal-only';

/**
 * Load configuration for the MCP server
 *
 * Priority:
 * 1. Environment variables (LLMEM_* prefix)
 * 2. .llmem/config.json in workspace (future enhancement)
 * 3. Defaults
 */
export function getMcpConfig(): Config {
    const config: Config = {
        artifactRoot:
            process.env[ENV_VARS.ARTIFACT_ROOT] ||
            DEFAULT_CONFIG.artifactRoot,
        maxFilesPerFolder: parseInt(
            process.env[ENV_VARS.MAX_FILES_PER_FOLDER] ||
                String(DEFAULT_CONFIG.maxFilesPerFolder),
            10
        ),
        maxFileSizeKB: parseInt(
            process.env[ENV_VARS.MAX_FILE_SIZE_KB] ||
                String(DEFAULT_CONFIG.maxFileSizeKB),
            10
        ),
        maxFileLines: parseInt(
            process.env[ENV_VARS.MAX_FILE_LINES] ||
                String(DEFAULT_CONFIG.maxFileLines),
            10
        ),
        internalOnly: parseInternalOnly(
            process.env[ENV_VARS.INTERNAL_ONLY],
            DEFAULT_CONFIG.internalOnly,
        ),
    };

    // Validate numeric values — lower bound
    if (isNaN(config.maxFilesPerFolder) || config.maxFilesPerFolder < 1) {
        config.maxFilesPerFolder = DEFAULT_CONFIG.maxFilesPerFolder;
    }

    if (isNaN(config.maxFileSizeKB) || config.maxFileSizeKB < 1) {
        config.maxFileSizeKB = DEFAULT_CONFIG.maxFileSizeKB;
    }

    if (isNaN(config.maxFileLines) || config.maxFileLines < 1) {
        config.maxFileLines = DEFAULT_CONFIG.maxFileLines;
    }

    // Validate numeric values — upper-bound caps
    if (config.maxFilesPerFolder > MAX_FILES_PER_FOLDER_CAP) {
        config.maxFilesPerFolder = MAX_FILES_PER_FOLDER_CAP;
    }
    if (config.maxFileSizeKB > MAX_FILE_SIZE_KB_CAP) {
        config.maxFileSizeKB = MAX_FILE_SIZE_KB_CAP;
    }
    if (config.maxFileLines > MAX_FILE_LINES_CAP) {
        config.maxFileLines = MAX_FILE_LINES_CAP;
    }

    return config;
}

/**
 * Environment variables for MCP server configuration.
 * Re-exported from config-defaults for backwards compatibility.
 *
 * - LLMEM_WORKSPACE: Workspace root directory (auto-detected if not set)
 * - LLMEM_ARTIFACT_ROOT: Artifact root folder (default: .llmem/graph)
 * - LLMEM_MAX_FILES_PER_FOLDER: Max files per folder (default: 20)
 * - LLMEM_MAX_FILE_SIZE_KB: Max file size in KB (default: 512)
 * - LLMEM_MAX_FILE_LINES: Max file length in lines (default: 2000)
 */
export { ENV_VARS as MCP_ENV_VARS } from '../config-defaults';
