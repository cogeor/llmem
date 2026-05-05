/**
 * LLMem runtime configuration loader (Loop 17).
 *
 * Hosts the `loadConfig` / `getConfig` runtime previously living in
 * `src/extension/config.ts`. Moving the runtime here lets non-extension
 * callers (`src/scripts/scan_codebase.ts`,
 * `src/scripts/generate_webview.ts`) load config without crossing the
 * `scripts -> extension` boundary that `tests/arch/dependencies.test.ts`
 * forbids.
 *
 * The body is byte-identical to the previous `src/extension/config.ts`:
 *   - Reads the same env vars (`LLMEM_*`).
 *   - Falls back to the same VS Code workspace settings (`llmem.*`).
 *   - Validates the same numeric bounds.
 *
 * The `try { require('vscode') }` swallow stays as-is — the runtime
 * legitimately tries to read VS Code workspace settings when running
 * inside VS Code. Outside VS Code (CLI scripts / Claude server), the
 * `require` throws and we fall back to env + defaults.
 *
 * The dependency-test rules do not forbid `runtime -> vscode` because
 * `vscode` is a bare specifier, not a relative import. The rule the
 * loop closed was the relative `scripts -> extension` boundary.
 */

import { DEFAULT_CONFIG, ENV_VARS, MAX_FILES_PER_FOLDER_CAP, MAX_FILE_SIZE_KB_CAP } from '../config-defaults';
import type { Config } from '../core/config-types';

/**
 * Re-export the canonical `Config` interface from `src/core/config-types.ts`.
 * Loop 04 lifted the type out of the extension module; Loop 17 keeps the
 * re-export so callers can `import { Config }` from the runtime entry
 * without reaching into core directly.
 */
export type { Config };

/** Cached configuration instance */
let configInstance: Config | null = null;

/**
 * Load configuration from environment variables.
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
 * Get the current configuration.
 *
 * @throws Error if loadConfig() has not been called.
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

/** Check if configuration has been loaded */
export function isConfigLoaded(): boolean {
    return configInstance !== null;
}

/** Reset configuration (for testing purposes) */
export function resetConfig(): void {
    configInstance = null;
}
