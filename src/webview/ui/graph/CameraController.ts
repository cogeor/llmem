/**
 * Camera Controller - No D3
 * 
 * Pan and zoom using SVG transform.
 * Tracks drag distance to differentiate click from drag.
 */

import { FolderRegion } from './graphTypes';

const DRAG_THRESHOLD = 5;  // pixels moved to consider it a drag

export class CameraController {
    private svg: SVGSVGElement;
    private mainGroup: SVGGElement;
    private width: number;
    private height: number;

    private scale: number = 1;
    private translateX: number = 0;
    private translateY: number = 0;

    private nodePositions: Map<string, { x: number; y: number }> = new Map();
    private folderRegions: FolderRegion[] = [];

    private isPanning: boolean = false;
    private lastX: number = 0;
    private lastY: number = 0;
    private startX: number = 0;
    private startY: number = 0;
    private dragDistance: number = 0;

    constructor(
        svg: SVGSVGElement,
        mainGroup: SVGGElement,
        width: number,
        height: number
    ) {
        this.svg = svg;
        this.mainGroup = mainGroup;
        this.width = width;
        this.height = height;

        this.setupEvents();
    }

    /**
     * Check if the last mouse interaction was a drag (not a click).
     */
    wasDrag(): boolean {
        return this.dragDistance > DRAG_THRESHOLD;
    }

    /**
     * Setup pan and zoom events.
     */
    private setupEvents(): void {
        // Zoom with wheel
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.1, Math.min(4, this.scale * scaleFactor));

            const rect = this.svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const dx = mouseX - this.translateX;
            const dy = mouseY - this.translateY;

            this.translateX -= dx * (newScale / this.scale - 1);
            this.translateY -= dy * (newScale / this.scale - 1);
            this.scale = newScale;

            this.updateTransform();
        });

        // Pan with mouse drag - listen on svg
        this.svg.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.isPanning = true;
                this.lastX = e.clientX;
                this.lastY = e.clientY;
                this.startX = e.clientX;
                this.startY = e.clientY;
                this.dragDistance = 0;
                this.svg.style.cursor = 'grabbing';
            }
        });

        // Also reset dragDistance for clicks on child elements (nodes, folders, files)
        // This fixes clicks not registering when dragDistance wasn't reset
        this.mainGroup.addEventListener('mousedown', () => {
            this.dragDistance = 0;
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                const dx = e.clientX - this.lastX;
                const dy = e.clientY - this.lastY;
                this.translateX += dx;
                this.translateY += dy;
                this.lastX = e.clientX;
                this.lastY = e.clientY;

                // Track total drag distance
                this.dragDistance = Math.sqrt(
                    Math.pow(e.clientX - this.startX, 2) +
                    Math.pow(e.clientY - this.startY, 2)
                );

                this.updateTransform();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPanning = false;
            this.svg.style.cursor = 'grab';
        });

        this.svg.style.cursor = 'grab';
    }

    /**
     * Update transform.
     */
    private updateTransform(animate: boolean = false): void {
        const transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;

        if (animate) {
            this.mainGroup.style.transition = 'transform 0.4s ease-out';
            setTimeout(() => {
                this.mainGroup.style.transition = '';
            }, 400);
        }

        this.mainGroup.style.transform = transform;
    }

    /**
     * Set positions for navigation.
     */
    setPositions(
        nodePositions: Map<string, { x: number; y: number }>,
        folderRegions: FolderRegion[]
    ): void {
        this.nodePositions = nodePositions;
        this.folderRegions = folderRegions;
    }

    /**
     * Focus on a node.
     */
    focusNode(nodeId: string, options: { animate?: boolean } = {}): void {
        const pos = this.nodePositions.get(nodeId);
        if (!pos) return;

        this.panToPoint(pos.x, pos.y, 1.2, options.animate ?? true);
    }

    /**
     * Focus on a folder.
     */
    focusFolder(folderPath: string, options: { animate?: boolean } = {}): void {
        const folder = this.folderRegions.find(f => f.path === folderPath);
        if (!folder) return;

        const centerX = (folder.x0 + folder.x1) / 2;
        const centerY = (folder.y0 + folder.y1) / 2;

        const folderWidth = folder.x1 - folder.x0;
        const folderHeight = folder.y1 - folder.y0;

        const scaleX = (this.width - 80) / folderWidth;
        const scaleY = (this.height - 80) / folderHeight;
        const scale = Math.min(scaleX, scaleY, 2);

        this.panToPoint(centerX, centerY, scale, options.animate ?? true);
    }

    /**
     * Pan to a point.
     */
    private panToPoint(x: number, y: number, scale: number, animate: boolean): void {
        this.scale = scale;
        this.translateX = this.width / 2 - x * scale;
        this.translateY = this.height / 2 - y * scale;
        this.updateTransform(animate);
    }

    /**
     * Fit all content.
     */
    fitAll(animate: boolean = true): void {
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform(animate);
    }
}
