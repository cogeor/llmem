// Headless smoke: verify FolderStructureView renders an SVG of folder
// nodes and orthogonal edges when the 'folders' tab is active.
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
    dom.window.WebSocket = class { constructor() { this.readyState = 0; } addEventListener() {} close() {} };
    dom.window.ResizeObserver = class { observe() {} disconnect() {} };
    if (typeof dom.window.CSS === 'undefined') dom.window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c) };
    await new Promise(r => setTimeout(r, 2500));
    const d = dom.window.document;

    const tabs = [...d.querySelectorAll('.view-toggle-btn')].map(b => b.textContent.trim()).join(' / ');
    console.log(`tabs: ${tabs}`);

    const designView = d.querySelector('#design-view');
    console.log(`#design-view is detail-view: ${designView?.classList?.contains('detail-view')}`);
    console.log(`#design-mode-toggle exists: ${!!d.getElementById('design-mode-toggle')}`);

    // Simulate clicking the Folders tab.
    const foldersBtn = d.querySelector('[data-view="folders"]');
    if (!foldersBtn) { console.log('NO folders button'); process.exit(1); }
    foldersBtn.click();
    await new Promise(r => setTimeout(r, 600));

    const fsView = d.getElementById('folder-structure-view');
    const svg = fsView?.querySelector('svg.folder-structure-svg');
    const nodes = fsView?.querySelectorAll('.folder-structure-node') ?? [];
    const edges = fsView?.querySelectorAll('.folder-structure-edges path') ?? [];
    console.log(`#folder-structure-view display: ${fsView?.style?.display}`);
    console.log(`svg present: ${!!svg}`);
    console.log(`folder-structure-node count: ${nodes.length}`);
    console.log(`orthogonal edge path count: ${edges.length}`);

    // Sanity-check edges are orthogonal: paths should contain only M, H, V commands.
    let nonOrth = 0;
    for (const p of edges) {
        const dAttr = p.getAttribute('d') ?? '';
        if (/[A-Za-z]/.test(dAttr.replace(/[MHVmhv\d.\s-]/g, ''))) nonOrth += 1;
    }
    console.log(`non-orthogonal edge paths: ${nonOrth}`);

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
