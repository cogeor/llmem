// tests/unit/web-viewer/view-toggle.test.ts
//
// Pin the contract for the four-state ViewToggle:
//   - Four buttons render in order: Graph, Design, Packages, Folders.
//   - Clicking each button calls state.set with the matching currentView.
//   - The active button reflects state.currentView via the 'active' class.
//
// JSDOM harness mirrors the existing webview unit-test pattern. The State
// stub captures every set() call so we can assert on payload shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="view-toggle"></div></body></html>',
);
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown;
g.document = dom.window.document;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ViewToggle } = require('../../../src/webview/ui/components/ViewToggle') as {
    ViewToggle: new (props: {
        el: HTMLElement;
        state: {
            get(): unknown;
            set(p: unknown): void;
            subscribe(cb: (s: unknown) => void): () => void;
        };
    }) => {
        mount(): void;
        unmount(): void;
    };
};

interface FakeAppState {
    currentView: 'graph' | 'design' | 'packages' | 'folders';
}

function makeFakeState(initial: FakeAppState): {
    data: FakeAppState;
    setCalls: Partial<FakeAppState>[];
    listeners: ((s: FakeAppState) => void)[];
    get(): FakeAppState;
    set(p: Partial<FakeAppState>): void;
    subscribe(cb: (s: FakeAppState) => void): () => void;
} {
    const setCalls: Partial<FakeAppState>[] = [];
    const listeners: ((s: FakeAppState) => void)[] = [];
    const state = {
        data: { ...initial },
        setCalls,
        listeners,
        get() {
            return state.data;
        },
        set(p: Partial<FakeAppState>) {
            setCalls.push({ ...p });
            state.data = { ...state.data, ...p };
            for (const cb of state.listeners) cb(state.data);
        },
        subscribe(cb: (s: FakeAppState) => void) {
            state.listeners.push(cb);
            cb(state.data);
            return () => {
                const i = state.listeners.indexOf(cb);
                if (i >= 0) state.listeners.splice(i, 1);
            };
        },
    };
    return state;
}

function getEl(): HTMLElement {
    const el = dom.window.document.getElementById('view-toggle') as unknown as HTMLElement;
    el.innerHTML = '';
    return el;
}

test('ViewToggle renders four buttons in order: Graph, Design, Packages, Folders', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'design' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    const buttons = Array.from(el.querySelectorAll('.view-toggle-btn')) as HTMLElement[];
    assert.equal(buttons.length, 4, 'four buttons render');
    assert.equal(buttons[0].textContent?.trim(), 'Graph');
    assert.equal(buttons[1].textContent?.trim(), 'Design');
    assert.equal(buttons[2].textContent?.trim(), 'Packages');
    assert.equal(buttons[3].textContent?.trim(), 'Folders');

    // Each button has a stable data-view attribute the click handler reads.
    assert.equal(buttons[0].dataset.view, 'graph');
    assert.equal(buttons[1].dataset.view, 'design');
    assert.equal(buttons[2].dataset.view, 'packages');
    assert.equal(buttons[3].dataset.view, 'folders');
});

test('ViewToggle clicking each button calls state.set with the matching currentView', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'design' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    for (const view of ['graph', 'design', 'packages', 'folders'] as const) {
        const btn = el.querySelector(`[data-view="${view}"]`) as HTMLElement;
        assert.ok(btn, `button for ${view} must exist`);
        btn.click();
        const lastCall = state.setCalls[state.setCalls.length - 1];
        assert.deepEqual(
            lastCall,
            { currentView: view },
            `click on ${view} button must call state.set({ currentView: '${view}' })`,
        );
    }
});

test('ViewToggle marks the active button with the "active" class for the current route', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'design' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    const designBtn = el.querySelector('[data-view="design"]') as HTMLElement;
    const graphBtn = el.querySelector('[data-view="graph"]') as HTMLElement;
    const packagesBtn = el.querySelector('[data-view="packages"]') as HTMLElement;
    const foldersBtn = el.querySelector('[data-view="folders"]') as HTMLElement;

    assert.ok(designBtn.classList.contains('active'), 'design active for currentView=design');
    assert.ok(!graphBtn.classList.contains('active'));
    assert.ok(!packagesBtn.classList.contains('active'));
    assert.ok(!foldersBtn.classList.contains('active'));

    state.set({ currentView: 'folders' });

    const foldersBtnAfter = el.querySelector('[data-view="folders"]') as HTMLElement;
    const designBtnAfter = el.querySelector('[data-view="design"]') as HTMLElement;
    assert.ok(
        foldersBtnAfter.classList.contains('active'),
        'folders active after state changes to folders',
    );
    assert.ok(
        !designBtnAfter.classList.contains('active'),
        'design no longer active after state changes',
    );
});

test('ViewToggle ignores clicks outside .view-toggle-btn', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'design' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    const initialCallCount = state.setCalls.length;

    const wrapper = el.querySelector('.view-toggle') as HTMLElement;
    assert.ok(wrapper, 'wrapper element must exist');
    wrapper.click();

    assert.equal(
        state.setCalls.length,
        initialCallCount,
        'clicks outside .view-toggle-btn must not trigger state.set',
    );
});
