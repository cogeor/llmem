/**
 * LLMem Configuration Module
 *
 * Loads and validates configuration from environment variables.
 * Provides typed configuration interface to other modules.
 */

import { DEFAULT_CONFIG, ENV_VARS, MAX_FILES_PER_FOLDER_CAP, MAX_FILE_SIZE_KB_CAP } from '../config-defaults';
import type { Config } from '../core/config-types';

/**
 * Configuration interface for LLMem extension
 *
 * Loop 04: the type lives in `src/core/config-types.ts`. This module
 * re-exports it as a transitional shim so existing
 * `import { Config } from '../extension/config'` callers keep working
 * while Loop 09/10 moves the runtime (`getConfig`/`loadConfig`) out of
 * `extension/`. After that, this re-export can go away too.
 */
export type { Config };

/** Cached configuration instance */
let configInstance: Config | null = null;

/**
 * Load configuration from environment variables
 *
 * Priority (highest to lowest):
 *   1. Environment variables (LLMEM_* prefix)
 *   2. VS Code workspace settings (llmem.*)
 *   3. Built-in defaults
 *
 * @returns Loaded configuration object
 */
export function loadConfig(): Config {
    // Read VS Code workspace settings (silently ignored outside VS Code)
    let vsCodeConfig: { artifactRoot?: string; maxFilesPerFolder?: number; maxFileSizeKB?: number } = {};
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const vscode = require('vscode');
        const ws = vscode.workspace.getConfiguration('llmem');
        vsCodeConfig = {
            artifactRoot: ws.get('artifactRoot') as string | undefined,
            maxFilesPerFolder: ws.get('maxFilesPerFolder') as number | undefined,
            maxFileSizeKB: ws.get('maxFileSizeKB') as number | undefined,
        };
    } catch {
        // Not running inside VS Code — ignore
    }

    configInstance = {
        artifactRoot: process.env[ENV_VARS.ARTIFACT_ROOT]
            || vsCodeConfig.artifactRoot
            || DEFAULT_CONFIG.artifactRoot,
        maxFilesPerFolder: parseInt(
            process.env[ENV_VARS.MAX_FILES_PER_FOLDER]
                || String(vsCodeConfig.maxFilesPerFolder ?? DEFAULT_CONFIG.maxFilesPerFolder),
            10
        ),
        maxFileSizeKB: parseInt(
            process.env[ENV_VARS.MAX_FILE_SIZE_KB]
                || String(vsCodeConfig.maxFileSizeKB ?? DEFAULT_CONFIG.maxFileSizeKB),
            10
        ),
    };

    // Validate numeric values — lower bound
    if (isNaN(configInstance.maxFilesPerFolder) || configInstance.maxFilesPerFolder < 1) {
        configInstance.maxFilesPerFolder = DEFAULT_CONFIG.maxFilesPerFolder;
    }

    if (isNaN(configInstance.maxFileSizeKB) || configInstance.maxFileSizeKB < 1) {
        configInstance.maxFileSizeKB = DEFAULT_CONFIG.maxFileSizeKB;
    }

    // Validate numeric values — upper-bound caps
    if (configInstance.maxFilesPerFolder > MAX_FILES_PER_FOLDER_CAP) {
        configInstance.maxFilesPerFolder = MAX_FILES_PER_FOLDER_CAP;
    }
    if (configInstance.maxFileSizeKB > MAX_FILE_SIZE_KB_CAP) {
        configInstance.maxFileSizeKB = MAX_FILE_SIZE_KB_CAP;
    }

    return configInstance;
}

/**
 * Get the current configuration
 *
 * @throws Error if loadConfig() has not been called
 * @returns Current configuration object
 */
export function getConfig(): Config {
    if (!configInstance) {
        throw new Error(
            'Configuration not loaded. Call loadConfig() first during extension activation.'
        );
    }
    return configInstance;
}

/**
 * Check if configuration has been loaded
 */
export function isConfigLoaded(): boolean {
    return configInstance !== null;
}

/**
 * Reset configuration (for testing purposes)
 */
export function resetConfig(): void {
    configInstance = null;
}
