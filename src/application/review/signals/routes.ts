/**
 * B3 — route-literal reachability signal (WS-4), feeding FD2.
 *
 * A frontend names its navigable surfaces as a string-literal union — a
 * `type <Name>(View|Route|Page|Mode)... = 'a' | 'b' | 'c'` alias — and wires each
 * one up with a registration call (`registerRoute('a')`, `registerView('b')`). A
 * union member that is never registered is a DORMANT route/view: declared but
 * unreachable, the FD2 "unreachable routes/views" smell.
 *
 * Like the other cross-file scanners (payload-owners), this aggregates ACROSS the
 * whole in-scope `sources` array: the union declaration may live in one file and
 * its registration calls in another. The scanner builds two sets over all
 * sources —
 *   - MEMBERS: every string-literal member of a route/view-ish union, and
 *   - REGISTERED: every string arg passed to a `register*` call —
 * then emits an FD2 candidate for each member NOT in the registered set (set
 * difference). The candidate `ref` is the bare member literal; the `note` is the
 * fixed "route/view literal with no register* call — possibly dormant".
 *
 * Route/view-ish union recognition (two tolerant forms, both noisy by design —
 * the LLM filter judges dormant-pending vs delete):
 *   1. NAME form: a `type \w*(View|Route|Page|Mode)\w* = '...' | '...' | ...`
 *      alias — any string-literal union whose alias name carries a navigation
 *      stem.
 *   2. WIDTH form: a `type \w*(View|Route)\w* = ...` alias whose body is a union
 *      of ≥3 string literals (a wide string union assigned to a View/Route-named
 *      type, even if it didn't trip form 1's exact stem placement).
 * Both forms ultimately collect the same thing: the `'literal'` members of the
 * union body. Registration recognition matches `register<Word>('x')` /
 * `register<Word>("x")` for any `register`-prefixed call.
 *
 * Only FD2 is emitted.
 *
 * Pure: text in, candidates out. No IO, no `Date`, no `Math.random`.
 */

import type { RecallCandidate } from '../types';
import type { ScopedSource, SignalResult, SignalScanner } from './source-scan';

/**
 * Match a route/view-ish type-alias declaration and capture its union body.
 * Group 1 is everything to the right of `=`, up to the statement end (`;` or
 * newline). The alias name must carry a navigation stem (View|Route|Page|Mode).
 * The body is parsed for string literals separately (see `MEMBER_RE`).
 */
const UNION_DECL_RE =
    /\btype\s+\w*(?:View|Route|Page|Mode)\w*\s*=\s*([^;\n]+)/g;

/**
 * Match a wide string-literal union assigned to a View/Route-named alias (the
 * tolerant WIDTH form). Same capture shape as `UNION_DECL_RE`; the ≥3-member
 * threshold is enforced after extracting the members from the captured body.
 */
const WIDE_UNION_DECL_RE = /\btype\s+\w*(?:View|Route)\w*\s*=\s*([^;\n]+)/g;

/** Match a single `'literal'` / `"literal"` string within a union body. */
const MEMBER_RE = /['"]([^'"]+)['"]/g;

/**
 * Match a registration call literal arg: `register<Word>('x')` /
 * `register<Word>("x")`. Group 1 is the registered name.
 */
const REGISTER_RE = /\bregister\w*\s*\(\s*['"]([^'"]+)['"]/g;

/** Collect every `'literal'` member from a union body string. */
function unionMembers(body: string): string[] {
    const members: string[] = [];
    const re = new RegExp(MEMBER_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
        members.push(m[1]);
    }
    return members;
}

/**
 * Build the set of route/view union members declared across all sources. Both
 * the NAME form (any member count) and the WIDTH form (≥3 members) contribute.
 */
function declaredMembers(sources: ScopedSource[]): Set<string> {
    const members = new Set<string>();
    for (const source of sources) {
        // NAME form: navigation-stemmed alias, any width.
        const nameRe = new RegExp(UNION_DECL_RE.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = nameRe.exec(source.text)) !== null) {
            for (const member of unionMembers(m[1])) {
                members.add(member);
            }
        }
        // WIDTH form: View/Route alias whose body is a union of ≥3 literals.
        const wideRe = new RegExp(WIDE_UNION_DECL_RE.source, 'g');
        while ((m = wideRe.exec(source.text)) !== null) {
            const found = unionMembers(m[1]);
            if (found.length >= 3) {
                for (const member of found) {
                    members.add(member);
                }
            }
        }
    }
    return members;
}

/** Build the set of register*-call literal args across all sources. */
function registeredNames(sources: ScopedSource[]): Set<string> {
    const registered = new Set<string>();
    for (const source of sources) {
        const re = new RegExp(REGISTER_RE.source, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(source.text)) !== null) {
            registered.add(m[1]);
        }
    }
    return registered;
}

/**
 * `routeLiteralScanner` — emits one FD2 candidate per route/view union member
 * that has NO matching `register*` call anywhere in scope (set difference). The
 * candidate `ref` is the bare member literal and the `note` is the fixed dormant
 * message. Returns an empty FD2 result list when every member is registered (the
 * harness merge tolerates empties).
 */
export const routeLiteralScanner: SignalScanner = (
    sources: ScopedSource[],
): SignalResult[] => {
    const members = declaredMembers(sources);
    const registered = registeredNames(sources);
    const candidates: RecallCandidate[] = [];
    for (const member of members) {
        if (registered.has(member)) {
            continue;
        }
        candidates.push({
            ref: member,
            note: 'route/view literal with no register* call — possibly dormant',
        });
    }
    return [{ itemId: 'FD2', candidates }];
};
