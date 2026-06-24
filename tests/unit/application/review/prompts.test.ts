// tests/unit/application/review/prompts.test.ts
//
// WS-6 — the embedded, versioned review prompts. The two skill memos become in-code
// string constants the MCP/CLI serve; `selectPrompts` is a pure deterministic switch.
// These tests pin: (a) `both` contains BOTH bodies + the shared header; (b) `general`
// and `frontend` are mutually exclusive (each carries its own body + header, never the
// other's); (c) `PROMPT_VERSION` is a non-empty stable string; (d) every selection
// references the status-legend tokens and the "graph blind" caution.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROMPT_VERSION,
    SHARED_HEADER,
    GENERAL_REVIEW_PROMPT,
    FRONTEND_REVIEW_PROMPT,
    selectPrompts,
} from '../../../../src/application/review/prompts';

// Stable phrases unique to each body — used to assert presence / exclusivity.
const GENERAL_MARKER = 'General architecture review — methodology';
const FRONTEND_MARKER = 'Frontend / webview review — methodology';

// A second, deeper marker per body to guard against a header-only match.
const GENERAL_DEEP = 'Production-vs-incidental reach-in is';
const FRONTEND_DEEP = 'instruction is also recall';

const STATUS_TOKENS = ['issue-validated', 'non-issue', 'not-yet-checked'];
const GRAPH_BLIND = 'graph blind';

test('selectPrompts("both") contains BOTH bodies + the shared header', () => {
    const out = selectPrompts('both');
    assert.ok(out.includes(SHARED_HEADER), 'both: missing shared header');
    assert.ok(out.includes(GENERAL_MARKER), 'both: missing general body');
    assert.ok(out.includes(FRONTEND_MARKER), 'both: missing frontend body');
    assert.ok(out.includes(GENERAL_DEEP), 'both: missing general deep marker');
    assert.ok(out.includes(FRONTEND_DEEP), 'both: missing frontend deep marker');
    // General comes before frontend, deterministically.
    assert.ok(
        out.indexOf(GENERAL_MARKER) < out.indexOf(FRONTEND_MARKER),
        'both: general body should precede frontend body',
    );
});

test('selectPrompts("general") has the general body + header, NOT the frontend body', () => {
    const out = selectPrompts('general');
    assert.ok(out.includes(SHARED_HEADER), 'general: missing shared header');
    assert.ok(out.includes(GENERAL_MARKER), 'general: missing general body');
    assert.ok(out.includes(GENERAL_DEEP), 'general: missing general deep marker');
    assert.ok(!out.includes(FRONTEND_MARKER), 'general: leaked frontend body');
    assert.ok(!out.includes(FRONTEND_DEEP), 'general: leaked frontend deep marker');
});

test('selectPrompts("frontend") has the frontend body + header, NOT the general body', () => {
    const out = selectPrompts('frontend');
    assert.ok(out.includes(SHARED_HEADER), 'frontend: missing shared header');
    assert.ok(out.includes(FRONTEND_MARKER), 'frontend: missing frontend body');
    assert.ok(out.includes(FRONTEND_DEEP), 'frontend: missing frontend deep marker');
    assert.ok(!out.includes(GENERAL_MARKER), 'frontend: leaked general body');
    assert.ok(!out.includes(GENERAL_DEEP), 'frontend: leaked general deep marker');
});

test('PROMPT_VERSION is a non-empty stable string', () => {
    assert.equal(typeof PROMPT_VERSION, 'string');
    assert.ok(PROMPT_VERSION.trim().length > 0, 'PROMPT_VERSION is empty');
    assert.equal(PROMPT_VERSION, 'review-prompt-v1', 'PROMPT_VERSION changed unexpectedly');
});

test('every selection references the status-legend tokens and the "graph blind" caution', () => {
    for (const ruleset of ['general', 'frontend', 'both'] as const) {
        const out = selectPrompts(ruleset);
        for (const token of STATUS_TOKENS) {
            assert.ok(out.includes(token), `${ruleset}: missing status token "${token}"`);
        }
        assert.ok(out.includes(GRAPH_BLIND), `${ruleset}: missing "graph blind" caution`);
    }
});

test('selectPrompts is deterministic — identical output across two calls', () => {
    for (const ruleset of ['general', 'frontend', 'both'] as const) {
        assert.equal(selectPrompts(ruleset), selectPrompts(ruleset), `${ruleset}: non-deterministic`);
    }
});

// Guard the constants are non-empty in their own right.
test('prompt bodies are non-empty', () => {
    assert.ok(GENERAL_REVIEW_PROMPT.trim().length > 0, 'GENERAL_REVIEW_PROMPT empty');
    assert.ok(FRONTEND_REVIEW_PROMPT.trim().length > 0, 'FRONTEND_REVIEW_PROMPT empty');
    assert.ok(SHARED_HEADER.trim().length > 0, 'SHARED_HEADER empty');
});
