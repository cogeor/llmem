/**
 * Claude Code Configuration
 *
 * Configuration specifically for Claude Code usage.
 * Uses different defaults than VSCode extension to avoid conflicts.
 */

import { Config } from '../extension/config';

/**
 * Default configuration for Claude Code mode
 *
 * Differences from VSCode defaults:
 * - artifactRoot: '.llmem' instead of '.artifacts' (can be same if desired)
 * - Other settings can be customized via environment variables
 */
const CLAUDE_DEFAULT_CONFIG: Config = {
    // Use .llmem to keep it separate from VSCode's .artifacts
    // Or use same '.artifacts' to share graph data between modes
    artifactRoot: process.env.LLMEM_ARTIFACT_ROOT || '.artifacts',
    maxFilesPerFolder: 20,
    maxFileSizeKB: 512,
};

/**
 * Load configuration for Claude Code
 *
 * Priority:
 * 1. Environment variables
 * 2. .llmem/config.json in workspace (future enhancement)
 * 3. Defaults
 */
export function getClaudeConfig(): Config {
    const config: Config = {
        artifactRoot:
            process.env.LLMEM_ARTIFACT_ROOT ||
            CLAUDE_DEFAULT_CONFIG.artifactRoot,
        maxFilesPerFolder: parseInt(
            process.env.LLMEM_MAX_FILES_PER_FOLDER ||
                String(CLAUDE_DEFAULT_CONFIG.maxFilesPerFolder),
            10
        ),
        maxFileSizeKB: parseInt(
            process.env.LLMEM_MAX_FILE_SIZE_KB ||
                String(CLAUDE_DEFAULT_CONFIG.maxFileSizeKB),
            10
        ),
    };

    // Validate numeric values
    if (isNaN(config.maxFilesPerFolder) || config.maxFilesPerFolder < 1) {
        config.maxFilesPerFolder = CLAUDE_DEFAULT_CONFIG.maxFilesPerFolder;
    }

    if (isNaN(config.maxFileSizeKB) || config.maxFileSizeKB < 1) {
        config.maxFileSizeKB = CLAUDE_DEFAULT_CONFIG.maxFileSizeKB;
    }

    return config;
}

/**
 * Environment variables for Claude Code configuration:
 *
 * - LLMEM_WORKSPACE: Workspace root directory (auto-detected if not set)
 * - LLMEM_ARTIFACT_ROOT: Artifact root folder (default: .artifacts)
 * - LLMEM_MAX_FILES_PER_FOLDER: Max files per folder (default: 20)
 * - LLMEM_MAX_FILE_SIZE_KB: Max file size in KB (default: 512)
 */
export const CLAUDE_ENV_VARS = {
    WORKSPACE: 'LLMEM_WORKSPACE',
    ARTIFACT_ROOT: 'LLMEM_ARTIFACT_ROOT',
    MAX_FILES_PER_FOLDER: 'LLMEM_MAX_FILES_PER_FOLDER',
    MAX_FILE_SIZE_KB: 'LLMEM_MAX_FILE_SIZE_KB',
} as const;
