/**
 * MCP Observer — Redaction and Summarization helpers
 *
 * Pure, side-effect-free formatting utilities used by the observer
 * implementations in `observer.ts`. Split out (Loop 21) to keep the
 * observer wiring under the platform-handler line budget. The public
 * `redact` / `summarize` names are re-exported from `observer.ts` so the
 * external surface is unchanged.
 */

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
