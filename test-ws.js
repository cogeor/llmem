const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    console.log('WebSocket connected');
});

ws.on('message', (data) => {
    console.log('Received:', data.toString());
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

setTimeout(() => {
    console.log('Test timeout - closing');
    ws.close();
    process.exit(0);
}, 5000);
