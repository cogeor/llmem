
import * as vscode from 'vscode';
import * as path from 'path';
import { WebviewDataService, WebviewData } from '../webview/data-service';
import { getSupportedExtensions } from '../artifact/service';

/**
 * Service to handle hot reloading of the webview data.
 * 
 * Three watch paths:
 * - Source files change (.ts, .js, etc.) -> Refresh graphs from edge list
 * - .arch files change (.md) -> Re-convert markdown to HTML
 * - Any file in project create/delete -> Refresh worktree
 */
export class HotReloadService {
    private sourceWatcher: vscode.FileSystemWatcher | undefined;
    private archWatcher: vscode.FileSystemWatcher | undefined;
    private treeWatcher: vscode.FileSystemWatcher | undefined;
    private edgelistWatcher: vscode.FileSystemWatcher | undefined;
    private disposables: vscode.Disposable[] = [];

    private debounceTimers: { source?: NodeJS.Timeout; arch?: NodeJS.Timeout; tree?: NodeJS.Timeout; edgelist?: NodeJS.Timeout } = {};
    private pendingChangedFiles: Set<string> = new Set();
    private watchedPaths: Set<string> = new Set();  // Paths with active file watching

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

        // Watch source files -> refresh graphs
        const extensions = getSupportedExtensions();
        const extPattern = extensions.map(e => e.replace(/^\./, '')).join(',');

        console.log(`[HotReload] Watching extensions: {${extPattern}}`);

        const srcPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            `src/**/*.{${extPattern}}`
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
        // We use two patterns to reliably catch both root files/folders and nested ones
        const rootPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            '*'
        );
        const nestedPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.projectRoot),
            '**/*'
        );

        const rootWatcher = vscode.workspace.createFileSystemWatcher(rootPattern);
        rootWatcher.onDidCreate((uri) => {
            console.log('[HotReload] Root creation detected:', uri.fsPath);
            this.queueTreeRefresh();
        });
        rootWatcher.onDidDelete((uri) => {
            console.log('[HotReload] Root deletion detected:', uri.fsPath);
            this.queueTreeRefresh();
        });
        this.disposables.push(rootWatcher);

        this.treeWatcher = vscode.workspace.createFileSystemWatcher(nestedPattern);
        this.treeWatcher.onDidCreate((uri) => {
            // Avoid double trigger if root watcher caught it (though debounce handles this)
            this.queueTreeRefresh();
        });
        this.treeWatcher.onDidDelete((uri) => this.queueTreeRefresh());
        this.disposables.push(this.treeWatcher);

        // Watch edgelist files -> refresh graphs when edges are added/updated
        const edgelistPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.artifactRoot),
            '*-edgelist.json'
        );
        this.edgelistWatcher = vscode.workspace.createFileSystemWatcher(edgelistPattern);
        this.edgelistWatcher.onDidChange(() => this.queueEdgelistRefresh());
        this.edgelistWatcher.onDidCreate(() => this.queueEdgelistRefresh());
        this.disposables.push(this.edgelistWatcher);

        console.log('[HotReload] Watchers started');
    }

    public stop() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.sourceWatcher = undefined;
        this.archWatcher = undefined;
        this.treeWatcher = undefined;
        this.edgelistWatcher = undefined;
        console.log('[HotReload] Watchers stopped');
    }

    /**
     * Add a path to the watched set.
     */
    public addWatchedPath(relativePath: string) {
        this.watchedPaths.add(relativePath);
        console.log(`[HotReload] Added to watch: ${relativePath}`);
    }

    /**
     * Remove a path from the watched set.
     */
    public removeWatchedPath(relativePath: string) {
        this.watchedPaths.delete(relativePath);
        console.log(`[HotReload] Removed from watch: ${relativePath}`);
    }

    /**
     * Check if a file is within any watched path.
     */
    private isInWatchedPath(relativePath: string): boolean {
        for (const watchedPath of this.watchedPaths) {
            if (relativePath === watchedPath || relativePath.startsWith(watchedPath + '/')) {
                return true;
            }
        }
        return false;
    }

    private queueSourceRebuild(uri: vscode.Uri) {
        // Track the changed file
        const relativePath = path.relative(this.projectRoot, uri.fsPath).replace(/\\/g, '/');
        this.pendingChangedFiles.add(relativePath);

        if (this.debounceTimers.source) clearTimeout(this.debounceTimers.source);

        this.debounceTimers.source = setTimeout(async () => {
            const changedFiles = Array.from(this.pendingChangedFiles);
            this.pendingChangedFiles.clear();

            // Filter to only files in watched paths
            const watchedChangedFiles = changedFiles.filter(f => this.isInWatchedPath(f));

            if (watchedChangedFiles.length === 0) {
                console.log('[HotReload] Source files changed (not in watched paths):', changedFiles);
                return;
            }

            console.log('[HotReload] Watched files changed, regenerating edges:', watchedChangedFiles);
            try {
                // Regenerate edges for each changed file in watched paths
                const { generateCallEdgesForFile } = await import('../scripts/generate-call-edges');
                for (const file of watchedChangedFiles) {
                    await generateCallEdgesForFile(this.projectRoot, file, this.artifactRoot);
                }

                // Refresh the webview data
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

    private queueEdgelistRefresh() {
        if (this.debounceTimers.edgelist) clearTimeout(this.debounceTimers.edgelist);

        this.debounceTimers.edgelist = setTimeout(async () => {
            console.log('[HotReload] Edge list changed - refreshing graphs...');
            try {
                await this.sendUpdate();
            } catch (e) {
                console.error('[HotReload] Edgelist refresh failed:', e);
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
