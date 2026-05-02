/**
 * Pluggable logger interface used across the application layer.
 *
 * Background: Loop 05 introduced `ScanLogger` inline in
 * `src/application/scan.ts` so the scan service could stay free of
 * `console.*` calls. Loop 06 (`viewer-data` extraction) needs the same
 * shape, so the interface promotes to `core/logger.ts` per the trigger
 * Loop 05 documented.
 *
 * Discipline: any module under `src/application/` that emits progress or
 * diagnostics MUST take a `Logger` (defaulting to `NoopLogger`) instead
 * of calling `console.*`. Callers (CLI shim, HTTP server, VS Code panel)
 * provide their own adapter at the boundary.
 *
 * Boundary: `core/logger.ts` has zero imports from outside `core/`. It is
 * a leaf module the `application/` layer (and beyond) consumes.
 */

export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

/** No-op logger used when a caller does not provide one. */
export const NoopLogger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * Convenience factory: a logger that forwards to `console.*`. Optionally
 * tagged with a `[prefix] ` so multiple subsystems can share stdout.
 *
 * Note: callers in modules under boundary discipline (e.g. anything inside
 * `src/application/`) should NOT instantiate this themselves — that would
 * reintroduce a `console.*` dependency. Use it from extension/CLI/server
 * code only, where `console.*` is already allowed.
 */
export function consoleLogger(prefix?: string): Logger {
    const tag = prefix ? `[${prefix}] ` : '';
    return {
        info: (m) => console.log(tag + m),
        warn: (m) => console.warn(tag + m),
        error: (m) => console.error(tag + m),
    };
}
