/**
 * Python Call Extractor
 *
 * Free-function helpers for extracting call sites from Python function/method
 * bodies. Split out of `extractor.ts` (class-shell decomposition) so the
 * extractor class stays under the parser line-size budget; the class delegates
 * its call-extraction to these functions. Behavior is identical — any class
 * state the old methods relied on is threaded in as explicit parameters.
 *
 * Pure with respect to extractor state: these helpers take only tree-sitter
 * nodes + the same-file class-name set, so they can be unit-tested without
 * constructing a PythonExtractor.
 */

import { Loc, CallSite } from '../types';

// Type-only reference to tree-sitter's SyntaxNode, written as an inline
// `import(...)` type query (never an `import type` statement) so ts-node / tsc
// can never emit a runtime `require('tree-sitter')`: loading this module must
// not pull in the native addon.
type SyntaxNode = import('tree-sitter').SyntaxNode;

/**
 * Build a Loc from a tree-sitter node (1-based lines, 0-based columns, byte
 * offsets). Shared by both the entity walk and call-site extraction.
 */
export function getLoc(node: SyntaxNode): Loc {
    return {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
        startByte: node.startIndex,
        endByte: node.endIndex,
    };
}

/**
 * PC-06 decision helper (pure): is `calleeName` a bare identifier naming a
 * class defined in the SAME file? Returns false when the set is absent.
 */
export function isSameFileClassInstantiation(
    calleeName: string,
    classNames?: Set<string>,
): boolean {
    return !!classNames && classNames.has(calleeName);
}

/**
 * Build a CallSite from a tree-sitter `call` node, or null if the callee
 * shape is not a plain identifier or attribute access.
 *
 * calleeName is always the FINAL identifier (never a dotted path):
 *   - `function` field is an `identifier` -> that identifier's text
 *     (kind 'function', or 'new' for a same-file class instantiation)
 *   - `function` field is an `attribute`  -> the attribute's final name
 *     (right-hand `attribute` field), e.g. self.parse -> 'parse' (kind 'method')
 *   - any other callee shape (e.g. getattr(...)() ) -> skipped (null)
 *
 * @param classNames - PC-06: same-file class names; an identifier callee in
 *   this set is a class instantiation (kind:'new').
 */
export function callSiteFromCallNode(
    callNode: SyntaxNode,
    classNames?: Set<string>,
): CallSite | null {
    const fnNode = callNode.childForFieldName('function');
    if (!fnNode) return null;

    let calleeName: string | undefined;
    let kind: CallSite['kind'] | undefined;

    if (fnNode.type === 'identifier') {
        // e.g. b(), Thing()
        calleeName = fnNode.text;
        // PC-06: a bare identifier that names a same-file class is an
        // instantiation -> kind:'new'. Otherwise a plain function call.
        // The edge target is unchanged either way (still calleeName).
        kind = isSameFileClassInstantiation(calleeName, classNames)
            ? 'new'
            : 'function';
    } else if (fnNode.type === 'attribute') {
        // e.g. self.parse(), mod.func(), obj.method().
        // The FINAL identifier is the attribute's `attribute` field (the
        // right-hand identifier), NOT the whole dotted attribute.text.
        const attrNode = fnNode.childForFieldName('attribute');
        if (attrNode) {
            calleeName = attrNode.text;
            kind = 'method';
        }
    }

    if (!calleeName || !kind) {
        // Other callee shapes (e.g. getattr(o,'x')() — a call whose
        // function is itself a call). Skip: emit no spurious CallSite.
        return null;
    }

    return {
        callSiteId: `${calleeName}@${callNode.startIndex}`,
        kind,
        calleeName,
        loc: getLoc(callNode),
    };
}

/**
 * Extract call sites from a function/method body subtree.
 *
 * One pass over the body collecting tree-sitter `call` nodes, emitting a
 * CallSite for each. The walk STOPS at nested function_definition /
 * class_definition (mirroring the classContext gate in extractEntities) so a
 * nested def's calls are not attributed to the enclosing entity.
 *
 * resolvedDefinition is left UNDEFINED: the language-agnostic resolver in
 * artifact-converter.ts falls through to its import/local tiers, and any
 * unresolved (dangling) edge is dropped at graph-build (index.ts).
 *
 * @param classContext - present when walking a method body; threaded through
 *   for parity with extractEntities (call resolution is name-based, so this is
 *   not used to alter calleeName, but kept for signature symmetry).
 * @param classNames - PC-06: set of same-file class names. An `identifier`
 *   callee that matches one is tagged kind:'new' (class instantiation).
 */
export function extractCalls(
    bodyNode: SyntaxNode,
    _classContext?: string,
    classNames?: Set<string>,
): CallSite[] {
    const calls: CallSite[] = [];

    const visit = (node: SyntaxNode) => {
        // Scope boundary: do NOT descend into nested defs — those entities
        // get their own extractCalls pass.
        if (node.type === 'function_definition' || node.type === 'class_definition') {
            return;
        }

        if (node.type === 'call') {
            const callSite = callSiteFromCallNode(node, classNames);
            if (callSite) {
                calls.push(callSite);
            }
            // Continue descending into the call node's arguments so that
            // calls nested in argument lists (e.g. f(g())) are captured.
        }

        for (const child of node.children) {
            visit(child);
        }
    };

    visit(bodyNode);
    return calls;
}
