/**
 * Pure brace/decl entity-span tracker (WS-4, Loop 04).
 *
 * Given source text, yields ordered half-open `[start, end)` offset spans for
 * class / interface / function / method declarations, plus a lookup that returns
 * the innermost enclosing entity name for a match offset. This lets the per-file
 * offset scanners (`lifecycle.ts`, `transport.ts`) attribute a candidate to the
 * owning class/method instead of just the file.
 *
 * NESTING / NAMING RULE
 * ---------------------
 *   - **Innermost wins.** `enclosingEntity` returns the name of the *smallest*
 *     span whose `[start, end)` contains `offset`. When spans nest (a method
 *     inside a class), the method span is fully contained in the class span, so
 *     the innermost is the method.
 *   - **Qualified name when cheap.** A method declared inside a `class C { … }`
 *     is named `C.method`. A top-level `function f` or a top-level `class C`
 *     (matched at the class line itself, before any method) is named `f` / `C`.
 *     The enclosing class name is already on the brace stack, so qualification
 *     is near-zero cost and disambiguates same-named methods across classes in a
 *     single file.
 *   - A match offset outside every span → `enclosingEntity` returns `undefined`
 *     (the scanner then uses the plain `fileId`).
 *
 * IMPLEMENTATION — brace/decl counting ONLY. No `typescript`/parser import, no
 * runtime dependency. A single forward scan maintains a brace-depth stack; each
 * `{` is paired with a just-seen declaration (if any) and popped on its matching
 * `}`, recording `end = indexOfClosingBrace + 1`. This is cheap-and-honest, not a
 * real parser: it may miss exotic forms (arrow-assigned methods, computed names),
 * and a missed span simply means the match falls back to `fileId` — never a
 * crash, never a wrong file. The scan is O(n) and allocation-light.
 *
 * PURITY: no `Date`, no `Math.random`, no IO. Deterministic — same text in →
 * same `EntitySpan[]` (spans in scan order); `enclosingEntity` picks the smallest
 * containing span, preferring the later/innermost `start` on a tie.
 */

export interface EntitySpan {
    /** Qualified where cheap (`Class.method`); else bare `function`/`Class`. */
    readonly name: string;
    /** Inclusive offset of the decl keyword / name. */
    readonly start: number;
    /** Exclusive offset just past the decl's closing brace. */
    readonly end: number;
}

/** A frame on the brace-depth stack. */
interface Frame {
    /** Decl name (qualified for methods); `undefined` for an anonymous block. */
    readonly name: string | undefined;
    /** True when this frame is a `class`/`interface` body (gates method matching). */
    readonly isClass: boolean;
    /** Offset of the decl keyword/name (span start when `name` is defined). */
    readonly start: number;
}

const CLASS_DECL =
    /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface)\s+([\w$]+)/y;
const FUNCTION_DECL =
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/y;
const METHOD_DECL =
    /(?:(?:public|private|protected|static|abstract|readonly|async|get|set)\s+)*([\w$]+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^={;]+)?\{/y;

/** Keywords whose `kw (...) {` shape would otherwise look like a method decl. */
const CONTROL_KEYWORDS = new Set([
    'if',
    'for',
    'while',
    'switch',
    'catch',
    'return',
    'function',
    'do',
    'else',
]);

/**
 * Compute the ordered `[start, end)` spans for class/interface/function/method
 * declarations in `text`. Spans are returned in scan order (by opening offset).
 */
export function entitySpans(text: string): EntitySpan[] {
    const spans: EntitySpan[] = [];
    const stack: Frame[] = [];
    // Pending declaration whose body `{` we are still walking toward.
    let pending: { name: string; isClass: boolean; start: number } | undefined;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (ch === '{') {
            if (pending) {
                stack.push({ name: pending.name, isClass: pending.isClass, start: pending.start });
                pending = undefined;
            } else {
                // Anonymous block (object literal, plain block, arrow body): track
                // depth only — no name, so it records no span on pop.
                stack.push({ name: undefined, isClass: false, start: i });
            }
            continue;
        }

        if (ch === '}') {
            const frame = stack.pop();
            if (frame && frame.name !== undefined) {
                spans.push({ name: frame.name, start: frame.start, end: i + 1 });
            }
            continue;
        }

        // While a decl is pending, just walk to its `{`.
        if (pending) {
            continue;
        }

        const enclosing = stack.length > 0 ? stack[stack.length - 1] : undefined;

        // class / interface (at any depth).
        CLASS_DECL.lastIndex = i;
        const cls = CLASS_DECL.exec(text);
        if (cls && cls.index === i) {
            pending = { name: cls[1], isClass: true, start: i };
            i = CLASS_DECL.lastIndex - 1;
            continue;
        }

        // function declaration (at any depth).
        FUNCTION_DECL.lastIndex = i;
        const fn = FUNCTION_DECL.exec(text);
        if (fn && fn.index === i) {
            pending = { name: fn[1], isClass: false, start: i };
            i = FUNCTION_DECL.lastIndex - 1;
            continue;
        }

        // method — only when the current top-of-stack frame is a class body.
        if (enclosing && enclosing.isClass) {
            METHOD_DECL.lastIndex = i;
            const m = METHOD_DECL.exec(text);
            if (m && m.index === i && !CONTROL_KEYWORDS.has(m[1])) {
                const qualified = enclosing.name
                    ? `${enclosing.name}.${m[1]}`
                    : m[1];
                // METHOD_DECL consumed up to and including its `{`, so push the
                // method frame directly (the brace is already eaten).
                stack.push({ name: qualified, isClass: false, start: i });
                i = METHOD_DECL.lastIndex - 1;
                continue;
            }
        }
    }

    return spans;
}

/**
 * Return the name of the innermost (smallest) span whose `[start, end)` contains
 * `offset`, or `undefined` when `offset` is outside every span. On a tie in size,
 * the later/innermost `start` wins (deterministic).
 */
export function enclosingEntity(
    spans: EntitySpan[],
    offset: number,
): string | undefined {
    let best: EntitySpan | undefined;
    for (const span of spans) {
        if (offset < span.start || offset >= span.end) {
            continue;
        }
        if (best === undefined) {
            best = span;
            continue;
        }
        const bestSize = best.end - best.start;
        const size = span.end - span.start;
        if (size < bestSize || (size === bestSize && span.start > best.start)) {
            best = span;
        }
    }
    return best?.name;
}
