/**
 * Tree HTML renderer for the Worktree component.
 *
 * Loop 16 — extracted from `Worktree.ts` to keep the orchestrator
 * under the 250-line target and to give the rendering logic a
 * test-friendly seam (returns HTML strings, no DOM mutation).
 *
 * Pure rendering: no state, no event listeners, no logger calls.
 * Output is the inner HTML for the `<ul class="tree-list">` root —
 * the orchestrator owns the `innerHTML` assignment.
 */

import { WorkTreeNode, FileNode, DirectoryNode } from '../../types';
import { folder, file, chevronRight } from '../../icons';
import { escape } from '../../utils/escape';

export class TreeHtmlRenderer {
    /**
     * Render the full tree. Returns the inner HTML for the
     * `<ul class="tree-list">` root.
     */
    render(rootNode: WorkTreeNode): string {
        return this.renderNode(rootNode, 0);
    }

    /**
     * Check if a file node is parsable.
     *
     * Loop 12: reads the precomputed `isSupported` flag attached
     * server-side by `src/webview/worktree.ts::generateWorkTree`.
     * Falls back to `false` if the field is missing (e.g. older
     * cached worktree blobs) — such files are still rendered, just
     * not toggleable.
     */
    isParsableFile(node: FileNode): boolean {
        return (node as FileNode & { isSupported?: boolean }).isSupported === true;
    }

    /**
     * PH-04: a file whose extension is a known source type but whose
     * tree-sitter grammar is not installed at runtime. Such files render a
     * muted install-hint marker instead of a live (no-op) watch toggle.
     */
    needsGrammar(node: FileNode): boolean {
        return (node as FileNode & { needsGrammar?: boolean }).needsGrammar === true;
    }

    /** Check if a directory contains any parsable files (recursively). */
    hasAnyParsableFiles(dirNode: WorkTreeNode): boolean {
        if (dirNode.type === 'file') {
            return this.isParsableFile(dirNode as FileNode);
        }
        if (dirNode.type === 'directory' && (dirNode as DirectoryNode).children) {
            for (const child of (dirNode as DirectoryNode).children) {
                if (this.hasAnyParsableFiles(child)) return true;
            }
        }
        return false;
    }

    /**
     * Render a single tree node (and its descendants) at the given
     * depth. Mirrors the pre-loop-16 `Worktree.renderNode` byte for
     * byte: every `escape()` call, every inline-style block, every
     * conditional branch is preserved.
     */
    private renderNode(node: WorkTreeNode, depth: number): string {
        const isDir = node.type === 'directory';
        const showToggle = isDir
            ? this.hasAnyParsableFiles(node)
            : this.isParsableFile(node as FileNode);
        const statusTitle = showToggle
            ? `Click to toggle file watching for this ${isDir ? 'folder' : 'file'}.`
            : '';

        // Loop 13: escape every filesystem-derived string before
        // interpolation. node.path and node.name come from the
        // worktree data and could contain any character a filesystem
        // allows, including `<`, `"`, `'`. The `data-path` attribute
        // is also read back via CSS selectors using `CSS.escape` at
        // lookup time, so the escaped form round-trips fine. node.type
        // is a controlled string union ('file' | 'directory') and does
        // not need escaping; the same applies to icon SVG strings
        // imported from icons.ts (author-controlled).
        const safePath = escape(node.path);
        const safeName = escape(node.name);

        // PH-04: 3rd state — a known source file whose grammar is missing.
        // Distinct muted marker (NOT a live toggle), shown only when the file
        // is not toggleable so the existing toggle path stays unchanged.
        const showNeedsGrammar = !showToggle && !isDir && this.needsGrammar(node as FileNode);
        const installHint = showNeedsGrammar
            ? (node as FileNode & { installHint?: string }).installHint ?? 'the grammar'
            : '';
        const needsGrammarTitle = `Install ${installHint} to analyze this file`;

        let html = `
            <li class="tree-node" data-path="${safePath}" data-type="${node.type}">
                <div class="tree-item" style="padding-left: ${depth * 12 + 12}px">
                    ${isDir ? `<span class="tree-arrow">${chevronRight}</span>` : ''}
                    <span class="icon">${isDir ? folder : file}</span>
                    <span class="label">${safeName}</span>
                    ${showToggle ? `<button class="status-btn" data-path="${safePath}" title="${statusTitle}" style="
                        width: 12px;
                        height: 12px;
                        min-width: 12px;
                        min-height: 12px;
                        box-sizing: border-box;
                        border-radius: 50%;
                        border: none;
                        background-color: #ccc;
                        margin-left: auto;
                        cursor: pointer;
                        flex-shrink: 0;
                    "></button>` : ''}
                    ${showNeedsGrammar ? `<span class="needs-grammar" title="${escape(needsGrammarTitle)}" style="
                        width: 12px;
                        height: 12px;
                        min-width: 12px;
                        min-height: 12px;
                        box-sizing: border-box;
                        border-radius: 50%;
                        border: 1px dashed #999;
                        background-color: transparent;
                        margin-left: auto;
                        opacity: 0.5;
                        flex-shrink: 0;
                    "></span>` : ''}
                </div>
        `;

        if (isDir && (node as DirectoryNode).children) {
            html += `<ul class="tree-children" data-path="${safePath}">`;
            (node as DirectoryNode).children.forEach(child => {
                html += this.renderNode(child, depth + 1);
            });
            html += `</ul>`;
        }

        html += `</li>`;
        return html;
    }
}
