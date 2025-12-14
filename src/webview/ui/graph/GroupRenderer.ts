/**
 * Group Renderer - No D3
 * 
 * Renders folder containers as SVG rectangles with labels.
 * Colors based on top-level module (first folder after src).
 */

import { FolderRegion, FileRegion } from './graphTypes';

const GOLDEN_ANGLE = 137.5;

/**
 * Extract the top-level module name from a path.
 * For 'src/extension/...' returns 'extension'
 * For 'extension/...' returns 'extension'
 */
function getTopLevelModule(path: string): string {
    const parts = path.split('/').filter(p => p.length > 0);

    // Skip 'src' if it's the first part
    if (parts[0] === 'src' && parts.length > 1) {
        return parts[1];
    }

    return parts[0] || '';
}

export class GroupRenderer {
    private svg: SVGGElement;
    private moduleHues: Map<string, number> = new Map();
    private onFolderClick?: (path: string) => void;
    private onFileClick?: (path: string) => void;

    constructor(svg: SVGGElement) {
        this.svg = svg;
    }

    /**
     * Render all folder regions and optionally file regions.
     */
    render(
        folders: FolderRegion[],
        onFolderClick?: (path: string) => void,
        fileRegions?: FileRegion[],
        onFileClick?: (path: string) => void
    ): void {
        this.onFolderClick = onFolderClick;
        this.onFileClick = onFileClick;

        // Clear previous
        this.svg.innerHTML = '';

        // Assign distinct hues to each module
        this.assignModuleHues(folders);

        console.log('[GroupRenderer] Module hues:', Object.fromEntries(this.moduleHues));

        // Sort by depth (render deeper folders on top)
        const sorted = [...folders].sort((a, b) => a.depth - b.depth);

        for (const folder of sorted) {
            this.renderFolder(folder);
        }

        // Render file regions on top of folders
        if (fileRegions) {
            for (const file of fileRegions) {
                this.renderFile(file);
            }
        }
    }

    /**
     * Assign distinct hues to each unique top-level module.
     */
    private assignModuleHues(folders: FolderRegion[]): void {
        this.moduleHues.clear();

        // Collect unique module names
        const modules = new Set<string>();
        for (const folder of folders) {
            const module = getTopLevelModule(folder.path);
            if (module) modules.add(module);
        }

        // Assign hues
        const moduleList = Array.from(modules).sort();
        moduleList.forEach((module, index) => {
            this.moduleHues.set(module, (index * GOLDEN_ANGLE) % 360);
        });
    }

    /**
     * Get hue for a folder based on its module.
     */
    private getHueForFolder(folder: FolderRegion): number {
        const module = getTopLevelModule(folder.path);
        return this.moduleHues.get(module) ?? 0;
    }

    /**
     * Get colors for a folder.
     */
    private getFolderColors(folder: FolderRegion): {
        fill: string;
        stroke: string;
        labelColor: string;
    } {
        // Make 'src' folder grey
        if (folder.label === 'src' || folder.path === 'src') {
            return {
                fill: 'hsla(0, 0%, 92%, 0.4)',
                stroke: 'hsl(0, 0%, 70%)',
                labelColor: 'hsl(0, 0%, 40%)'
            };
        }

        const hue = this.getHueForFolder(folder);
        const depth = folder.depth;

        // Adjust saturation/lightness by depth for subtle variation
        const saturation = Math.max(30, 55 - depth * 5);
        const lightness = Math.min(92, 80 + depth * 3);
        const strokeLightness = Math.max(35, 50 - depth * 5);

        return {
            fill: `hsla(${hue}, ${saturation}%, ${lightness}%, 0.4)`,
            stroke: `hsl(${hue}, ${saturation + 10}%, ${strokeLightness}%)`,
            labelColor: `hsl(${hue}, ${saturation + 15}%, ${Math.max(25, strokeLightness - 5)}%)`
        };
    }

    /**
     * Render a single folder.
     */
    private renderFolder(folder: FolderRegion): void {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `folder-group folder-depth-${folder.depth}`);
        g.setAttribute('data-path', folder.path);

        const colors = this.getFolderColors(folder);
        const width = folder.x1 - folder.x0;
        const height = folder.y1 - folder.y0;

        if (width <= 0 || height <= 0) return;

        // Rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(folder.x0));
        rect.setAttribute('y', String(folder.y0));
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', String(Math.max(2, 5 - folder.depth)));
        rect.setAttribute('fill', colors.fill);
        rect.setAttribute('stroke', colors.stroke);
        rect.setAttribute('stroke-width', String(Math.max(1, 2 - folder.depth * 0.3)));
        rect.style.cursor = 'pointer';

        rect.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onFolderClick?.(folder.path);
        });

        g.appendChild(rect);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(folder.x0 + 6));
        text.setAttribute('y', String(folder.y0 + 13));
        text.setAttribute('font-size', String(Math.max(9, 11 - folder.depth)));
        text.setAttribute('fill', colors.labelColor);
        text.setAttribute('font-weight', '600');
        text.setAttribute('pointer-events', 'none');
        text.textContent = folder.label;

        g.appendChild(text);
        this.svg.appendChild(g);
    }

    /**
     * Render a single file region.
     */
    private renderFile(file: FileRegion): void {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'file-group');
        g.setAttribute('data-path', file.path);

        const width = file.x1 - file.x0;
        const height = file.y1 - file.y0;

        if (width <= 0 || height <= 0) return;

        // Rectangle with more visible dashed styling
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(file.x0));
        rect.setAttribute('y', String(file.y0));
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', 'var(--file-group-fill, rgba(255,255,255,0.08))');
        rect.setAttribute('stroke', 'var(--file-group-stroke, rgba(255,255,255,0.4))');
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '6,4');
        rect.style.cursor = 'pointer';

        rect.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onFileClick?.(file.path);
        });

        g.appendChild(rect);

        // Label (file name) - positioned at top-left of file box
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(file.x0 + 4));
        text.setAttribute('y', String(file.y0 - 2));
        text.setAttribute('font-size', '7');
        text.setAttribute('fill', 'var(--description-foreground, #888)');
        text.setAttribute('font-weight', '500');
        text.setAttribute('pointer-events', 'none');
        text.textContent = file.label;

        g.appendChild(text);
        this.svg.appendChild(g);
    }

    /**
     * Get node color based on path.
     */
    getColorForPath(path: string, depth: number): string {
        const module = getTopLevelModule(path);
        const hue = this.moduleHues.get(module) ?? 0;

        const saturation = Math.max(45, 65 - depth * 5);
        const lightness = Math.max(40, 55 - depth * 5);
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    highlightFolder(folderPath: string): void {
        const groups = this.svg.querySelectorAll('.folder-group');
        groups.forEach(g => g.classList.remove('highlighted'));

        const target = this.svg.querySelector(`[data-path="${folderPath}"]`);
        if (target) {
            target.classList.add('highlighted');
        }
    }

    highlightFile(filePath: string): void {
        const files = this.svg.querySelectorAll('.file-group');
        files.forEach(g => g.classList.remove('highlighted'));

        const target = this.svg.querySelector(`.file-group[data-path="${filePath}"]`);
        if (target) {
            target.classList.add('highlighted');
        }
    }

    clearHighlight(): void {
        const groups = this.svg.querySelectorAll('.folder-group, .file-group');
        groups.forEach(g => g.classList.remove('highlighted'));
    }
}
