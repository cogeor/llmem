/**
 * Tiny DOM-lookup helper for the webview shell. Loop 02.
 *
 * Replaces the `document.getElementById(id) as HTMLElement` casts that
 * silenced TypeScript's `null` warning on the ten mount-point lookups in
 * `main.ts`. If the shell ever drops or renames an ID, the cast lets a
 * `null` slide into a downstream component constructor and fail with a
 * confusing `Cannot read properties of null` deep inside a bundled file —
 * the helper surfaces the failure at the lookup site instead, with the
 * missing element's ID and a pointer back to the shell asset manifest.
 *
 * Pure DOM only — no Node imports — so it stays inside the
 * `tests/arch/browser-purity.test.ts` boundary for `src/webview/ui/**`.
 */
export function requireElement(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(
            `[webview/main] required element #${id} not found in shell. ` +
            `Check src/webview/shell-assets.ts MOUNT_POINTS — every entry must be ` +
            `emitted by renderShell().`,
        );
    }
    return el;
}
