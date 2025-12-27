/**
 * Structured Logger
 *
 * Provides leveled, colored console logging for LLMem.
 * Supports both human-readable and JSON output formats.
 *
 * Usage:
 *   import { logger, createLogger } from './common/logger';
 *
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Failed to parse', { file: 'foo.ts', error: err.message });
 *
 *   // Create scoped logger
 *   const log = createLogger('mcp');
 *   log.debug('Processing request', { tool: 'file_info' });
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    level: LogLevel;
    scope: string;
    message: string;
    data?: Record<string, unknown>;
    timestamp: string;
    durationMs?: number;
}

export interface LoggerConfig {
    /** Minimum level to log (default: 'info') */
    level: LogLevel;
    /** Output format: 'pretty' for console, 'json' for structured (default: 'pretty') */
    format: 'pretty' | 'json';
    /** Whether to include timestamps (default: true) */
    timestamps: boolean;
    /** Custom output function (default: console.error for MCP compatibility) */
    output?: (line: string) => void;
}

// ============================================================================
// Log Level Utilities
// ============================================================================

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: '\x1b[90m',  // gray
    info: '\x1b[36m',   // cyan
    warn: '\x1b[33m',   // yellow
    error: '\x1b[31m',  // red
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

// ============================================================================
// Global Configuration
// ============================================================================

let globalConfig: LoggerConfig = {
    level: (process.env.LOG_LEVEL as LogLevel) || 'info',
    format: (process.env.LOG_FORMAT as 'pretty' | 'json') || 'pretty',
    timestamps: true,
    output: (line) => console.error(line),
};

/**
 * Configure global logger settings
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
    globalConfig = { ...globalConfig, ...config };
}

/**
 * Set log level at runtime
 */
export function setLogLevel(level: LogLevel): void {
    globalConfig.level = level;
}

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
    return globalConfig.level;
}

// ============================================================================
// Formatting
// ============================================================================

function formatTimestamp(): string {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    const ms = now.getMilliseconds().toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

function formatData(data: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue;
        const strVal = typeof value === 'string' ? value : JSON.stringify(value);
        // Truncate long values
        const display = strVal.length > 80 ? strVal.slice(0, 77) + '...' : strVal;
        parts.push(`${key}=${display}`);
    }
    return parts.join(' ');
}

function formatPretty(entry: LogEntry): string {
    const color = LEVEL_COLORS[entry.level];
    const label = LEVEL_LABELS[entry.level];

    const parts: string[] = [];

    // Timestamp
    if (globalConfig.timestamps) {
        parts.push(`${DIM}${entry.timestamp}${RESET}`);
    }

    // Level
    parts.push(`${color}${label}${RESET}`);

    // Scope
    if (entry.scope) {
        parts.push(`${DIM}[${entry.scope}]${RESET}`);
    }

    // Message
    parts.push(entry.message);

    // Duration
    if (entry.durationMs !== undefined) {
        parts.push(`${DIM}(${entry.durationMs}ms)${RESET}`);
    }

    // Data
    if (entry.data && Object.keys(entry.data).length > 0) {
        parts.push(`${DIM}${formatData(entry.data)}${RESET}`);
    }

    return parts.join(' ');
}

function formatJson(entry: LogEntry): string {
    return JSON.stringify({
        ts: entry.timestamp,
        level: entry.level,
        scope: entry.scope || undefined,
        msg: entry.message,
        ...entry.data,
        durationMs: entry.durationMs,
    });
}

// ============================================================================
// Logger Class
// ============================================================================

export class Logger {
    constructor(private scope: string = '') {}

    private shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[globalConfig.level];
    }

    private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
        if (!this.shouldLog(level)) return;

        const entry: LogEntry = {
            level,
            scope: this.scope,
            message,
            data,
            timestamp: formatTimestamp(),
        };

        const line = globalConfig.format === 'json'
            ? formatJson(entry)
            : formatPretty(entry);

        globalConfig.output?.(line);
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.log('debug', message, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.log('info', message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.log('warn', message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.log('error', message, data);
    }

    /**
     * Create a child logger with additional scope
     */
    child(childScope: string): Logger {
        const newScope = this.scope ? `${this.scope}:${childScope}` : childScope;
        return new Logger(newScope);
    }

    /**
     * Time an async operation
     */
    async time<T>(
        message: string,
        fn: () => Promise<T>,
        data?: Record<string, unknown>
    ): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            const durationMs = Date.now() - start;
            this.log('info', message, { ...data, durationMs });
            return result;
        } catch (error) {
            const durationMs = Date.now() - start;
            this.log('error', `${message} (failed)`, {
                ...data,
                durationMs,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Time a sync operation
     */
    timeSync<T>(
        message: string,
        fn: () => T,
        data?: Record<string, unknown>
    ): T {
        const start = Date.now();
        try {
            const result = fn();
            const durationMs = Date.now() - start;
            this.log('info', message, { ...data, durationMs });
            return result;
        } catch (error) {
            const durationMs = Date.now() - start;
            this.log('error', `${message} (failed)`, {
                ...data,
                durationMs,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}

// ============================================================================
// Factory and Default Instance
// ============================================================================

/**
 * Create a scoped logger
 */
export function createLogger(scope: string): Logger {
    return new Logger(scope);
}

/**
 * Default global logger (no scope)
 */
export const logger = new Logger();

// ============================================================================
// Convenience Exports
// ============================================================================

export default logger;
