// tests/unit/application/analysis/call-cycles.test.ts
//
// Loop 04 — pure-function tests for the call-cycle analyzer.
//
// Tests the PURE `callCyclesFromGraph(callGraph)` directly with a hand-built
// `CallGraph` (no IO, no build), mirroring cycles.test.ts. This avoids the
// builder's `callGraph:'none'` node-drop entirely (only the ctx wrapper builds
// from edge lists). node:test style.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { CallGraph, CallEdge, EntityNode } from '../../../../src/graph/types';
import { makeEntityId, parseGraphId } from '../../../../src/core/ids';
import { callCyclesFromGraph } from '../../../../src/application/analysis/cycles';

// entity-node literal; fileId is the file portion of the id (or the id itself
// for an external bare-module entity).
const entity = (id: string): EntityNode => {
    const p = parseGraphId(id);
    const fileId = p.kind === 'entity' ? p.fileId : id;
    return { id, kind: 'function', label: id, fileId };
};

const ce = (source: string, target: string): CallEdge => ({
    source,
    target,
    kind: 'call',
    callSiteId: `${source}->${target}`,
});

const cg = (ids: string[], edges: CallEdge[]): CallGraph => ({
    nodes: new Map(ids.map(id => [id, entity(id)])),
    edges,
    unresolved: [],
});

const f = makeEntityId('src/a.ts', 'f'); // 'src/a.ts::f'
const g = makeEntityId('src/a.ts', 'g');

test('callCyclesFromGraph: f<->g yields one call-cycle, zero recursion', () => {
    const r = callCyclesFromGraph(cg([f, g], [ce(f, g), ce(g, f)]));
    assert.equal(r.cycles.length, 1, 'exactly one call cycle');
    assert.equal(r.recursion.length, 0, 'no recursion bucket entries');
    assert.equal(r.cycles[0].kind, 'call-cycle');
    assert.equal(r.cycles[0].type, 'call-cycle');
    assert.equal(r.cycles[0].severity, 'medium');
    assert.deepEqual(r.cycles[0].members, [f, g], 'members are sorted SCC ids');
    // shortestPath is closed (first === last).
    const sp = r.cycles[0].shortestPath;
    assert.equal(sp[0], sp.at(-1), 'path is closed');
});

test('callCyclesFromGraph: f->f yields one recursion, zero cycle', () => {
    const r = callCyclesFromGraph(cg([f], [ce(f, f)]));
    assert.equal(r.cycles.length, 0, 'self-loop is never a cycle');
    assert.equal(r.recursion.length, 1, 'exactly one recursion entry');
    assert.equal(r.recursion[0].type, 'recursion');
    assert.equal(r.recursion[0].severity, 'low');
});

test('callCyclesFromGraph: external-entity edges are dropped before the SCC', () => {
    // 'path::join' parses to entity with fileId 'path'; isExternalModuleId('path')
    // is true (no slash, no '::'), so this entity is external and excluded.
    const lib = 'path::join';
    const r = callCyclesFromGraph(cg([f, lib], [ce(f, lib), ce(lib, f)]));
    assert.equal(r.cycles.length, 0, 'external-entity edges are dropped before the SCC');
    assert.equal(r.recursion.length, 0);
});

test('callCyclesFromGraph: acyclic f->g yields nothing', () => {
    const r = callCyclesFromGraph(cg([f, g], [ce(f, g)]));
    assert.equal(r.cycles.length, 0);
    assert.equal(r.recursion.length, 0);
});
