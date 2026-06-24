// tests/unit/mcp/review-tools.test.ts
//
// WS-5 — tests for the two-phase `review` / `report_review` MCP tools and the
// pure pieces they rest on (`validateCompleteness`, `renderFilledReview`,
// `reviewArtifactRelPath`).
//
// The HARD GUARANTEE under test: `report_review` refuses to persist any
// checklist with a box left `not-yet-checked` (or missing), naming the
// unresolved ids; only a fully-resolved checklist writes a file under
// `.llmem/review/`.
//
// `report_review`'s handler never touches the server-shared context (it writes
// to the workspace root directly), so it is exercised end-to-end against a real
// temp workspace dir — no server spawn. node:test style.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
    reviewTool,
    reportReviewTool,
    handleReportReview,
    toolDefinitions,
} from '../../../src/mcp/tools';
import { REVIEW_REGISTRY } from '../../../src/application/review/registry';
import {
    validateCompleteness,
    type SubmittedItem,
} from '../../../src/application/review/validate';
import {
    reviewArtifactRelPath,
    renderFilledReview,
} from '../../../src/application/review/persist';

// ---- helpers --------------------------------------------------------------

/** Every required id for `ruleset`, resolved to a uniform status. */
const resolveAll = (
    ruleset: 'general' | 'frontend' | 'both',
    status: SubmittedItem['status'] = 'non-issue',
): SubmittedItem[] =>
    REVIEW_REGISTRY.filter(i => ruleset === 'both' || i.ruleset === ruleset).map(
        i => ({ id: i.id, status }),
    );

async function withTempWorkspace<T>(fn: (ws: string) => Promise<T>): Promise<T> {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'llmem-review-'));
    try {
        return await fn(ws);
    } finally {
        await fs.rm(ws, { recursive: true, force: true });
    }
}

// ===========================================================================
// validateCompleteness (pure)
// ===========================================================================

describe('validateCompleteness', () => {
    test('required-set sizes: both=65, general=34, frontend=31', () => {
        assert.equal(validateCompleteness([], 'both').unresolved.length, 65);
        assert.equal(validateCompleteness([], 'general').unresolved.length, 34);
        assert.equal(validateCompleteness([], 'frontend').unresolved.length, 31);
    });

    test('a fully-resolved checklist is complete (no unresolved)', () => {
        const res = validateCompleteness(resolveAll('both'), 'both');
        assert.equal(res.complete, true);
        assert.deepEqual(res.unresolved, []);
    });

    test("'not-yet-checked' counts as unresolved", () => {
        const submitted = resolveAll('both').map(i =>
            i.id === 'D1' ? { ...i, status: 'not-yet-checked' as const } : i,
        );
        const res = validateCompleteness(submitted, 'both');
        assert.equal(res.complete, false);
        assert.deepEqual(res.unresolved, ['D1']);
    });

    test('missing items are unresolved, returned in registry order', () => {
        // Submit everything except DC1 and D1 — registry order is D1 before DC1.
        const submitted = resolveAll('both').filter(
            i => i.id !== 'DC1' && i.id !== 'D1',
        );
        const res = validateCompleteness(submitted, 'both');
        assert.equal(res.complete, false);
        assert.deepEqual(res.unresolved, ['D1', 'DC1']);

        const d1Idx = REVIEW_REGISTRY.findIndex(i => i.id === 'D1');
        const dc1Idx = REVIEW_REGISTRY.findIndex(i => i.id === 'DC1');
        assert.ok(d1Idx < dc1Idx, 'registry order is D1 before DC1');
    });

    test("'issue-validated' also resolves a box", () => {
        const res = validateCompleteness(
            resolveAll('general', 'issue-validated'),
            'general',
        );
        assert.equal(res.complete, true);
    });

    test('a frontend id does not satisfy the general ruleset (and vice versa)', () => {
        // Resolving only frontend ids leaves all general ids unresolved.
        const res = validateCompleteness(resolveAll('frontend'), 'general');
        assert.equal(res.unresolved.length, 34);
    });
});

// ===========================================================================
// reviewArtifactRelPath / renderFilledReview (pure)
// ===========================================================================

describe('reviewArtifactRelPath', () => {
    test('sanitizes separators to __ and suffixes .md', () => {
        assert.equal(reviewArtifactRelPath('src/webview'), 'src__webview.md');
        assert.equal(reviewArtifactRelPath('src\\mcp\\tools'), 'src__mcp__tools.md');
    });

    test('empty / root path maps to repo.md', () => {
        assert.equal(reviewArtifactRelPath(''), 'repo.md');
        assert.equal(reviewArtifactRelPath('/'), 'repo.md');
        assert.equal(reviewArtifactRelPath('\\'), 'repo.md');
    });
});

describe('renderFilledReview', () => {
    test('emits a ticked line per required item, in registry order', () => {
        const md = renderFilledReview('src/webview', 'both', resolveAll('both'));
        const ticked = md.split('\n').filter(l => l.startsWith('- [x] '));
        assert.equal(ticked.length, 65);
        for (const item of REVIEW_REGISTRY) {
            assert.ok(
                md.includes(`- [x] ${item.id} — ${item.title} — non-issue`),
                `item ${item.id} ticked with status`,
            );
        }
    });

    test('renders an indented note line when present', () => {
        const submitted = resolveAll('both').map(i =>
            i.id === 'D1'
                ? { ...i, status: 'issue-validated' as const, note: 'owner is X' }
                : i,
        );
        const md = renderFilledReview('repo', 'both', submitted);
        assert.ok(md.includes('- [x] D1 — '));
        assert.ok(md.includes('      note: owner is X'));
    });

    test('deterministic: same input → byte-identical output', () => {
        const submitted = resolveAll('general');
        assert.equal(
            renderFilledReview('src/a.ts', 'general', submitted),
            renderFilledReview('src/a.ts', 'general', submitted),
        );
    });
});

// ===========================================================================
// toolDefinitions registration
// ===========================================================================

describe('review tool registration', () => {
    test('review and report_review are both in toolDefinitions', () => {
        const names = toolDefinitions.map(t => t.name);
        assert.ok(names.includes('review'), 'review registered');
        assert.ok(names.includes('report_review'), 'report_review registered');
    });

    test('tool names match their exported definitions', () => {
        assert.equal(reviewTool.name, 'review');
        assert.equal(reportReviewTool.name, 'report_review');
    });
});

// ===========================================================================
// report_review handler — the completeness gate (end-to-end, real temp ws)
// ===========================================================================

describe('report_review handler', () => {
    test('incomplete checklist → error naming unresolved ids, NOTHING persisted', async () => {
        await withTempWorkspace(async ws => {
            // Resolve all-but-two general ids; D1 and DC1 left out.
            const checklist = resolveAll('general').filter(
                i => i.id !== 'D1' && i.id !== 'DC1',
            );

            const res = await handleReportReview({
                workspaceRoot: ws,
                path: 'src/foo.ts',
                ruleset: 'general',
                checklist,
            });

            assert.equal(res.status, 'error');
            const msg = (res as { error: string }).error;
            assert.ok(msg.includes('D1'), 'error names D1');
            assert.ok(msg.includes('DC1'), 'error names DC1');
            assert.ok(
                msg.includes('Resolve every box before reporting.'),
                'error carries the resolve-every-box instruction',
            );

            // Nothing was written under .llmem/review/.
            await assert.rejects(
                fs.stat(path.join(ws, '.llmem', 'review')),
                'no review dir created on rejection',
            );
        });
    });

    test('not-yet-checked box → error, nothing persisted', async () => {
        await withTempWorkspace(async ws => {
            const checklist = resolveAll('general').map(i =>
                i.id === 'ENC3' ? { ...i, status: 'not-yet-checked' as const } : i,
            );
            const res = await handleReportReview({
                workspaceRoot: ws,
                path: 'src/foo.ts',
                ruleset: 'general',
                checklist,
            });
            assert.equal(res.status, 'error');
            assert.ok((res as { error: string }).error.includes('ENC3'));
            await assert.rejects(fs.stat(path.join(ws, '.llmem', 'review')));
        });
    });

    test('complete checklist → success + a file under .llmem/review/', async () => {
        await withTempWorkspace(async ws => {
            const res = await handleReportReview({
                workspaceRoot: ws,
                path: 'src/webview',
                ruleset: 'both',
                checklist: resolveAll('both', 'issue-validated'),
            });

            assert.equal(res.status, 'success');
            const data = (res as { data: { artifactPath: string; resolved: number } })
                .data;
            assert.equal(data.resolved, 65);

            const expected = path.join(ws, '.llmem', 'review', 'src__webview.md');
            assert.equal(data.artifactPath, expected);

            const written = await fs.readFile(expected, 'utf8');
            assert.ok(written.includes('- [x] D1 — '));
            assert.ok(written.startsWith('# LLMem Architecture Review — src/webview'));
        });
    });
});
