
import * as vscode from 'vscode';
import * as path from 'path';
import { collectViewerData } from '../application/viewer-data';
import { ParserRegistry } from '../parser/registry';
import { scanFile } from '../application/scan';
import type { WorkspaceContext } from '../application/workspace-context';
import { createLogger } from '../common/logger';
import type { DesignDoc } from '../webview/design-docs';
import { renderMarkdown } from '../webview/markdown-renderer';
import type { WebviewGraphData } from '../graph/webview-data';
import type { ITreeNode } from '../webview/worktree';

const log = createLogger('hot-reload');

/**
 * The rendered shape that hot-reload pushes to the panel. Identical to
 * the pre-Loop-06 `WebviewData` interface (markdown rendered to HTML),
 * preserved here so the panel-side callback contract does not change.
 */
export interface WebviewData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: Record<string, DesignDoc>;
}

/**
 * Service to handle hot reloading of the webview data.
 *
 * Three watch paths:
 * - Source files change (.ts, .js, etc.) -> Refresh graphs from edge list
 * - .arch files change (.md) -> Re-convert markdown to HTML
 * - Any file in project create/delete -> Refresh worktree
 *
 * Loop 04: takes a `WorkspaceContext` from the panel instead of building
 * its own `WorkspaceIO`. The context's `workspaceRoot`, `artifactRoot`,
 * `archRoot`, `io`, and `logger` replace the lazily-constructed `_io`
 * field and the per-string-arg constructor.
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

    /** Loop 04: per-workspace runtime context, supplied by the panel. */
    private readonly ctx: WorkspaceContext;

    private onUpdate: (data: WebviewData) => void;

    constructor(
        ctx: WorkspaceContext,
        onUpdate: (data: WebviewData) => void
    ) {
        this.ctx = ctx;
        this.onUpdate = onUpdate;
    }

    public start() {
        if (this.sourceWatcher) return;

        log.info('Starting watchers...');
        log.info('Project root', { projectRoot: this.ctx.workspaceRoot });
        log.info('Artifact root', { artifactRoot: this.ctx.artifactRoot });
        log.info('Arch root', { archRoot: this.ctx.archRoot });

        // Watch source files -> refresh graphs
        const extensions = ParserRegistry.getInstance().getSupportedExtensions();
        const extPattern = extensions.map(e => e.replace(/^\./, '')).join(',');

        log.info('Watching extensions', { extensions: extPattern });

        const srcPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.ctx.workspaceRoot),
            `src/**/*.{${extPattern}}`
        );
        this.sourceWatcher = vscode.workspace.createFileSystemWatcher(srcPattern);

        this.sourceWatcher.onDidChange((uri) => this.queueSourceRebuild(uri));
        this.sourceWatcher.onDidCreate((uri) => this.queueSourceRebuild(uri));
        this.sourceWatcher.onDidDelete((uri) => this.queueSourceRebuild(uri));
        this.disposables.push(this.sourceWatcher);

        // Watch .arch/src/**/*.md -> re-convert markdown
        const archPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.ctx.archRoot),
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
            vscode.Uri.file(this.ctx.workspaceRoot),
            '*'
        );
        const nestedPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.ctx.workspaceRoot),
            '**/*'
        );

        const rootWatcher = vscode.workspace.createFileSystemWatcher(rootPattern);
        rootWatcher.onDidCreate((uri) => {
            log.debug('Root creation detected', { fsPath: uri.fsPath });
            this.queueTreeRefresh();
        });
        rootWatcher.onDidDelete((uri) => {
            log.debug('Root deletion detected', { fsPath: uri.fsPath });
            this.queueTreeRefresh();
        });
        this.disposables.push(rootWatcher);

        this.treeWatcher = vscode.workspace.createFileSystemWatcher(nestedPattern);
        this.treeWatcher.onDidCreate((uri) => {
            // Avoid double trigger if root watcher caught it (though debounce handles this)
            void uri;
            this.queueTreeRefresh();
        });
        this.treeWatcher.onDidDelete((uri) => { void uri; this.queueTreeRefresh(); });
        this.disposables.push(this.treeWatcher);

        // Watch edgelist files -> refresh graphs when edges are added/updated
        const edgelistPattern = new vscode.RelativePattern(
            vscode.Uri.file(this.ctx.artifactRoot),
            '*-edgelist.json'
        );
        this.edgelistWatcher = vscode.workspace.createFileSystemWatcher(edgelistPattern);
        this.edgelistWatcher.onDidChange(() => this.queueEdgelistRefresh());
        this.edgelistWatcher.onDidCreate(() => this.queueEdgelistRefresh());
        this.disposables.push(this.edgelistWatcher);

        log.info('Watchers started');
    }

    public stop() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.sourceWatcher = undefined;
        this.archWatcher = undefined;
        this.treeWatcher = undefined;
        this.edgelistWatcher = undefined;
        log.info('Watchers stopped');
    }

    /**
     * Add a path to the watched set.
     */
    public addWatchedPath(relativePath: string) {
        this.watchedPaths.add(relativePath);
        log.debug('Added to watch', { relativePath });
    }

    /**
     * Remove a path from the watched set.
     */
    public removeWatchedPath(relativePath: string) {
        this.watchedPaths.delete(relativePath);
        log.debug('Removed from watch', { relativePath });
    }

    /**
     * Check if a file is in the watched set (exact match).
     */
    private isInWatchedPath(relativePath: string): boolean {
        return this.watchedPaths.has(relativePath);
    }

    private queueSourceRebuild(uri: vscode.Uri) {
        // Track the changed file
        const relativePath = path.relative(this.ctx.workspaceRoot, uri.fsPath).replace(/\\/g, '/');
        this.pendingChangedFiles.add(relativePath);

        if (this.debounceTimers.source) clearTimeout(this.debounceTimers.source);

        this.debounceTimers.source = setTimeout(async () => {
            const changedFiles = Array.from(this.pendingChangedFiles);
            this.pendingChangedFiles.clear();

            // Filter to only files in watched paths
            const watchedChangedFiles = changedFiles.filter(f => this.isInWatchedPath(f));

            if (watchedChangedFiles.length === 0) {
                log.debug('Source files changed (not in watched paths)', { changedFiles });
                return;
            }

            log.info('Watched files changed, regenerating edges', { watchedChangedFiles });
            try {
                for (const file of watchedChangedFiles) {
                    await scanFile(this.ctx, { filePath: file });
                }

                // Refresh the webview data
                await this.sendUpdate();
            } catch (e) {
                log.error('Source rebuild failed', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 500);
    }

    private queueArchConvert() {
        if (this.debounceTimers.arch) clearTimeout(this.debounceTimers.arch);

        this.debounceTimers.arch = setTimeout(async () => {
            log.debug('Arch changed - refreshing design docs...');
            try {
                await this.sendUpdate();
            } catch (e) {
                log.error('Arch refresh failed', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 300);
    }

    private queueTreeRefresh() {
        if (this.debounceTimers.tree) clearTimeout(this.debounceTimers.tree);

        this.debounceTimers.tree = setTimeout(async () => {
            log.debug('File system changed - refreshing tree...');
            try {
                await this.sendUpdate();
            } catch (e) {
                log.error('Tree refresh failed', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 500);
    }

    private queueEdgelistRefresh() {
        if (this.debounceTimers.edgelist) clearTimeout(this.debounceTimers.edgelist);

        this.debounceTimers.edgelist = setTimeout(async () => {
            log.debug('Edge list changed - refreshing graphs...');
            try {
                await this.sendUpdate();
            } catch (e) {
                log.error('Edgelist refresh failed', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }, 300);
    }

    public async sendUpdate() {
        try {
            const raw = await collectViewerData(this.ctx);
            const designDocs = await renderRawDesignDocs(raw.designDocs);
            const data: WebviewData = {
                graphData: raw.graphData,
                workTree: raw.workTree,
                designDocs,
            };
            this.onUpdate(data);
            log.debug('Update sent');
        } catch (e) {
            log.error('Failed to collect data', {
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
}

/**
 * Render raw markdown into `DesignDoc` shape. Mirrors the panel-side
 * helper in `panel.ts`. Loop 19 routes both helpers through the
 * centralized `renderMarkdown` (`src/webview/markdown-renderer.ts`).
 */
async function renderRawDesignDocs(raw: Record<string, string>): Promise<Record<string, DesignDoc>> {
    const out: Record<string, DesignDoc> = {};
    for (const [key, markdown] of Object.entries(raw)) {
        try {
            const html = await renderMarkdown(markdown);
            out[key] = { markdown, html };
        } catch (e) {
            log.error('Failed to render design doc', {
                key,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return out;
}
