/**
 * Parse the `LLMEM_INTERNAL_ONLY` env value into the `internalOnly` boolean.
 *
 * Semantics (shared by both config loaders — `runtime/config.ts` and
 * `mcp/config.ts` — so the two never drift):
 *   - unset / undefined → fall back to `defaultValue` (DEFAULT_CONFIG.internalOnly,
 *     i.e. true: internal-only is the default).
 *   - `0` or `false` (case-insensitive, trimmed) → false (INCLUDE externals).
 *   - any other non-empty value (`1`, `true`, …) → true (internal-only).
 *
 * Booleans are not numeric, so they do NOT go through the `parseInt` path the
 * other LLMEM_* knobs use; this helper centralizes the off-switch parsing.
 */
export function parseInternalOnly(
    raw: string | undefined,
    defaultValue: boolean,
): boolean {
    if (raw === undefined) {
        return defaultValue;
    }
    const v = raw.trim().toLowerCase();
    if (v === '0' || v === 'false') {
        return false;
    }
    if (v === '') {
        return defaultValue;
    }
    return true;
}
