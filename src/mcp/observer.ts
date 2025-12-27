/**
 * MCP Observer Infrastructure
 *
 * Provides structured logging and observability for all MCP requests.
 * Follows best practices for debugging, performance monitoring, and reliability tracking.
 *
 * Pattern: Wrap every handler with withObservation() to automatically log:
 * - Request start (with redacted parameters)
 * - Request end (with result summary and duration)
 * - Request errors (with error type and message)
 *
 * Supports two output modes:
 * - JSON (default): Structured JSON to stderr for external processing
 * - Pretty: Human-readable colored output via the logger module
 */

import { createLogger } from '../common/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Request context for observability
 */
export interface ObserverContext {
    /** Unique identifier for this request */
    requestId: string;

    /** Session or workspace identifier */
    sessionId?: string;

    /** MCP method (e.g., 'tools/call', 'tools/list') */
    method: string;

    /** Tool name (when method is 'tools/call') */
    toolName?: string;

    /** Request start timestamp (milliseconds) */
    startMs: number;

    /** Additional metadata */
    meta?: Record<string, unknown>;
}

/**
 * Observer interface for handling MCP lifecycle events
 */
export interface Observer {
    /** Called when a request starts */
    onStart: (ctx: ObserverContext, params: unknown) => void;

    /** Called when a request completes successfully */
    onEnd: (ctx: ObserverContext, result: unknown) => void;

    /** Called when a request fails */
    onError: (ctx: ObserverContext, err: unknown) => void;
}

// ============================================================================
// Redaction and Summarization
// ============================================================================

/**
 * Sensitive field names that should be redacted from logs
 */
const SENSITIVE_FIELDS = new Set([
    'token',
    'apikey',
    'password',
    'secret',
    'authorization',
    'credential',
    'private',
    'privatekey',
]);

/**
 * Redact sensitive fields from parameters
 * Preserves structure but removes secrets
 */
export function redact(params: unknown): unknown {
    if (!params || typeof params !== 'object') {
        return params;
    }

    if (Array.isArray(params)) {
        return params.map(item => redact(item));
    }

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
        const lowerKey = key.toLowerCase();

        if (SENSITIVE_FIELDS.has(lowerKey)) {
            out[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            out[key] = redact(value);
        } else {
            out[key] = value;
        }
    }

    return out;
}

/**
 * Summarize result without dumping full content
 * Useful for large responses
 */
export function summarize(result: unknown): unknown {
    if (result == null) {
        return null;
    }

    if (typeof result === 'string') {
        return {
            type: 'string',
            length: result.length,
            preview: result.length > 100 ? result.slice(0, 100) + '...' : result,
        };
    }

    if (Array.isArray(result)) {
        return {
            type: 'array',
            length: result.length,
        };
    }

    if (typeof result === 'object') {
        return {
            type: 'object',
            keys: Object.keys(result).slice(0, 25),
        };
    }

    return {
        type: typeof result,
    };
}

// ============================================================================
// Observer Implementations
// ============================================================================

/**
 * JSON console observer
 * Logs structured JSON events to stderr for external processing
 */
export const jsonConsoleObserver: Observer = {
    onStart: (ctx, params) => {
        console.error(JSON.stringify({
            event: 'mcp.request.start',
            timestamp: new Date().toISOString(),
            ...ctx,
            params: redact(params),
        }));
    },

    onEnd: (ctx, result) => {
        console.error(JSON.stringify({
            event: 'mcp.request.end',
            timestamp: new Date().toISOString(),
            ...ctx,
            durationMs: Date.now() - ctx.startMs,
            resultSummary: summarize(result),
        }));
    },

    onError: (ctx, err) => {
        const error = err as Error | undefined;
        console.error(JSON.stringify({
            event: 'mcp.request.error',
            timestamp: new Date().toISOString(),
            ...ctx,
            durationMs: Date.now() - ctx.startMs,
            errorType: error?.name ?? 'Error',
            errorMessage: String(error?.message ?? err),
        }));
    },
};

/**
 * Pretty console observer
 * Logs human-readable colored output for development
 */
const mcpLogger = createLogger('mcp');

export const prettyConsoleObserver: Observer = {
    onStart: (ctx, params) => {
        const redacted = redact(params) as Record<string, unknown>;
        mcpLogger.debug(`→ ${ctx.toolName || ctx.method}`, {
            requestId: ctx.requestId,
            ...redacted,
        });
    },

    onEnd: (ctx, result) => {
        const durationMs = Date.now() - ctx.startMs;
        const summary = summarize(result) as Record<string, unknown>;
        mcpLogger.info(`✓ ${ctx.toolName || ctx.method}`, {
            requestId: ctx.requestId,
            durationMs,
            result: summary.type || 'unknown',
        });
    },

    onError: (ctx, err) => {
        const error = err as Error | undefined;
        const durationMs = Date.now() - ctx.startMs;
        mcpLogger.error(`✗ ${ctx.toolName || ctx.method}`, {
            requestId: ctx.requestId,
            durationMs,
            error: error?.message ?? String(err),
        });
    },
};

/**
 * Get the default observer based on environment
 * Uses pretty output in development, JSON in production
 */
export function getDefaultObserver(): Observer {
    const format = process.env.LOG_FORMAT || 'pretty';
    return format === 'json' ? jsonConsoleObserver : prettyConsoleObserver;
}

// ============================================================================
// Handler Wrapper
// ============================================================================

/**
 * Wrap a handler with observation
 *
 * This ensures every request is logged with proper correlation IDs,
 * timing information, and error tracking.
 *
 * @param observer - Observer instance to use
 * @param baseCtx - Base context (without startMs, which is set at call time)
 * @param handler - The actual handler function to wrap
 * @returns Wrapped handler with observation
 *
 * @example
 * ```ts
 * const handler = withObservation(
 *   jsonConsoleObserver,
 *   { requestId: crypto.randomUUID(), method: 'tools/call', toolName: 'file_info' },
 *   async (params) => {
 *     // actual implementation
 *     return result;
 *   }
 * );
 * ```
 */
export function withObservation<TParams, TResult>(
    observer: Observer,
    baseCtx: Omit<ObserverContext, 'startMs'>,
    handler: (params: TParams) => Promise<TResult>
): (params: TParams) => Promise<TResult> {
    return async (params: TParams): Promise<TResult> => {
        const ctx: ObserverContext = { ...baseCtx, startMs: Date.now() };

        observer.onStart(ctx, params);

        try {
            const result = await handler(params);
            observer.onEnd(ctx, result);
            return result;
        } catch (error) {
            observer.onError(ctx, error);
            throw error;
        }
    };
}
