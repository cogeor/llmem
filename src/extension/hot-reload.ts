
import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewDataService, WebviewData } from '../webview/data-service';
import { ensureArtifacts, ensureSingleFileArtifact } from '../artifact/service';
import { buildGraphs } from '../graph';

/**
 * Service to handle hot reloading of the webview data.
 * 
 * Three watch paths:
 * - Source files change (.ts, .js, etc.) -> Rebuild artifact for that file + rebuild graphs
 * - .arch files change (.md) -> Re-convert markdown to HTML
 * - Any file in project create/delete -> Refresh worktree
 */
export class HotReloadService {
    private sourceWatcher: vscode.FileSystemWatcher | undefined;
    private archWatcher: vscode.FileSystemWatcher | undefined;
    private treeWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    private debounceTimers: { source?: NodeJS.Timeout; arch?: NodeJS.Timeout; tree?: NodeJS.Timeout } = {};
    private pendingChangedFiles: Set<string> = new Set();

    private artifactRoot: string;
    private projectRoot: string;
    private archRoot: string;

    private onUpdate: (data: WebviewData) => void;

    constructor(
        artifactRoot: string,
        projectRoot: string,
        onUpdate: (data: WebviewData) => void
    ) {
        this.artifactRoot = artifactRoot;
        this.projectRoot = projectRoot;
        this.archRoot = path.join(projectRoot, '.arch');
        this.onUpdate = onUpdate;
    }

    public start() {
        if (this.sourceWatcher) return;

        console.log('[HotReload] Starting watchers...');
        console.log('[HotReload]   Project root:', this.projectRoot);
        console.log('[HotReload]   Artifact root:', this.artifactRoot);
        console.log('[HotReload]   Arch root:', this.archRoot);

        // Watch source files -> rebuild artifact for that file + graphs
        const srcPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            'src/**/*.{ts,tsx,js,jsx}'
        );
        this.sourceWatcher = vscode.workspace.createFileSystemWatcher(srcPattern);

        this.sourceWatcher.onDidChange((uri) => this.queueSourceRebuild(uri));
        this.sourceWatcher.onDidCreate((uri) => this.queueSourceRebuild(uri));
        this.sourceWatcher.onDidDelete((uri) => this.queueSourceRebuild(uri));
        this.disposables.push(this.sourceWatcher);

        // Watch .arch/src/**/*.md -> re-convert markdown
        const archPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.archRoot),
            'src/**/*.md'
        );
        this.archWatcher = vscode.workspace.createFileSystemWatcher(archPattern);

        this.archWatcher.onDidChange(() => this.queueArchConvert());
        this.archWatcher.onDidCreate(() => this.queueArchConvert());
        this.archWatcher.onDidDelete(() => this.queueArchConvert());
        this.disposables.push(this.archWatcher);

        // Watch for any file/folder creation/deletion in the project -> refresh worktree
        const treePattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            '**/*'
        );
        this.treeWatcher = vscode.workspace.createFileSystemWatcher(treePattern);
        this.treeWatcher.onDidCreate(() => this.queueTreeRefresh());
        this.treeWatcher.onDidDelete(() => this.queueTreeRefresh());
        this.disposables.push(this.treeWatcher);

        console.log('[HotReload] Watchers started');
    }

    public stop() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.sourceWatcher = undefined;
        this.archWatcher = undefined;
        this.treeWatcher = undefined;
        console.log('[HotReload] Watchers stopped');
    }

    private queueSourceRebuild(uri: vscode.Uri) {
        // Track the changed file
        const relativePath = path.relative(this.projectRoot, uri.fsPath).replace(/\\/g, '/');
        this.pendingChangedFiles.add(relativePath);

        if (this.debounceTimers.source) clearTimeout(this.debounceTimers.source);

        this.debounceTimers.source = setTimeout(async () => {
            const changedFiles = Array.from(this.pendingChangedFiles);
            this.pendingChangedFiles.clear();

            console.log('[HotReload] Source files changed:', changedFiles);
            try {
                // Rebuild artifacts only for the changed files
                for (const file of changedFiles) {
                    try {
                        await ensureSingleFileArtifact(file);
                    } catch (e) {
                        console.warn(`[HotReload] Failed to update artifact for ${file}:`, e);
                    }
                }

                // Rebuild graphs
                await buildGraphs(this.artifactRoot);

                // Collect fresh data and send update
                await this.sendUpdate();
            } catch (e) {
                console.error('[HotReload] Source rebuild failed:', e);
            }
        }, 500);
    }

    private queueArchConvert() {
        if (this.debounceTimers.arch) clearTimeout(this.debounceTimers.arch);

        this.debounceTimers.arch = setTimeout(async () => {
            console.log('[HotReload] Arch changed - refreshing design docs...');
            try {
                await this.sendUpdate();
            } catch (e) {
                console.error('[HotReload] Arch refresh failed:', e);
            }
        }, 300);
    }

    private queueTreeRefresh() {
        if (this.debounceTimers.tree) clearTimeout(this.debounceTimers.tree);

        this.debounceTimers.tree = setTimeout(async () => {
            console.log('[HotReload] File system changed - refreshing tree...');
            try {
                await this.sendUpdate();
            } catch (e) {
                console.error('[HotReload] Tree refresh failed:', e);
            }
        }, 500);
    }

    public async sendUpdate() {
        try {
            const data = await WebviewDataService.collectData(
                this.projectRoot,
                this.artifactRoot
            );
            this.onUpdate(data);
            console.log('[HotReload] Update sent');
        } catch (e) {
            console.error('[HotReload] Failed to collect data:', e);
        }
    }
}
