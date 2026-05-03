// tests/arch/html-safety.test.ts
//
// Loop 13 safety net for browser-side `innerHTML = ...` assignments.
//
// Every `innerHTML = <expression>` in `src/webview/ui/**/*.ts` must satisfy
// at least one of the following, otherwise this test fails:
//
//   1. The right-hand side is a string LITERAL with no `${...}` interpolation
//      (`elem.innerHTML = '';` or `elem.innerHTML = '<div>static</div>';`).
//   2. The right-hand side is a call to `sanitizeHtml(...)` or `escape(...)`,
//      or a CallExpression whose final argument boils down to one of those.
//      We accept the simpler heuristic: the source line text contains
//      `sanitizeHtml(` or the value's name starts with `safe`.
//   3. The line immediately above the assignment contains a `// safe:` comment
//      explicitly justifying the assignment (author-controlled SVG, empty
//      string, controlled-union ternary, escape-pre-formatted, etc.).
//
// The first two are static patterns. The third is an opt-out for cases where
// the value is genuinely safe but the static analysis cannot see it; the
// human-readable reason in the `// safe:` comment is the audit trail.
//
// Files exempt from scanning:
//   - The escape/sanitize utils themselves (`utils/escape.ts`, `utils/sanitize.ts`)
//     — they are the implementations of the helpers, not callers.
//   - This test file (lives under tests/arch, not src/webview/ui, so already
//     out of scope by the include glob).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBVIEW_UI_ROOT = path.join(REPO_ROOT, 'src', 'webview', 'ui');

const EXEMPT_RELATIVE_PATHS: readonly string[] = [
    'utils/escape.ts',
    'utils/sanitize.ts',
];

interface InnerHtmlAssignment {
    readonly file: string;        // repo-relative posix path
    readonly lineNumber: number;  // 1-based
    readonly lineText: string;    // raw line content, trimmed
    readonly rhs: string;         // right-hand side text, trimmed
    readonly prevCommentLine: string | null;
}

function toRepoRel(absPath: string): string {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function shouldSkipFile(name: string): boolean {
    if (name.endsWith('.d.ts')) return true;
    if (name.endsWith('.test.ts')) return true;
    return !name.endsWith('.ts');
}

function walkUi(root: string, out: string[] = []): string[] {
    if (!fs.existsSync(root)) return out;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
            walkUi(full, out);
        } else if (entry.isFile() && !shouldSkipFile(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

function isExempt(absPath: string): boolean {
    const rel = path.relative(WEBVIEW_UI_ROOT, absPath).replace(/\\/g, '/');
    return EXEMPT_RELATIVE_PATHS.includes(rel);
}

// Find every line in the file that contains an `innerHTML = ...` assignment.
// We deliberately keep this regex permissive (matches `.innerHTML = ...`,
// `[...].innerHTML = ...`, etc.) and rely on the safety classifier to
// distinguish safe forms from unsafe ones.
const INNERHTML_ASSIGN = /\.innerHTML\s*=\s*(.+?);?\s*$/;

function findInnerHtmlAssignments(filePath: string): InnerHtmlAssignment[] {
    const source = fs.readFileSync(filePath, 'utf-8');
    const lines = source.split(/\r?\n/);
    const found: InnerHtmlAssignment[] = [];
    const fileRel = toRepoRel(filePath);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip lines that are obviously inside a string/comment context.
        // A simple heuristic: trim and check for `*` (block comment continuation)
        // or `//` (only line comment) or string-prefixed text. We catch
        // false positives via the safety classifier below.
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

        const match = line.match(INNERHTML_ASSIGN);
        if (!match) continue;

        // Skip non-assignments such as comparisons (e.g. `=== '...'`) — the
        // regex `.innerHTML\s*=\s*` only matches single `=`, so this is
        // already filtered, but be defensive against `==` slipping through.
        if (line.includes('.innerHTML ==')) continue;

        const rhs = match[1].trim();
        // Walk upward through consecutive comment lines (`//` or block-comment
        // continuation lines starting with `*` / `/*`). Stop at the first
        // non-comment, non-blank line. The recorded `prevCommentLine` is the
        // first line in that block that mentions a `safe:` annotation, or
        // the last comment line scanned (so the diagnostic still has context).
        let prevCommentLine: string | null = null;
        for (let j = i - 1; j >= 0; j--) {
            const prev = lines[j].trim();
            if (prev === '') {
                // Blank line ends the comment block.
                break;
            }
            const isCommentLine =
                prev.startsWith('//') ||
                prev.startsWith('*') ||
                prev.startsWith('/*');
            if (!isCommentLine) break;
            // Capture the first matching `safe:` line we encounter, so the
            // classifier sees it later. If none matches, fall through with the
            // last line we scanned (for diagnostic context).
            if (/safe\s*:/i.test(prev)) {
                prevCommentLine = prev;
                break;
            }
            prevCommentLine = prev;
        }

        found.push({
            file: fileRel,
            lineNumber: i + 1,
            lineText: line.trim(),
            rhs,
            prevCommentLine,
        });
    }

    return found;
}

function isStringLiteralWithoutInterpolation(rhs: string): boolean {
    // Must start with `'`, `"` or backtick, end with same, no `${` inside the
    // template literal case.
    if (rhs.startsWith("'") || rhs.startsWith('"')) {
        // Single-line single/double quoted literal — find the closing quote.
        const quote = rhs[0];
        const end = rhs.lastIndexOf(quote);
        return end > 0; // anything else is a literal; no `${...}` is possible.
    }
    if (rhs.startsWith('`')) {
        // Template literal. Reject if it contains `${`.
        return !rhs.includes('${');
    }
    return false;
}

function isSafeAnnotated(prevCommentLine: string | null): boolean {
    if (prevCommentLine === null) return false;
    // Accept `// safe: <reason>` (and `// safe:` alone) on the immediately
    // preceding non-blank line. We also accept block-comment forms like
    // `/* safe: ... */` and `* safe:` for documentation-style comments.
    if (/^\/\/\s*safe\s*:/i.test(prevCommentLine)) return true;
    if (/^\*\s*safe\s*:/i.test(prevCommentLine)) return true;
    if (/^\/\*\s*safe\s*:/i.test(prevCommentLine)) return true;
    return false;
}

function isSanitizerCall(rhs: string): boolean {
    // Strip a trailing semicolon if any.
    const rhsClean = rhs.replace(/;\s*$/, '').trim();
    // Direct call patterns:
    //   sanitizeHtml(...)
    //   escape(...)
    //   <prefix>sanitizeHtml(...)  e.g. utils.sanitizeHtml(arg)
    if (/(^|[.\s])sanitizeHtml\s*\(/.test(rhsClean)) return true;
    if (/(^|[.\s])escape\s*\(/.test(rhsClean)) return true;
    return false;
}

function classify(a: InnerHtmlAssignment): { safe: boolean; reason: string } {
    if (isStringLiteralWithoutInterpolation(a.rhs)) {
        return { safe: true, reason: 'string literal without interpolation' };
    }
    if (isSanitizerCall(a.rhs)) {
        return { safe: true, reason: 'sanitizer/escape call' };
    }
    if (isSafeAnnotated(a.prevCommentLine)) {
        return { safe: true, reason: '// safe: annotation' };
    }
    return { safe: false, reason: 'unannotated, non-literal, non-sanitized' };
}

test('html-safety: every innerHTML = ... assignment is sanitized, escaped, literal, or annotated', () => {
    const allFiles = walkUi(WEBVIEW_UI_ROOT)
        .filter((abs) => !isExempt(abs));

    const violations: Array<InnerHtmlAssignment & { reason: string }> = [];

    for (const filePath of allFiles) {
        const assignments = findInnerHtmlAssignments(filePath);
        for (const a of assignments) {
            const verdict = classify(a);
            if (!verdict.safe) {
                violations.push({ ...a, reason: verdict.reason });
            }
        }
    }

    if (violations.length > 0) {
        for (const v of violations) {
            console.error(
                `HTML-UNSAFE  ${v.file}:${v.lineNumber}\n  ` +
                    `${v.lineText}\n  ` +
                    `reason: ${v.reason}\n  ` +
                    `Wrap the value in sanitizeHtml(...) (markdown HTML), escape(...) ` +
                    `(filesystem-derived strings), or annotate the line above with ` +
                    `\`// safe: <reason>\` if the value is genuinely safe.`
            );
        }
        assert.fail(
            `${violations.length} unsafe innerHTML assignment(s) detected in src/webview/ui/. ` +
                `See console.error above.`
        );
    }
});
