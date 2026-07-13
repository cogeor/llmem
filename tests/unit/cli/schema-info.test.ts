// tests/unit/cli/schema-info.test.ts
//
// B2 — commandFlagInfo introspects a command's Zod args the same way
// `describe --json` does (zod-to-json-schema), so per-command help cannot
// drift from the agent schema.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { commandFlagInfo, camelToKebab } from '../../../src/cli/schema-info';
import { healthCommand } from '../../../src/cli/commands/health';
import { reviewCommand } from '../../../src/cli/commands/review';

describe('camelToKebab', () => {
    test('maps schema keys back to the typed flag', () => {
        assert.equal(camelToKebab('failOn'), 'fail-on');
        assert.equal(camelToKebab('promptOnly'), 'prompt-only');
        assert.equal(camelToKebab('port'), 'port');
    });
});

describe('commandFlagInfo', () => {
    test('health: flags sorted, kebab-cased, with descriptions and defaults', () => {
        const flags = commandFlagInfo(healthCommand);
        const byKey = new Map(flags.map(f => [f.key, f]));

        const failOn = byKey.get('failOn');
        assert.ok(failOn, 'failOn present');
        assert.equal(failOn!.flag, 'fail-on');
        assert.ok(failOn!.description.length > 0, 'description carried over');

        const json = byKey.get('json');
        assert.ok(json, 'json present');
        assert.equal(json!.type, 'boolean');
        assert.equal(json!.defaultValue, false);

        const names = flags.map(f => f.flag);
        assert.deepEqual(names, [...names].sort(), 'flags sorted');
    });

    test('review: internal `_` positional catch-all is omitted; enum renders as a|b|c', () => {
        const flags = commandFlagInfo(reviewCommand);
        assert.ok(!flags.some(f => f.key === '_'), 'no `_` flag surfaced');
        const ruleset = flags.find(f => f.key === 'ruleset');
        assert.ok(ruleset, 'ruleset present');
        assert.equal(ruleset!.type, 'general|frontend|both');
        assert.equal(ruleset!.defaultValue, 'both');
    });
});
