// Headless smoke test: load the served webview, run its bundle,
// simulate clicks, and report layout state.
//
// Run: node scripts/smoke-webview.js [url]

const { JSDOM } = require('jsdom');

const URL = process.argv[2] || 'http://127.0.0.1:5757/';

(async () => {
    const html = await (await fetch(URL)).text();

    const dom = new JSDOM(html, {
        url: URL,
        runScripts: 'dangerously',
        resources: 'usable',
        pretendToBeVisual: true,
    });

    // Stub APIs jsdom doesn't implement so the bundle doesn't crash on bootstrap.
    dom.window.WebSocket = class {
        constructor() { this.readyState = 0; }
        addEventListener() {}
        close() {}
    };
    dom.window.ResizeObserver = class { observe() {} disconnect() {} };

    // Wait for scripts to settle.
    await new Promise(r => setTimeout(r, 1500));

    const w = dom.window;
    const d = w.document;

    function rect(sel) {
        const el = d.querySelector(sel);
        if (!el) return `${sel}: NOT FOUND`;
        const cs = w.getComputedStyle(el);
        return `${sel}: display=${cs.display} h=${cs.height} flex=${cs.flex} | inline=${el.getAttribute('style')}`;
    }
    function snapshot(label) {
        console.log(`\n=== ${label} ===`);
        console.log(rect('body'));
        console.log(rect('#view-toggle'));
        console.log(rect('#app'));
        console.log(rect('#design-pane'));
        console.log(rect('#graph-pane'));
        console.log(rect('#splitter-2'));
        console.log(rect('#graph-view'));
        console.log(rect('#package-view'));
        console.log(rect('#design-view'));
        const tabs = [...d.querySelectorAll('.view-toggle-btn')].map(b => `${b.dataset.view}${b.classList.contains('active') ? '*' : ''}`).join(' ');
        console.log(`tabs: ${tabs || '(no tabs rendered)'}`);
    }

    snapshot('AFTER LOAD');

    // Click Design tab.
    const designBtn = d.querySelector('.view-toggle-btn[data-view="design"]');
    if (designBtn) {
        designBtn.click();
        await new Promise(r => setTimeout(r, 200));
        snapshot('AFTER click Design');
    } else {
        console.log('!!! design button not found');
    }

    // Click Graph tab.
    const graphBtn = d.querySelector('.view-toggle-btn[data-view="graph"]');
    if (graphBtn) {
        graphBtn.click();
        await new Promise(r => setTimeout(r, 200));
        snapshot('AFTER click Graph');
    }

    // Simulate clicking a graph node by dispatching state change.
    if (graphBtn) {
        // We can't actually click an SVG node easily in jsdom (no layout),
        // but we can check whether unrelated state changes still touch the
        // toggle DOM. Pick any non-view state field.
        const beforeHtml = d.querySelector('#view-toggle').innerHTML;
        // Trigger an arbitrary state mutation through the bundle — easiest is
        // a click on the same active button (state.set with same currentView).
        designBtn.click();
        await new Promise(r => setTimeout(r, 50));
        designBtn.click();
        await new Promise(r => setTimeout(r, 50));
        const afterHtml = d.querySelector('#view-toggle').innerHTML;
        console.log(`\ntoggle innerHTML changed across redundant clicks: ${beforeHtml !== afterHtml}`);
    }

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
