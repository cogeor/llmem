/**
 * @deprecated DEAD CODE - LSP language configuration is currently unused.
 * 
 * This file configured LSP servers for various languages but the LSP approach
 * was found to be too slow. Kept for potential future re-integration.
 * 
 * Current implementation uses tree-sitter for all non-TS/JS parsing.
 * See tree-sitter.md for current architecture.
 */

export interface LanguageConfig {
    id: string;
    extensions: string[];
    lspCommand: string;
    lspArgs: string[];
    // Helper to detect if installed?
}

// Initial set of potential languages.
export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
    {
        id: 'python',
        extensions: ['.py'],
        lspCommand: 'pyright-langserver',
        lspArgs: ['--stdio']
    },
    {
        id: 'cpp',
        extensions: ['.cpp', '.hpp', '.c', '.h', '.cc'],
        lspCommand: 'clangd',
        lspArgs: []
    },
    {
        id: 'r',
        extensions: ['.R', '.r'],
        lspCommand: 'R',
        lspArgs: ['--slave', '-e', 'languageserver::run()']
    },
    {
        id: 'dart',
        extensions: ['.dart'],
        lspCommand: 'dart',
        lspArgs: ['language-server']
    },
    {
        id: 'rust',
        extensions: ['.rs'],
        lspCommand: 'rust-analyzer',
        lspArgs: []
    }
];

import * as child_process from 'child_process';
import * as util from 'util';

const exec = util.promisify(child_process.exec);

export async function detectAvailableLanguages(): Promise<LanguageConfig[]> {
    const available: LanguageConfig[] = [];

    console.error('[LSP Detection] ======================================');
    console.error('[LSP Detection] Scanning for available LSP servers...');
    console.error('[LSP Detection] ======================================');

    for (const lang of SUPPORTED_LANGUAGES) {
        try {
            // Simple check: see if command exists
            // For R we check R specifically, for others the command itself.
            let checkCmd = lang.lspCommand;
            if (process.platform === 'win32') {
                checkCmd = `where ${checkCmd}`;
            } else {
                checkCmd = `which ${checkCmd}`;
            }

            const result = await exec(checkCmd);
            const commandPath = result.stdout.trim().split('\n')[0]; // Get first match
            console.error(`[LSP Detection] ✓ ${lang.id.toUpperCase()}: Found '${lang.lspCommand}' at ${commandPath}`);
            available.push(lang);
        } catch (e) {
            console.error(`[LSP Detection] ✗ ${lang.id.toUpperCase()}: '${lang.lspCommand}' not found in PATH`);
            if (lang.id === 'python') {
                console.error(`[LSP Detection]   → Install: pip install pyright`);
            } else if (lang.id === 'cpp') {
                console.error(`[LSP Detection]   → Install clangd from LLVM or your system package manager`);
            } else if (lang.id === 'rust') {
                console.error(`[LSP Detection]   → Install: rustup component add rust-analyzer`);
            } else if (lang.id === 'r') {
                console.error(`[LSP Detection]   → Install R package: install.packages("languageserver")`);
            } else if (lang.id === 'dart') {
                console.error(`[LSP Detection]   → Dart LSP comes with Dart SDK installation`);
            }
        }
    }

    console.error('[LSP Detection] ======================================');
    console.error(`[LSP Detection] Summary: ${available.length}/${SUPPORTED_LANGUAGES.length} LSP servers available`);
    if (available.length > 0) {
        console.error(`[LSP Detection] Available: ${available.map(l => l.id).join(', ')}`);
    }
    console.error('[LSP Detection] ======================================');

    return available;
}
