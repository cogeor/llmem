// VS Code API (Mock for browser if missing)
let vscode;
try {
    vscode = acquireVsCodeApi();
} catch (e) {
    console.log("VS Code API not available, running in standalone mode");
    vscode = {
        postMessage: (msg) => console.log("Mock postMessage:", msg),
        getState: () => ({}),
        setState: (state) => { }
    };
}

// State
// State
let network = null;
let currentData = { nodes: [], edges: [] };
let staticData = null; // Store full static data if available

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const btnUpdate = document.getElementById('btn-update');
const btnSend = document.getElementById('btn-send');
const btnClear = document.getElementById('btn-clear-chat');
const chatInput = document.getElementById('chat-input');
const chatHistory = document.getElementById('chat-history');
const selectGraphType = document.getElementById('select-graph-type');
const container = document.getElementById('mynetwork');

// Initialize
window.addEventListener('load', () => {
    // Check for static injected data
    // Check for static injected data
    if (window.GRAPH_DATA_URL) {
        fetch(window.GRAPH_DATA_URL)
            .then(response => response.json())
            .then(data => {
                staticData = data;
                // Default to importGraph if available
                if (data.importGraph) {
                    renderGraph(data.importGraph);
                } else {
                    renderGraph(data);
                }
                setStatus('Loaded graph data', 'idle');
            })
            .catch(err => {
                console.error("Failed to load graph data", err);
                setStatus('Error loading data', 'error');
            });
    } else if (window.INITIAL_DATA) {
        // Legacy support
        if (window.INITIAL_DATA.importGraph) {
            staticData = window.INITIAL_DATA;
            renderGraph(staticData.importGraph);
        } else {
            renderGraph(window.INITIAL_DATA);
        }
        setStatus('Loaded static context', 'idle');
    }

    // Restore state if needed
    const oldState = vscode.getState();
    if (oldState) {
        if (oldState.chat) {
            oldState.chat.forEach(msg => appendMessage(msg.role, msg.content));
        }
    }

    // Notify extension we are ready
    vscode.postMessage({ command: 'webview:ready' });
});

// Event Listeners
btnUpdate.addEventListener('click', () => {
    vscode.postMessage({ command: 'action:generate_context' });
    setStatus('Requesting update...', 'working');
});

selectGraphType.addEventListener('change', () => {
    const type = selectGraphType.value;

    if (staticData) {
        // Local switch for static mode
        if (type === 'call' && staticData.callGraph) {
            renderGraph(staticData.callGraph);
        } else if (type === 'import' && staticData.importGraph) {
            renderGraph(staticData.importGraph);
        } else {
            console.warn("Graph type not found in static data:", type);
        }
    } else {
        // Dynamic switch via extension
        vscode.postMessage({ command: 'action:switch_graph', type: type });
    }
});

btnSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

btnClear.addEventListener('click', () => {
    chatHistory.innerHTML = '';
    saveState();
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage('user', text);
    chatInput.value = '';

    vscode.postMessage({ command: 'chat:send', text: text });
    saveState();
}

function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = content; // Text only for now, no markdown rendering in this minimal version
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function renderGraph(data) {
    currentData = data;

    const options = {
        nodes: {
            shape: 'dot',
            size: 16,
            font: {
                size: 12,
                color: getComputedStyle(document.body).getPropertyValue('--foreground').trim()
            }
        },
        edges: {
            color: { inherit: 'from' },
            arrows: { to: { enabled: true, scaleFactor: 0.5 } }
        },
        physics: {
            stabilization: false,
            barnesHut: {
                gravitationalConstant: -8000,
                springConstant: 0.04,
                springLength: 95
            }
        },
        layout: {
            improvedLayout: false
        }
    };

    if (network) {
        network.setData(data);
    } else {
        network = new vis.Network(container, data, options);

        network.on('click', function (params) {
            if (params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                const node = currentData.nodes.find(n => n.id === nodeId);
                console.log('Clicked node:', node);
                // Optionally send selection back to extension
            }
        });
    }

    setStatus('Graph updated', 'idle');
}

function setStatus(msg, state) {
    statusIndicator.textContent = msg;
    if (state === 'working') {
        btnUpdate.disabled = true;
    } else {
        btnUpdate.disabled = false;
    }
}

function saveState() {
    const messages = Array.from(chatHistory.children).map(div => ({
        role: div.classList.contains('user') ? 'user' : 'assistant',
        content: div.textContent
    }));

    vscode.setState({ chat: messages });
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'plot:data':
            renderGraph(message.data);
            break;
        case 'status:update':
            setStatus(message.message, message.status);
            break;
        case 'chat:append':
            appendMessage(message.role, message.content);
            saveState();
            break;
    }
});
