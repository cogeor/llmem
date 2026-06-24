// tests/unit/application/review/registry.test.ts
//
// WS-1 — the review-checklist registry is pure data: one `ChecklistItem` per
// defect class transcribed from the two review-skill memos, in memo order
// (general block then frontend block). These tests pin the registry's COVERAGE
// (every expected id present exactly once, no dups, no extras), each item's
// well-formedness (non-empty title + instruction, valid scope/glyph/ruleset),
// and its determinism (frozen array, stable id-order across two reads).

import test from 'node:test';
import assert from 'node:assert/strict';

import { REVIEW_REGISTRY } from '../../../../src/application/review/registry';
import type {
    ChecklistItem,
    ItemScope,
    RecallStrength,
} from '../../../../src/application/review/types';

// The exhaustive coverage list, in the order the PLAN / memos prescribe.
const GENERAL_IDS: string[] = [
    'D1', 'D2', 'D3', 'D4',
    'DC1', 'DC2', 'DC3',
    'DEP1', 'DEP2', 'DEP3', 'DEP4',
    'ENC1', 'ENC2', 'ENC3', 'ENC4', 'ENC5',
    'ST1', 'ST2', 'ST3', 'ST4', 'ST5', 'ST6',
    'CO1', 'CO2', 'CO3', 'CO4',
    'ER1', 'ER2', 'ER3', 'ER4',
    'LC1', 'LC2', 'LC3', 'LC4',
];
const FRONTEND_IDS: string[] = [
    'FD1', 'FD2', 'FD3', 'FD4',
    'FB1', 'FB2', 'FB3',
    'FR1', 'FR2',
    'FI1',
    'FP1', 'FP2',
    'FL1', 'FL2', 'FL3', 'FL4',
    'FM1', 'FM2', 'FM3', 'FM4',
    'FV1', 'FV2', 'FV3', 'FV4', 'FV5',
    'FS1', 'FS2', 'FS3',
    'FA1', 'FA2', 'FA3',
];
const EXPECTED_IDS: string[] = [...GENERAL_IDS, ...FRONTEND_IDS];

const VALID_SCOPES: ReadonlySet<ItemScope> = new Set<ItemScope>(['file', 'folder', 'repo']);
const VALID_STRENGTHS: ReadonlySet<RecallStrength> = new Set<RecallStrength>(['●●●', '●●○', '●○○']);
const VALID_RULESETS: ReadonlySet<ChecklistItem['ruleset']> = new Set(['general', 'frontend']);

test('every expected id is present exactly once (no dups, no extras)', () => {
    const ids = REVIEW_REGISTRY.map((it) => it.id);

    // No duplicate ids.
    assert.equal(new Set(ids).size, ids.length, 'duplicate id(s) in REVIEW_REGISTRY');

    // Exactly the expected set, no more, no less.
    assert.deepEqual(new Set(ids), new Set(EXPECTED_IDS), 'id set mismatch vs coverage list');
    assert.equal(REVIEW_REGISTRY.length, EXPECTED_IDS.length, 'registry length mismatch');

    // Each coverage id appears exactly once.
    for (const id of EXPECTED_IDS) {
        assert.equal(ids.filter((x) => x === id).length, 1, `id ${id} not present exactly once`);
    }
});

test('each item is well-formed', () => {
    for (const item of REVIEW_REGISTRY) {
        const at = `item ${item.id}`;
        assert.ok(item.id.length > 0, `${at}: empty id`);
        assert.ok(item.title.trim().length > 0, `${at}: empty title`);
        assert.ok(item.promptInstruction.trim().length > 0, `${at}: empty promptInstruction`);
        assert.ok(item.category.trim().length > 0, `${at}: empty category`);
        assert.ok(item.recallQuery.trim().length > 0, `${at}: empty recallQuery`);
        assert.ok(VALID_SCOPES.has(item.scope), `${at}: invalid scope ${item.scope}`);
        assert.ok(VALID_STRENGTHS.has(item.recallStrength), `${at}: invalid recallStrength ${item.recallStrength}`);
        assert.ok(VALID_RULESETS.has(item.ruleset), `${at}: invalid ruleset ${item.ruleset}`);
    }
});

test('ruleset blocks match memo provenance', () => {
    for (const item of REVIEW_REGISTRY) {
        const expected = GENERAL_IDS.includes(item.id) ? 'general' : 'frontend';
        assert.equal(item.ruleset, expected, `item ${item.id}: ruleset should be ${expected}`);
    }
});

test('registry is frozen and its id-order is stable across two reads', () => {
    assert.ok(Object.isFrozen(REVIEW_REGISTRY), 'REVIEW_REGISTRY is not frozen');

    const orderA = REVIEW_REGISTRY.map((it) => it.id);
    const orderB = REVIEW_REGISTRY.map((it) => it.id);
    assert.deepEqual(orderA, orderB, 'id-order differs across two reads');

    // Stable order = general block (memo order) then frontend block (memo order).
    assert.deepEqual(orderA, EXPECTED_IDS, 'id-order is not the prescribed general-then-frontend memo order');
});
