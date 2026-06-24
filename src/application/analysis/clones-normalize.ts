/**
 * Type-1/2 clone normalization (Loop 06).
 *
 * Turns a sliced entity-body string into a canonical placeholder form so that
 * two bodies that differ only in identifier names and literal values normalize
 * to the SAME text (Type-2 equivalence). The canonical text is then sha256-ed by
 * the caller; equal hashes ⇒ a clone cluster.
 *
 * Token-based, NOT regex: we drive the TypeScript scanner with
 * `skipTrivia: true`, which drops comments AND whitespace for free and never
 * mis-parses `//` inside a string/regex literal (the classic regex pitfall).
 *
 *   - `Identifier` (and contextual-keyword identifiers) → `$ID`.
 *   - Every literal (string / template / numeric / bigint / regex) → `$LIT`.
 *   - Real keywords + punctuation → their canonical lexeme (`ts.tokenToString`),
 *     so STRUCTURE is preserved.
 *
 * Determinism: the scanner is a pure function of `body`; no `Date`/`Math.random`.
 * Importing `typescript` here is allowed — the analysis layer MAY import parser
 * per the layer matrix.
 */

import * as ts from 'typescript';
import * as crypto from 'crypto';

/** Result of normalizing one entity body. */
export interface NormalizedBody {
    /** Canonical placeholder text (deterministic). */
    text: string;
    /** Token count of the ORIGINAL body (for the noise floor). */
    tokenCount: number;
}

/** Placeholder for any identifier (Type-2: rename-insensitive). */
const ID_PLACEHOLDER = '$ID';
/** Placeholder for any literal value (Type-2: literal-value-insensitive). */
const LIT_PLACEHOLDER = '$LIT';

/**
 * The literal token kinds collapsed to `$LIT`. Replacing literals is REQUIRED
 * for Type-2 (spec §2.3: "replace identifiers + literals").
 */
const LITERAL_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
]);

/**
 * Token-based normalization of a sliced entity body (Type-1/2).
 *
 * Returns the canonical placeholder `text` plus the ORIGINAL body's token count
 * (`tokenCount`) so the caller can apply the noise floor.
 */
export function normalizeBody(body: string): NormalizedBody {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        /* skipTrivia */ true,
        ts.LanguageVariant.Standard,
        body,
    );

    const pieces: string[] = [];
    let tokenCount = 0;

    let kind = scanner.scan();
    while (kind !== ts.SyntaxKind.EndOfFileToken) {
        tokenCount++;

        if (kind === ts.SyntaxKind.Identifier) {
            pieces.push(ID_PLACEHOLDER);
        } else if (LITERAL_KINDS.has(kind)) {
            pieces.push(LIT_PLACEHOLDER);
        } else {
            // Real keyword or punctuation → canonical lexeme. `tokenToString`
            // returns undefined only for trivia / literal-bearing kinds (already
            // handled above); fall back to the raw token text defensively.
            pieces.push(ts.tokenToString(kind) ?? scanner.getTokenText());
        }

        kind = scanner.scan();
    }

    return { text: pieces.join(' '), tokenCount };
}

/** sha256 hex of a string — the one hashing impl reused across this loop. */
export function sha256Hex(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex');
}
