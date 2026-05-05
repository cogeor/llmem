#!/usr/bin/env node
// Cross-platform, glob-free test runner.
// Walks the given directories for *.test.ts files and forks `node --test`
// with the explicit file list so we don't depend on Node 22's glob expansion
// or shell globstar (dash on Ubuntu CI doesn't expand **).
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        if (err && err.code === 'ENOENT') return out;
        throw err;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            out.push(full);
        }
    }
    return out;
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
    process.stderr.write('usage: run-tests.cjs <dir-or-file> [...]\n');
    process.exit(2);
}

const files = [];
for (const input of inputs) {
    let stat;
    try {
        stat = fs.statSync(input);
    } catch (err) {
        if (err && err.code === 'ENOENT') continue;
        throw err;
    }
    if (stat.isDirectory()) walk(input, files);
    else if (stat.isFile() && input.endsWith('.test.ts')) files.push(input);
}

if (files.length === 0) {
    process.stderr.write(`run-tests.cjs: no .test.ts files found under ${inputs.join(', ')}\n`);
    process.exit(1);
}

const args = ['--require', 'ts-node/register', '--test', ...files];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.error) {
    process.stderr.write(`run-tests.cjs: ${result.error.message}\n`);
    process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
