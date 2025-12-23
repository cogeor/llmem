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
        lspCommand: 'pylsp', // or 'pyright-langserver', need to make this configurable/detectable
        lspArgs: []
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

            await exec(checkCmd);
            console.error(`[LSP Detection] Found support for ${lang.id}: ${lang.lspCommand}`);
            available.push(lang);
        } catch (e) {
            console.error(`[LSP Detection] Missing support for ${lang.id}: '${lang.lspCommand}' not found in PATH.`);
        }
    }
    return available;
}
