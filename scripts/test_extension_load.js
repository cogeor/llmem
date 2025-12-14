/**
 * Test script to verify extension module can be loaded
 * Run with: node --experimental-vm-modules scripts/test_extension_load.js
 */

const path = require('path');

// Mock vscode module
const mockVscode = {
    window: {
        createOutputChannel: () => ({
            appendLine: (msg) => console.log('[OUTPUT]', msg),
            show: () => { },
            dispose: () => { }
        }),
        showInformationMessage: (msg) => console.log('[INFO]', msg),
        showErrorMessage: (msg) => console.log('[ERROR]', msg),
        showWarningMessage: (msg) => console.log('[WARN]', msg),
        activeTextEditor: null
    },
    commands: {
        registerCommand: (name, handler) => {
            console.log('[CMD] Registered:', name);
            return { dispose: () => { } };
        }
    },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        createFileSystemWatcher: () => ({
            onDidChange: () => { },
            onDidCreate: () => { },
            onDidDelete: () => { },
            dispose: () => { }
        })
    },
    Uri: {
        file: (p) => ({ fsPath: p }),
        joinPath: (uri, ...args) => ({ fsPath: path.join(uri.fsPath, ...args) })
    },
    ViewColumn: { One: 1 },
    RelativePattern: class {
        constructor(base, pattern) {
            this.base = base;
            this.pattern = pattern;
        }
    }
};

// Inject mock before requiring extension
require.cache['vscode'] = { exports: mockVscode };
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'vscode') return mockVscode;
    return originalRequire.apply(this, arguments);
};

async function test() {
    console.log('Testing extension load...\n');

    try {
        // Try to load the extension
        const ext = require('../dist/extension/extension.js');
        console.log('\n✓ Extension module loaded successfully');
        console.log('  Exports:', Object.keys(ext));

        // Check activate function exists
        if (typeof ext.activate === 'function') {
            console.log('  ✓ activate function exists');
        } else {
            console.log('  ✗ activate function missing!');
        }

        if (typeof ext.deactivate === 'function') {
            console.log('  ✓ deactivate function exists');
        } else {
            console.log('  ✗ deactivate function missing!');
        }

    } catch (e) {
        console.error('\n✗ Failed to load extension:', e.message);
        console.error(e.stack);
    }
}

test();
