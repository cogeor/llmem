// tests/unit/web-viewer/view-toggle.test.ts
//
// Pin the contract for the two-state ViewToggle:
//   - Two buttons render in order: Graph, Folders.
//   - Clicking each button calls state.set with the matching currentView.
//   - The active button reflects state.currentView via the 'active' class.
//   - The retired 'design'/'packages' routes no longer render buttons.
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

test('ViewToggle renders two buttons in order: Graph, Folders', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'graph' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    const buttons = Array.from(el.querySelectorAll('.view-toggle-btn')) as HTMLElement[];
    assert.equal(buttons.length, 2, 'two buttons render');
    assert.equal(buttons[0].textContent?.trim(), 'Graph');
    assert.equal(buttons[1].textContent?.trim(), 'Folders');

    // Each button has a stable data-view attribute the click handler reads.
    assert.equal(buttons[0].dataset.view, 'graph');
    assert.equal(buttons[1].dataset.view, 'folders');

    // The retired routes must not render buttons.
    assert.equal(el.querySelector('[data-view="design"]'), null, 'no design button');
    assert.equal(el.querySelector('[data-view="packages"]'), null, 'no packages button');
});

test('ViewToggle clicking each button calls state.set with the matching currentView', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'graph' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    for (const view of ['graph', 'folders'] as const) {
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
    const state = makeFakeState({ currentView: 'graph' });
    const toggle = new ViewToggle({ el, state });
    toggle.mount();

    const graphBtn = el.querySelector('[data-view="graph"]') as HTMLElement;
    const foldersBtn = el.querySelector('[data-view="folders"]') as HTMLElement;

    assert.ok(graphBtn.classList.contains('active'), 'graph active for currentView=graph');
    assert.ok(!foldersBtn.classList.contains('active'));

    state.set({ currentView: 'folders' });

    const foldersBtnAfter = el.querySelector('[data-view="folders"]') as HTMLElement;
    const graphBtnAfter = el.querySelector('[data-view="graph"]') as HTMLElement;
    assert.ok(
        foldersBtnAfter.classList.contains('active'),
        'folders active after state changes to folders',
    );
    assert.ok(
        !graphBtnAfter.classList.contains('active'),
        'graph no longer active after state changes',
    );
});

test('ViewToggle ignores clicks outside .view-toggle-btn', () => {
    const el = getEl();
    const state = makeFakeState({ currentView: 'graph' });
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
