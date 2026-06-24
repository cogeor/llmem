// tests/unit/application/review/signal-entity-spans.test.ts
//
// WS-4 (Loop 04) — pure-function tests for the brace/decl entity-span tracker
// that powers per-entity candidate attribution in the lifecycle/transport
// scanners.
//
// `entitySpans` (text in, ordered [start,end) spans out) and `enclosingEntity`
// (spans + offset in, innermost name out) are pure and deterministic. No IO,
// no ctx, no scan. node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    entitySpans,
    enclosingEntity,
} from '../../../../src/application/review/signals/entity-spans';

// A class with one method, used across several offset assertions.
const NESTED = `class C {
    method() {
        doThing();
    }
}`;

// ---- Case 1: nested class/method spans, method contained in class ----------

test('entitySpans: a nested class { method() {} } yields a class span containing the method span', () => {
    const spans = entitySpans(NESTED);

    const cls = spans.find(s => s.name === 'C');
    const method = spans.find(s => s.name === 'C.method');
    assert.ok(cls, 'class span present');
    assert.ok(method, 'qualified method span present');

    // The method span is fully contained in the class span.
    assert.ok(
        cls.start <= method.start && method.end <= cls.end,
        'method span is contained within the class span',
    );
});

// ---- Case 2: innermost-wins + qualified name -------------------------------

test('enclosingEntity: an offset inside the method body resolves to the qualified C.method', () => {
    const spans = entitySpans(NESTED);
    const offsetInsideMethod = NESTED.indexOf('doThing');
    assert.equal(enclosingEntity(spans, offsetInsideMethod), 'C.method');
});

test('enclosingEntity: an offset inside the class body but outside any method resolves to C', () => {
    const spans = entitySpans(NESTED);
    // The space just before `method` is inside the class body, outside the method.
    const offsetInClassBody = NESTED.indexOf('method') - 1;
    assert.equal(enclosingEntity(spans, offsetInClassBody), 'C');
});

// ---- Case 3: top-level function --------------------------------------------

test('enclosingEntity: an offset inside a top-level function resolves to its bare name', () => {
    const text = `function f() {
    el.addEventListener('x', h);
}`;
    const spans = entitySpans(text);
    const offsetInsideF = text.indexOf('addEventListener');
    assert.equal(enclosingEntity(spans, offsetInsideF), 'f');
});

// ---- Case 4: match outside every declaration -> undefined ------------------

test('enclosingEntity: a module-level offset outside any declaration returns undefined', () => {
    const text = `const k = 1;
function f() { return k; }
top.addEventListener('y', h);`;
    const spans = entitySpans(text);
    const offsetTopLevel = text.indexOf('top.addEventListener');
    assert.equal(enclosingEntity(spans, offsetTopLevel), undefined);

    // And an offset before any declaration is also outside every span.
    assert.equal(enclosingEntity(spans, 0), undefined);
});

// ---- Case 5: determinism ---------------------------------------------------

test('entitySpans: same text twice -> deep-equal (deterministic)', () => {
    const a = entitySpans(NESTED);
    const b = entitySpans(NESTED);
    assert.deepEqual(a, b);
});

// ---- Case 6: two methods in one class disambiguate by qualified name --------

test('enclosingEntity: same-named offsets in two methods resolve to distinct qualified names', () => {
    const text = `class Host {
    wire() {
        panel.onDidReceiveMessage(m => f(m));
    }
    idle() {
        return 0;
    }
}`;
    const spans = entitySpans(text);
    assert.equal(
        enclosingEntity(spans, text.indexOf('onDidReceiveMessage')),
        'Host.wire',
    );
    assert.equal(enclosingEntity(spans, text.indexOf('return 0')), 'Host.idle');
});
