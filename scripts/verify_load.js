
try {
    const path = require('path');
    const fs = require('fs');
    const Module = require('module');

    // Mock vscode module
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
        if (id === 'vscode') {
            return {
                window: { createOutputChannel: () => ({ appendLine: () => { } }) },
                commands: { registerCommand: () => { } },
                workspace: { workspaceFolders: [] },
                ExtensionContext: class { }
            };
        }
        return originalRequire.apply(this, arguments);
    };

    const extPath = path.resolve(__dirname, '../dist/extension/extension.js');
    console.log("Extension path:", extPath);
    console.log("Exists:", fs.existsSync(extPath));

    if (fs.existsSync(extPath)) {
        console.log("Attempting to require extension...");
        const ext = require(extPath);
        console.log("Successfully required extension.");
        console.log("Exports:", Object.keys(ext));
    } else {
        console.error("Extension file does not exist!");
    }
} catch (error) {
    console.error("Failed to require extension:");
    console.error(error.message);
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error("Module not found details:", error);
    }
}
