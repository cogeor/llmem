// tests/unit/web-viewer/summary-panel.test.ts
//
// VS-A3 — pin the SummaryPanel controller's pinned state machine:
//   EXACT, ANCESTOR (inherited marker), EMPTY, RECLICK-EXACT (toggle-off),
//   DESCENDANT-SAME-ANCESTOR (RULE B: no toggle), DIFFERENT-KEY swap,
//   CLEARED-SELECTION (hide). Resolution is delegated to the pure
//   `resolveClosestDoc`, so the controller is driven through a fake state +
//   a stub FolderDescriptionPanel — no JSDOM needed (browser-pure).

import test from 'node:test';
import assert from 'node:assert/strict';

import { SummaryPanel } from '../../../src/webview/ui/components/SummaryPanel';
import type { SummaryPanelRenderer } from '../../../src/webview/ui/components/SummaryPanel';
import type { DesignDoc } from '../../../src/webview/ui/types';

type Call =
    | { kind: 'resolved'; key: string; inherited: boolean }
    | { kind: 'empty'; path: string }
    | { kind: 'hide' };

/** Stub renderer that records the controller's calls. */
class StubPanel implements SummaryPanelRenderer {
    calls: Call[] = [];
    showResolved(key: string, _doc: DesignDoc, inherited: boolean): void {
        this.calls.push({ kind: 'resolved', key, inherited });
    }
    showEmpty(path: string): void {
        this.calls.push({ kind: 'empty', path });
    }
    hide(): void {
        this.calls.push({ kind: 'hide' });
    }
    last(): Call | undefined {
        return this.calls[this.calls.length - 1];
    }
}

function doc(body: string): DesignDoc {
    return { markdown: `# ${body}`, html: `<h1>${body}</h1>` };
}

// docs: src/parser has an exact README; src/parser/sub does NOT (so it
// inherits src/parser's README). src/graph is undocumented.
function makeDocs(): Record<string, DesignDoc> {
    return {
        'src/parser/README.md': doc('parser'),
    };
}

test('EXACT: folder with own README shows it (not inherited)', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory');

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: false,
    });
    assert.equal(sp.getCurrentKey(), 'src/parser/README.md');
});

test('ANCESTOR: folder w/o own doc shows ancestor README with inherited marker', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser/sub', 'directory');

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: true,
    });
    assert.equal(sp.getCurrentKey(), 'src/parser/README.md');
});

test('EMPTY: undocumented folder shows the llmem document empty state', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/graph', 'directory');

    assert.deepEqual(panel.last(), { kind: 'empty', path: 'src/graph' });
    // currentKey is a non-null sentinel so a re-click can toggle the hint.
    assert.notEqual(sp.getCurrentKey(), null);
});

test('RECLICK-EXACT: re-clicking the shown exact folder hides + clears key', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory'); // show
    sp.onSelection('src/parser', 'directory'); // reclick → toggle off

    assert.deepEqual(panel.last(), { kind: 'hide' });
    assert.equal(sp.getCurrentKey(), null);
});

test('RECLICK-EMPTY: re-clicking an undocumented folder toggles the hint off', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/graph', 'directory'); // empty hint
    sp.onSelection('src/graph', 'directory'); // reclick → toggle off

    assert.deepEqual(panel.last(), { kind: 'hide' });
    assert.equal(sp.getCurrentKey(), null);
});

test('RULE B: descendant resolving to the same ancestor does NOT toggle', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    // First show the ancestor doc via a descendant selection.
    sp.onSelection('src/parser/sub', 'directory');
    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: true,
    });

    // Selecting a DIFFERENT descendant that resolves to the SAME ancestor
    // key must NOT toggle closed — the path differs, so it swaps/keeps-open.
    sp.onSelection('src/parser/sub/deep', 'directory');
    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: true,
    });
    assert.equal(sp.getCurrentKey(), 'src/parser/README.md');
    // No hide() was emitted by the second descendant selection.
    assert.equal(panel.calls.filter((c) => c.kind === 'hide').length, 0);
});

test('DIFFERENT-KEY: selecting another documented folder swaps the doc', () => {
    const docs = {
        'src/parser/README.md': doc('parser'),
        'src/graph/README.md': doc('graph'),
    };
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: docs });

    sp.onSelection('src/parser', 'directory');
    assert.equal(sp.getCurrentKey(), 'src/parser/README.md');

    sp.onSelection('src/graph', 'directory');
    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/graph/README.md',
        inherited: false,
    });
    assert.equal(sp.getCurrentKey(), 'src/graph/README.md');
});

test('CLEARED-SELECTION: null path hides the panel', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory');
    sp.onSelection(null, null);

    assert.deepEqual(panel.last(), { kind: 'hide' });
    assert.equal(sp.getCurrentKey(), null);
});

test('empty DESIGN_DOCS: panel shows empty hint, nothing throws', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: {} });

    assert.doesNotThrow(() => sp.onSelection('src/anything', 'directory'));
    assert.deepEqual(panel.last(), { kind: 'empty', path: 'src/anything' });
});

test('FILE EXACT: a file with its own .html doc shows exact', () => {
    const docs = { 'src/info/cli.html': doc('cli') };
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: docs });

    sp.onSelection('src/info/cli.ts', 'file');

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/info/cli.html',
        inherited: false,
    });
});

// ---------------------------------------------------------------------------
// VS-A4 — refreshDocs: live-refresh the open panel on an arch update.
// ---------------------------------------------------------------------------

/** Stub that also records setDesignDocs pushes (FolderDescriptionPanel parity). */
class StubPanelWithDocs extends StubPanel {
    setDesignDocsCalls: Array<Record<string, DesignDoc>> = [];
    setDesignDocs(docs: Record<string, DesignDoc>): void {
        this.setDesignDocsCalls.push(docs);
    }
}

test('refreshDocs: edited doc content re-shows same key, inherited unchanged', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory'); // EXACT
    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: false,
    });

    // Same key, changed content.
    sp.refreshDocs({ 'src/parser/README.md': doc('parser-edited') });

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: false,
    });
    assert.equal(sp.getCurrentKey(), 'src/parser/README.md');
});

test('refreshDocs: deleted EXACT doc with an ancestor re-resolves to INHERITED', () => {
    // src/parser has its own README; selecting it shows EXACT.
    const docs = {
        'src/README.md': doc('src-root'),
        'src/parser/README.md': doc('parser'),
    };
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: docs });

    sp.onSelection('src/parser', 'directory');
    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: false,
    });

    // Delete src/parser's own doc; the ancestor src/README.md remains.
    sp.refreshDocs({ 'src/README.md': doc('src-root') });

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/README.md',
        inherited: true, // now inherited from the ancestor
    });
    assert.equal(sp.getCurrentKey(), 'src/README.md');
});

test('refreshDocs: everything gone hides the panel', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory'); // shown
    sp.refreshDocs({}); // all docs removed

    assert.deepEqual(panel.last(), { kind: 'hide' });
    assert.equal(sp.getCurrentKey(), null);
});

test('refreshDocs: does NOT toggle closed a panel that should stay open', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    sp.onSelection('src/parser', 'directory'); // EXACT shown
    const hidesBefore = panel.calls.filter((c) => c.kind === 'hide').length;

    // Refresh with the SAME map (no change) — must re-show, not hide.
    sp.refreshDocs(makeDocs());

    assert.deepEqual(panel.last(), {
        kind: 'resolved',
        key: 'src/parser/README.md',
        inherited: false,
    });
    assert.equal(
        panel.calls.filter((c) => c.kind === 'hide').length,
        hidesBefore,
        'refresh must not emit a hide() for a panel that stays open',
    );

    // And a subsequent reclick on the SAME selection still toggles closed —
    // refresh preserved currentPath/currentType for RULE B.
    sp.onSelection('src/parser', 'directory');
    assert.deepEqual(panel.last(), { kind: 'hide' });
    assert.equal(sp.getCurrentKey(), null);
});

test('refreshDocs: nothing shown is a no-op (no render, just swaps the map)', () => {
    const panel = new StubPanel();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    // No selection yet → refresh must not render anything.
    sp.refreshDocs({ 'src/parser/README.md': doc('parser') });
    assert.equal(panel.calls.length, 0);
});

test('refreshDocs: pushes the new map into the renderer (setDesignDocs)', () => {
    const panel = new StubPanelWithDocs();
    const sp = new SummaryPanel({ panel, designDocs: makeDocs() });

    const newMap = { 'src/parser/README.md': doc('parser-2') };
    sp.refreshDocs(newMap);

    assert.equal(panel.setDesignDocsCalls.length, 1);
    assert.equal(panel.setDesignDocsCalls[0], newMap);
});
