/**
 * B2 — interface-width signal (WS-4), feeding FI1 + ENC5.
 *
 * Scans each in-scope source for `interface <Name> { ... }` and
 * `type <Name> = { ... }` declarations, counts the top-level members and how
 * many are optional (`?:`), and emits a candidate when the shape is "wide":
 *   - member count ≥ 7, OR
 *   - member count ≥ 5 AND optional share ≥ 0.5.
 *
 * This is the regex-review-time approximation of the extraction-plan's B2
 * interface-width pass (caller-subset disjointness is out of regex reach;
 * member/optional count alone catches the God-facade providers — e.g. a
 * `DataProvider` with 7+ optional members, a `MessageRouterContext` with 12).
 *
 * Body extraction is brace-matched: from the opening `{` we walk to the matching
 * close, so nested member shapes (`cb: () => void`, `x: { a: 1 }`) don't truncate
 * the body early. Members are counted at brace-depth 1 only, so nested object
 * shapes don't inflate the count.
 *
 * Feeds two registry items with the SAME candidates:
 *   - FI1 (God-facade provider): the frontend framing (●●●).
 *   - ENC5 (Fat / optional-method interfaces, ISP): the generic framing (●●○).
 *
 * Recall is noisy by construction; the LLM filter judges genuine ISP violation
 * vs a legitimately cohesive wide type. Emits one candidate per
 * (file, declared interface/type-literal) pair.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * Match the head of an object-typed declaration up to its opening brace:
 *   - `interface Name {`
 *   - `interface Name extends X, Y {`
 *   - `type Name = {`
 *   - `type Name<T> = {`
 * Captures the declared name. The trailing `{` is consumed so the scan resumes
 * at the body's first char.
 */
const DECL_HEAD_RE =
    /\b(?:interface\s+([A-Za-z_$][\w$]*)[^={]*|type\s+([A-Za-z_$][\w$]*)[^={]*=\s*)\{/g;

/** One discovered object-typed declaration: its name and balanced body text. */
interface DeclBlock {
    readonly name: string;
    readonly body: string;
}

/**
 * From `text[openBraceIdx]` (the `{`), return the index of the matching close
 * brace, or -1 if the braces never balance (truncated/garbled source). Strings,
 * comments, and template literals are NOT parsed — a pragmatic depth count over
 * raw braces is enough for the recall half, and is deterministic.
 */
function matchBrace(text: string, openBraceIdx: number): number {
    let depth = 0;
    for (let i = openBraceIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Collect every `interface`/`type = {` declaration in one source, in source
 * order, with its brace-matched body. Order does not matter for determinism
 * (`runSignalScanners` re-sorts) but keeps one candidate per declaration.
 */
function declBlocksIn(text: string): DeclBlock[] {
    const blocks: DeclBlock[] = [];
    // A fresh regex per call avoids shared `lastIndex` state across files.
    const re = new RegExp(DECL_HEAD_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const name = m[1] ?? m[2];
        if (!name) {
            continue;
        }
        const openIdx = m.index + m[0].length - 1; // index of the matched `{`
        const closeIdx = matchBrace(text, openIdx);
        if (closeIdx < 0) {
            continue;
        }
        blocks.push({ name, body: text.slice(openIdx + 1, closeIdx) });
        // Resume scanning AFTER this block's close so a nested `type X = {`
        // inside the body isn't double-counted as a top-level declaration.
        re.lastIndex = closeIdx + 1;
    }
    return blocks;
}

/** Counted shape of one declaration body. */
interface MemberCount {
    readonly members: number;
    readonly optional: number;
}

/**
 * Count top-level members in a declaration body. A "member" is a top-level
 * `name:` / `name?:` / method signature (`name(...)`/`name?(...)`). Only the
 * outermost brace depth is counted, so nested object shapes (`x: { a: 1 }`,
 * `cb: () => { ... }`) contribute exactly one member, not their innards.
 *
 * Strategy: split the body into top-level member chunks by walking it and
 * cutting on `;`, `,`, or newline whenever brace/paren/bracket/angle depth is 0.
 * Each non-blank chunk that opens with an identifier followed by `?`(opt), `:`,
 * `(`, or `<` is a member; a leading `?` before `:`/`(` marks it optional.
 */
function countMembers(body: string): MemberCount {
    const chunks: string[] = [];
    let cur = '';
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{' || ch === '(' || ch === '[' || ch === '<') {
            depth++;
            cur += ch;
        } else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') {
            if (depth > 0) {
                depth--;
            }
            cur += ch;
        } else if ((ch === ';' || ch === ',' || ch === '\n') && depth === 0) {
            chunks.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    chunks.push(cur);

    let members = 0;
    let optional = 0;
    // A member chunk: optional `readonly`, an identifier (or string/quoted key),
    // then `?` (optional), `:` (property), or `(` (method).
    const memberRe = /^(?:readonly\s+)?(?:[A-Za-z_$][\w$]*|'[^']*'|"[^"]*"|\[[^\]]*\])(\??)\s*[:(<]/;
    for (const raw of chunks) {
        const chunk = stripLeadingComments(raw).trim();
        if (chunk.length === 0) {
            continue;
        }
        const mm = memberRe.exec(chunk);
        if (!mm) {
            continue;
        }
        members++;
        if (mm[1] === '?') {
            optional++;
        }
    }
    return { members, optional };
}

/**
 * Drop leading `//` line comments and `/* *\/` block comments from a member
 * chunk so a documented member is still counted by its declaration, not skipped
 * as a comment line. Only leading whitespace+comment runs are stripped.
 */
function stripLeadingComments(chunk: string): string {
    let s = chunk;
    for (;;) {
        const t = s.replace(/^\s+/, '');
        if (t.startsWith('//')) {
            const nl = t.indexOf('\n');
            s = nl < 0 ? '' : t.slice(nl + 1);
            continue;
        }
        if (t.startsWith('/*')) {
            const end = t.indexOf('*/');
            s = end < 0 ? '' : t.slice(end + 2);
            continue;
        }
        return t;
    }
}

/** A wide interface: ≥7 members, OR ≥5 members with ≥50% optional. */
function isWide(c: MemberCount): boolean {
    if (c.members >= 7) {
        return true;
    }
    return c.members >= 5 && c.optional >= c.members / 2;
}

/** Build the candidates for one source (one per wide declaration). */
function candidatesFor(source: ScopedSource): RecallCandidate[] {
    const out: RecallCandidate[] = [];
    for (const block of declBlocksIn(source.text)) {
        const count = countMembers(block.body);
        if (!isWide(count)) {
            continue;
        }
        out.push({
            ref: `${source.fileId}:${block.name}`,
            note: `${count.members} members, ${count.optional} optional`,
        });
    }
    return out;
}

/**
 * `interfaceWidthScanner` — emits FI1 + ENC5 results (identical candidate lists)
 * for every wide `interface`/object-`type` declaration in scope. Returns empty
 * result lists when nothing matches (the harness merge tolerates empties).
 */
export const interfaceWidthScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const candidates: RecallCandidate[] = [];
    for (const source of sources) {
        candidates.push(...candidatesFor(source));
    }
    // Same candidates feed the frontend God-facade (FI1) and generic ISP (ENC5).
    return [
        { itemId: 'FI1', candidates: [...candidates] },
        { itemId: 'ENC5', candidates: [...candidates] },
    ];
};
