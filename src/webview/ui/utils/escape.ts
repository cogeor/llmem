/**
 * HTML escape helper for browser-side string interpolation.
 *
 * Loop 13: every filesystem-derived string (filenames, paths, labels) that
 * lands inside a `${...}` interpolation in an `innerHTML = ...` template
 * literal must pass through this function first. Otherwise a filename like
 * `<script>alert(1)</script>.ts` would execute when the worktree renders.
 *
 * The escape map covers the five characters that can break out of HTML text
 * content or attribute values: `&`, `<`, `>`, `"`, `'`. This is the same set
 * used by `lodash.escape`, `he.encode({ useNamedReferences: false })`, and
 * the OWASP HTML escape recommendation.
 */
const ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export function escape(input: string): string {
    return input.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}
