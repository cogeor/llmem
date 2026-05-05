/**
 * Watch-state derivation for the Worktree component.
 *
 * Loop 16 — extracted from `Worktree.ts`. The source of truth for
 * the watch state is currently the rendered DOM (the `.status-btn`
 * elements with `data-path`). Migrating to a model-only calculator
 * is a larger lift (the orchestrator would need its own
 * node-by-path map); deferred to a future loop.
 *
 * The `WatchStateCalculator` interface lets future loops swap a
 * model-based implementation in place of the DOM-based one without
 * breaking import sites. `createWatchStateCalculator()` returns the
 * default DOM-based implementation today.
 */

export interface WatchStateCalculator {
    /**
     * Update toggle-button colors for the current watched-file set.
     * Mirrors the pre-loop-16 `Worktree.updateWatchedButtons`.
     */
    updateButtons(rootEl: HTMLElement, watchedFiles: ReadonlySet<string>): void;

    /**
     * Returns true iff every parsable file under `folderPath` is in
     * `watchedFiles`. Returns false for empty folders.
     */
    areAllDescendantsWatched(
        rootEl: HTMLElement,
        folderPath: string,
        watchedFiles: ReadonlySet<string>,
    ): boolean;

    /**
     * Returns true iff at least one file under `folderPath` is in
     * `watchedFiles`.
     */
    hasWatchedDescendant(
        rootEl: HTMLElement,
        folderPath: string,
        watchedFiles: ReadonlySet<string>,
    ): boolean;

    /**
     * All file-typed `data-path` values under `folderPath` (excluding
     * the folder itself).
     */
    collectAllFilePaths(rootEl: HTMLElement, folderPath: string): string[];
}

/**
 * Default DOM-based watch-state calculator.
 */
class DomWatchStateCalculator implements WatchStateCalculator {
    collectAllFilePaths(rootEl: HTMLElement, folderPath: string): string[] {
        const filePaths: string[] = [];
        const buttons = rootEl.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const btnPath = (btn as HTMLElement).dataset.path;
            const nodeEl = btn.closest('.tree-node') as HTMLElement | null;
            const isFile = nodeEl?.dataset.type === 'file';
            if (btnPath && isFile && btnPath.startsWith(folderPath + '/')) {
                filePaths.push(btnPath);
            }
        });
        return filePaths;
    }

    areAllDescendantsWatched(
        rootEl: HTMLElement,
        folderPath: string,
        watchedFiles: ReadonlySet<string>,
    ): boolean {
        const descendants = this.collectAllFilePaths(rootEl, folderPath);
        if (descendants.length === 0) return false;
        for (const filePath of descendants) {
            if (!watchedFiles.has(filePath)) return false;
        }
        return true;
    }

    hasWatchedDescendant(
        rootEl: HTMLElement,
        folderPath: string,
        watchedFiles: ReadonlySet<string>,
    ): boolean {
        const descendants = this.collectAllFilePaths(rootEl, folderPath);
        for (const filePath of descendants) {
            if (watchedFiles.has(filePath)) return true;
        }
        return false;
    }

    updateButtons(rootEl: HTMLElement, watchedFiles: ReadonlySet<string>): void {
        const buttons = rootEl.querySelectorAll('.status-btn');
        buttons.forEach(btn => {
            const btnPath = (btn as HTMLElement).dataset.path;
            const nodeEl = btn.closest('.tree-node') as HTMLElement | null;
            const isDir = nodeEl?.dataset.type === 'directory';
            if (!btnPath) return;

            const isWatched = isDir
                ? this.areAllDescendantsWatched(rootEl, btnPath, watchedFiles)
                : watchedFiles.has(btnPath);
            (btn as HTMLElement).style.backgroundColor = isWatched ? '#4ade80' : '#ccc';
        });
    }
}

export function createWatchStateCalculator(): WatchStateCalculator {
    return new DomWatchStateCalculator();
}
