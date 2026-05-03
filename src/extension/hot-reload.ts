
import * as vscode from 'vscode';
import * as path from 'path';
import { collectViewerData } from '../application/viewer-data';
import { ParserRegistry } from '../parser/registry';
import { scanFile } from '../application/scan';
import type { Logger as BoundaryLogger } from '../core/logger';
import { createLogger } from '../common/logger';
import { asWorkspaceRoot, asAbsPath } from '../core/paths';
import { WorkspaceIO } from '../workspace/workspace-io';
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

    /**
     * L24: realpath-strong I/O surface, lazily constructed on first scan.
     * `WorkspaceIO.create` is async (it realpaths the root once), so we
     * cannot build it eagerly in the synchronous constructor / `start()`.
     */
    private _io: WorkspaceIO | null = null;

    private onUpdate: (data: WebviewData) => void;

    // Loop 20: bridge the application-layer boundary `Logger` interface
    // through the structured logger. Same shape as before; the targets
    // are now leveled scope='hot-reload' calls instead of raw console.
    private readonly _scanLogger: BoundaryLogger = {
        info: (m) => log.info(m),
        warn: (m) => log.warn(m),
        error: (m) => log.error(m),
    };

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

        log.info('Starting watchers...');
        log.info('Project root', { projectRoot: this.projectRoot });
        log.info('Artifact root', { artifactRoot: this.artifactRoot });
        log.info('Arch root', { archRoot: this.archRoot });

        // Watch source files -> refresh graphs
        const extensions = ParserRegistry.getInstance().getSupportedExtensions();
        const extPattern = extensions.map(e => e.replace(/^\./, '')).join(',');

        log.info('Watching extensions', { extensions: extPattern });

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
     * Lazily construct (and cache) the workspace-scoped I/O surface.
     * L24: `WorkspaceIO.create` realpaths the workspace root once.
     */
    private async getIO(): Promise<WorkspaceIO> {
        if (!this._io) {
            this._io = await WorkspaceIO.create(asWorkspaceRoot(this.projectRoot));
        }
        return this._io;
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
        const relativePath = path.relative(this.projectRoot, uri.fsPath).replace(/\\/g, '/');
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
                const io = await this.getIO();
                for (const file of watchedChangedFiles) {
                    await scanFile({
                        workspaceRoot: asWorkspaceRoot(this.projectRoot),
                        filePath: file,
                        artifactDir: this.artifactRoot,
                        io,
                        logger: this._scanLogger,
                    });
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
            const raw = await collectViewerData({
                workspaceRoot: asWorkspaceRoot(this.projectRoot),
                artifactRoot: asAbsPath(this.artifactRoot),
                logger: this._scanLogger,
            });
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
