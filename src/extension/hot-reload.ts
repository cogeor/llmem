
import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewDataService, WebviewData } from '../webview/data-service';
import { ensureArtifacts } from '../artifact/service';
import { buildGraphs } from '../graph';

/**
 * Service to handle hot reloading of the webview data.
 * 
 * Two paths:
 * - Source files change (.ts, .js, etc.) -> Rebuild artifacts and graphs
 * - .arch files change (.md) -> Re-convert markdown to HTML
 */
export class HotReloadService {
    private sourceWatcher: vscode.FileSystemWatcher | undefined;
    private archWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    private debounceTimers: { source?: NodeJS.Timeout; arch?: NodeJS.Timeout } = {};

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

        // Watch source files -> rebuild graphs
        const srcPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            'src/**/*.{ts,tsx,js,jsx}'
        );
        this.sourceWatcher = vscode.workspace.createFileSystemWatcher(srcPattern);

        this.sourceWatcher.onDidChange(() => this.queueSourceRebuild());
        this.sourceWatcher.onDidCreate(() => this.queueSourceRebuild());
        this.sourceWatcher.onDidDelete(() => this.queueSourceRebuild());
        this.disposables.push(this.sourceWatcher);

        // Watch .arch/src/*.md -> re-convert markdown
        const archPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.archRoot),
            'src/**/*.md'
        );
        this.archWatcher = vscode.workspace.createFileSystemWatcher(archPattern);

        this.archWatcher.onDidChange(() => this.queueArchConvert());
        this.archWatcher.onDidCreate(() => this.queueArchConvert());
        this.archWatcher.onDidDelete(() => this.queueArchConvert());
        this.disposables.push(this.archWatcher);

        console.log('[HotReload] Watchers started');
    }

    public stop() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.sourceWatcher = undefined;
        this.archWatcher = undefined;
        console.log('[HotReload] Watchers stopped');
    }

    private queueSourceRebuild() {
        if (this.debounceTimers.source) clearTimeout(this.debounceTimers.source);

        this.debounceTimers.source = setTimeout(async () => {
            console.log('[HotReload] Source changed - rebuilding graphs...');
            try {
                // Rebuild artifacts for changed source
                await ensureArtifacts('.', true);

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
                // The DesignDocManager reads markdown dynamically, so we just need to
                // trigger a data refresh. The conversion happens in collectData.
                await this.sendUpdate();
            } catch (e) {
                console.error('[HotReload] Arch refresh failed:', e);
            }
        }, 300);
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
