/**
 * Claude Code Configuration
 *
 * Configuration specifically for Claude Code usage.
 * Uses shared defaults from config-defaults.ts.
 */

import { Config } from '../extension/config';
import { DEFAULT_CONFIG, ENV_VARS, MAX_FILES_PER_FOLDER_CAP, MAX_FILE_SIZE_KB_CAP } from '../config-defaults';

/**
 * Load configuration for Claude Code
 *
 * Priority:
 * 1. Environment variables (LLMEM_* prefix)
 * 2. .llmem/config.json in workspace (future enhancement)
 * 3. Defaults
 */
export function getClaudeConfig(): Config {
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
    };

    // Validate numeric values — lower bound
    if (isNaN(config.maxFilesPerFolder) || config.maxFilesPerFolder < 1) {
        config.maxFilesPerFolder = DEFAULT_CONFIG.maxFilesPerFolder;
    }

    if (isNaN(config.maxFileSizeKB) || config.maxFileSizeKB < 1) {
        config.maxFileSizeKB = DEFAULT_CONFIG.maxFileSizeKB;
    }

    // Validate numeric values — upper-bound caps
    if (config.maxFilesPerFolder > MAX_FILES_PER_FOLDER_CAP) {
        config.maxFilesPerFolder = MAX_FILES_PER_FOLDER_CAP;
    }
    if (config.maxFileSizeKB > MAX_FILE_SIZE_KB_CAP) {
        config.maxFileSizeKB = MAX_FILE_SIZE_KB_CAP;
    }

    return config;
}

/**
 * Environment variables for Claude Code configuration.
 * Re-exported from config-defaults for backwards compatibility.
 *
 * - LLMEM_WORKSPACE: Workspace root directory (auto-detected if not set)
 * - LLMEM_ARTIFACT_ROOT: Artifact root folder (default: .artifacts)
 * - LLMEM_MAX_FILES_PER_FOLDER: Max files per folder (default: 20)
 * - LLMEM_MAX_FILE_SIZE_KB: Max file size in KB (default: 512)
 */
export { ENV_VARS as CLAUDE_ENV_VARS } from '../config-defaults';
