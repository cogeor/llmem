/**
 * Shared-literal payload extraction — clone Tier 1.5 (Loop 07).
 *
 * Tier-1 (`clones-normalize.ts`) erases literal VALUES (every literal → `$LIT`)
 * so two functions sharing the SAME string/array/regex/numeric payload but with
 * a different body shape are invisible. This helper collects the literal PAYLOADS
 * of a sliced entity body so identical payloads across >=2 distinct functions can
 * be flagged as a shared-literal clone (connascence of meaning — spec §2.3).
 *
 * NO second parse pass: like `normalizeBody`, this drives a SECOND tiny
 * `ts.createScanner` over the SAME already-sliced `body` string. There is no
 * `ts.Program`, no AST walk — the scanner is token-level and a pure function of
 * `body`. The caller folds this into the existing cache-MISS branch, so a warm
 * (all-hit) run still parses zero files.
 *
 * Literal kinds collected (canonical payload per occurrence):
 *   - `StringLiteral` / `NoSubstitutionTemplateLiteral` → `getTokenValue()` (the
 *     DECODED contents — quote-style-insensitive, so `'a'` and `"a"` collide).
 *     Substitution-template fragments (Head/Middle/Tail) are SKIPPED: they are
 *     interpolations, not fixed payloads.
 *   - `RegularExpressionLiteral` → `getTokenText()` (the raw `/.../flags` source;
 *     regex has no decoded scanner value). This is what catches `/\\/g`.
 *   - `NumericLiteral` → `getTokenValue()` (the scanner's normalized numeric text,
 *     used verbatim).
 *   - ARRAY literals — the token-level scanner emits NO `ArrayLiteralExpression`
 *     (that is an AST node). On an `OpenBracketToken` we collect the canonical
 *     token run up to the MATCHING `CloseBracketToken` (tracking `[]`/`{}`/`()`
 *     nesting depth) and hash that bracketed run as ONE array payload. Scalar
 *     literals inside keep their decoded value; identifiers/keywords keep their
 *     lexeme — so a workspace-marker array like `['.git', 'package.json', ...]`
 *     yields a stable array payload identical across files, with no AST. The
 *     array's scalar string elements are ALSO emitted individually as `str:`
 *     payloads — that is fine (recall-first; the array payload is the strong
 *     signal, the single elements are ranked low by the noise floor).
 *
 * Kind-prefixing: each canonical payload is prefixed with its kind tag (`str:`,
 * `arr:`, `re:`, `num:`) BEFORE hashing, so a numeric `42` never collides with a
 * string `"42"`, and the prefix on the returned hash IS the recoverable
 * `sharedKind` (no parallel map needed downstream).
 *
 * Noise floor (per-payload length, NOT per-entity — spec §2.3): skip
 *   - empty / single-character string payloads (decoded length < 2),
 *   - single-character numeric payloads (single-digit `0..9`),
 *   - empty `[]` and single-element arrays (not a meaningful shared structure).
 * Do NOT pre-exclude by severity/frequency: the pervasive `replace(/\\/g, '/')`
 * idiom MUST be emitted (high recall), it is merely ranked low later.
 *
 * Determinism: returns the SORTED list of kind-prefixed sha256 hashes so the
 * cached `literalHashes` array is byte-stable run-to-run.
 *
 * Layer: application — may import parser (`typescript`) per the layer matrix.
 */

import * as ts from 'typescript';
import { sha256Hex } from './clones-normalize';
import type { CloneFinding, Severity } from './types';
import type { CloneEdge } from '../../graph/edgelist';

/** Kind tag carried on the returned hash (the recoverable `sharedKind`). */
export type LiteralKindTag = 'str' | 'arr' | 're' | 'num';

/** Map a `str:`/`arr:`/`re:`/`num:` prefix back to the `sharedKind` discriminator. */
export type SharedKind = 'string' | 'array' | 'regex' | 'numeric';

const TAG_TO_KIND: Record<LiteralKindTag, SharedKind> = {
    str: 'string',
    arr: 'array',
    re: 'regex',
    num: 'numeric',
};

/** Recover the `sharedKind` from a kind-prefixed literal hash (`arr:<sha>` → 'array'). */
export function sharedKindOf(prefixedHash: string): SharedKind | undefined {
    const tag = prefixedHash.split(':', 1)[0] as LiteralKindTag;
    return TAG_TO_KIND[tag];
}

/** Hash a canonical payload under its kind tag → `<tag>:<sha256>`. */
function tagged(tag: LiteralKindTag, payload: string): string {
    return `${tag}:${sha256Hex(payload)}`;
}

/**
 * Collect the canonical token run of an array literal starting AFTER an
 * `OpenBracketToken` has been consumed. Advances the scanner to (and consumes)
 * the matching `CloseBracketToken`, tracking `[]`/`{}`/`()` nesting. Returns the
 * joined canonical run AND the count of top-level commas (a proxy for element
 * count used by the floor). Scalar literals keep their decoded value;
 * everything else keeps its lexeme.
 */
function scanArrayRun(scanner: ts.Scanner): { run: string; topLevelCommas: number } {
    const pieces: string[] = [];
    let depth = 0; // nesting INSIDE this array (0 == array's own level)
    let topLevelCommas = 0;

    let kind = scanner.scan();
    while (kind !== ts.SyntaxKind.EndOfFileToken) {
        if (kind === ts.SyntaxKind.CloseBracketToken && depth === 0) {
            break; // matching close — done with this array
        }

        if (
            kind === ts.SyntaxKind.OpenBracketToken ||
            kind === ts.SyntaxKind.OpenBraceToken ||
            kind === ts.SyntaxKind.OpenParenToken
        ) {
            depth++;
        } else if (
            kind === ts.SyntaxKind.CloseBracketToken ||
            kind === ts.SyntaxKind.CloseBraceToken ||
            kind === ts.SyntaxKind.CloseParenToken
        ) {
            depth--;
        } else if (kind === ts.SyntaxKind.CommaToken && depth === 0) {
            topLevelCommas++;
        }

        // Canonical piece: scalar literals → decoded value; else → lexeme.
        if (
            kind === ts.SyntaxKind.StringLiteral ||
            kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
            kind === ts.SyntaxKind.NumericLiteral
        ) {
            pieces.push(scanner.getTokenValue());
        } else {
            pieces.push(scanner.getTokenText());
        }

        kind = scanner.scan();
    }

    return { run: pieces.join(''), topLevelCommas };
}

/**
 * Extract the SORTED, kind-prefixed sha256 hashes of every literal payload in a
 * sliced entity body. Pure; a second cheap scanner over the same `body` (no AST,
 * no Program). See the file header for the kind set + noise floor.
 */
export function extractLiteralHashes(body: string): string[] {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        /* skipTrivia */ true,
        ts.LanguageVariant.Standard,
        body,
    );

    const hashes: string[] = [];

    let kind = scanner.scan();
    while (kind !== ts.SyntaxKind.EndOfFileToken) {
        // The scanner emits `/` as `SlashToken` (division is the default reading);
        // a regex literal is only recovered by re-scanning the slash. We have no
        // parser context, so eagerly re-scan every slash — if it forms a valid
        // regex literal the kind flips, otherwise it stays a slash (harmless).
        if (
            kind === ts.SyntaxKind.SlashToken ||
            kind === ts.SyntaxKind.SlashEqualsToken
        ) {
            kind = scanner.reScanSlashToken();
        }

        if (kind === ts.SyntaxKind.OpenBracketToken) {
            // Array payload — consume the bracketed run (advances the scanner).
            const { run, topLevelCommas } = scanArrayRun(scanner);
            // Element count ~= topLevelCommas + 1 for a non-empty array; skip
            // empty `[]` (empty run) and single-element arrays (no top-level
            // comma) — not a meaningful shared structure.
            if (run.length > 0 && topLevelCommas >= 1) {
                hashes.push(tagged('arr', run));
            }
            kind = scanner.scan();
            continue;
        }

        if (
            kind === ts.SyntaxKind.StringLiteral ||
            kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
        ) {
            const v = scanner.getTokenValue();
            if (v.length >= 2) hashes.push(tagged('str', v)); // skip ''/single-char
        } else if (kind === ts.SyntaxKind.NumericLiteral) {
            const v = scanner.getTokenValue();
            if (v.length >= 2) hashes.push(tagged('num', v)); // skip single-digit
        } else if (kind === ts.SyntaxKind.RegularExpressionLiteral) {
            const raw = scanner.getTokenText();
            if (raw.length >= 2) hashes.push(tagged('re', raw));
        }

        kind = scanner.scan();
    }

    return hashes.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Shared-literal bucketing (Tier 1.5). Lives here (not in clones.ts) so that
// file stays within budget; clones.ts imports `EntityHash`/`clusterSeverity`/
// `clusterSharedLiterals` from here (one-directional — no import cycle).
// ---------------------------------------------------------------------------

/** Minimal per-entity shape the PURE bucketing fns need (testable w/o parse/IO). */
export interface EntityHash {
    entityId: string; // <fileId>::<name>[@offset]
    fileId: string; // workspace-rel POSIX
    normalizedHash: string; // sha256 of normalizeBody().text
    tokenCount: number; // for the noise floor
    literalHashes: string[]; // Loop 07: kind-prefixed literal-payload hashes
}

// Severity/distance ranking lives in `clones-severity.ts` (extracted to keep
// this file within its layer budget); re-exported here so `clones.ts` and
// tests keep one import site for the bucketing toolkit.
export { clusterSeverity, distanceNote, isTestFile } from './clones-severity';
import { clusterSeverity, distanceNote } from './clones-severity';

/**
 * Consecutive-chain clone edges (n-1, deterministic — avoids O(n²) on large
 * boilerplate clusters). Shared by both bucketing passes; `sharedKind` set only
 * for shared-literal edges.
 */
export function chainEdges(
    memberIds: string[],
    severity: Severity,
    cloneType: 'exact-body' | 'shared-literal',
    sharedKind?: SharedKind,
): CloneEdge[] {
    const out: CloneEdge[] = [];
    for (let i = 0; i + 1 < memberIds.length; i++) {
        out.push({
            source: memberIds[i],
            target: memberIds[i + 1],
            kind: 'clone',
            similarity: 1,
            cloneType,
            ...(sharedKind ? { sharedKind } : {}),
            severity,
        });
    }
    return out;
}

/** In-place deterministic order: findings by id, edges by source then target. */
export function sortFindingsEdges(findings: CloneFinding[], edges: CloneEdge[]): void {
    findings.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort(
        (a, b) =>
            a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
    );
}

/**
 * PURE: bucket entities by shared LITERAL payload into shared-literal clusters +
 * clone edges (Tier 1.5, Loop 07). No IO, no parse.
 *
 * A kind-prefixed payload hash held by >=2 DISTINCT functions is a shared-literal
 * clone (the same hash twice in one entity does NOT count). STRENGTH is carried
 * by `cloneType` (shared-literal ranks BELOW exact-body, ABOVE shape-only);
 * DISTANCE by `severity` via the SAME `clusterSeverity` scale — so a cross-layer
 * shared literal (e.g. the `markers` array) is HIGH. Recall-first: EVERY shared
 * payload is emitted — the pervasive `replace(/\\/g,'/')` idiom is FOUND (ranked
 * low), never filtered. The `sharedKind` is recovered from the hash prefix.
 */
export function clusterSharedLiterals(entities: EntityHash[]): {
    findings: CloneFinding[];
    edges: CloneEdge[];
} {
    // Invert: literal-hash → entities carrying it, deduping the hash WITHIN an
    // entity (a payload twice in one fn is not cross-function sharing).
    const buckets = new Map<string, EntityHash[]>();
    for (const e of entities) {
        const seen = new Set<string>();
        for (const h of e.literalHashes) {
            if (seen.has(h)) continue;
            seen.add(h);
            const bucket = buckets.get(h);
            if (bucket) bucket.push(e);
            else buckets.set(h, [e]);
        }
    }

    const findings: CloneFinding[] = [];
    const edges: CloneEdge[] = [];

    for (const [hash, members] of buckets) {
        if (new Set(members.map(m => m.entityId)).size < 2) continue; // >=2 distinct fns

        members.sort((a, b) => a.entityId.localeCompare(b.entityId));
        const memberIds = members.map(m => m.entityId);
        const relatedFiles = [...new Set(members.map(m => m.fileId))].sort();
        const severity = clusterSeverity(members);
        const sharedKind = sharedKindOf(hash);
        // Hash in the id keeps distinct payloads over the same member set distinct.
        const id = `clone-lit:${hash}:${memberIds.join('|')}`;

        findings.push({
            id,
            type: 'clone',
            cloneType: 'shared-literal',
            sharedKind,
            similarity: 1,
            severity,
            title: `${memberIds.length}-member shared-literal clone [${sharedKind}]${distanceNote(severity)}`,
            detail:
                `Shared ${sharedKind} literal payload across ${memberIds.length} entities: ` +
                memberIds.join(', '),
            relatedFiles,
            members: memberIds,
        });
        edges.push(...chainEdges(memberIds, severity, 'shared-literal', sharedKind));
    }

    sortFindingsEdges(findings, edges);
    return { findings, edges };
}
