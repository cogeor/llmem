/**
 * LLMem Configuration Module
 * 
 * Loads and validates configuration from environment variables.
 * Provides typed configuration interface to other modules.
 */

/**
 * Configuration interface for LLMem extension
 */
export interface Config {
    /** Root folder for artifacts (relative to workspace) */
    artifactRoot: string;
    /** Maximum files to include per folder when building context */
    maxFilesPerFolder: number;
    /** Maximum file size in KB to include in context */
    maxFileSizeKB: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
    artifactRoot: '.artifacts',
    maxFilesPerFolder: 20,
    maxFileSizeKB: 512,
};

/** Cached configuration instance */
let configInstance: Config | null = null;

/**
 * Load configuration from environment variables
 * 
 * @returns Loaded configuration object
 */
export function loadConfig(): Config {
    configInstance = {
        artifactRoot: process.env.ARTIFACT_ROOT || DEFAULT_CONFIG.artifactRoot,
        maxFilesPerFolder: parseInt(
            process.env.MAX_FILES_PER_FOLDER || String(DEFAULT_CONFIG.maxFilesPerFolder),
            10
        ),
        maxFileSizeKB: parseInt(
            process.env.MAX_FILE_SIZE_KB || String(DEFAULT_CONFIG.maxFileSizeKB),
            10
        ),
    };

    // Validate numeric values
    if (isNaN(configInstance.maxFilesPerFolder) || configInstance.maxFilesPerFolder < 1) {
        configInstance.maxFilesPerFolder = DEFAULT_CONFIG.maxFilesPerFolder;
    }

    if (isNaN(configInstance.maxFileSizeKB) || configInstance.maxFileSizeKB < 1) {
        configInstance.maxFileSizeKB = DEFAULT_CONFIG.maxFileSizeKB;
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
