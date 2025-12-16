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

    private minScale: number = 0.1;
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

    private contentBounds: { x: number; y: number; width: number; height: number } | null = null;

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
     * Set the bounds of the content to constrain panning.
     */
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
        this.contentBounds = bounds;
        // Re-clamp current position if needed
        this.clampTranslation();
        this.updateTransform();
    }

    /**
     * Resize the camera viewport.
     */
    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
        this.clampTranslation();
        this.updateTransform();
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
        // Zoom/Scroll with wheel
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();

            if (e.ctrlKey || e.metaKey) {
                // ZOOM
                const sensitivity = 0.001;
                const zoomFactor = 1 - e.deltaY * sensitivity;
                let newScale = this.scale * zoomFactor;

                // Clamp scale
                // Min scale is dynamic based on fit-to-width
                newScale = Math.max(this.minScale, Math.min(newScale, 5.0));

                if (newScale === this.scale) return;

                // Zoom towards mouse position
                const rect = this.svg.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Calculate world point under mouse
                const worldX = (mouseX - this.translateX) / this.scale;
                const worldY = (mouseY - this.translateY) / this.scale;

                // Update scale
                this.scale = newScale;

                // Update translation to keep world point under mouse
                this.translateX = mouseX - worldX * this.scale;
                this.translateY = mouseY - worldY * this.scale;

            } else {
                // PAN (Scroll) - 2D scrolling
                this.translateX -= e.deltaX;
                this.translateY -= e.deltaY;
            }

            this.clampTranslation();
            this.updateTransform();
        }, { passive: false });

        // Pan with mouse drag - listen on svg
        this.svg.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                e.preventDefault(); // Prevent text selection
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
        this.mainGroup.addEventListener('mousedown', () => {
            this.dragDistance = 0;
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                // Free 2D panning
                const dx = e.clientX - this.lastX;
                const dy = e.clientY - this.lastY;

                this.translateX += dx;
                this.translateY += dy;

                this.lastX = e.clientX;
                this.lastY = e.clientY;

                // Track total drag distance (still useful for distinguishing clicks)
                this.dragDistance = Math.sqrt(
                    Math.pow(e.clientX - this.startX, 2) +
                    Math.pow(e.clientY - this.startY, 2)
                );

                this.clampTranslation();
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
     * Constraint translation to keep content visible.
     */
    private clampTranslation(): void {
        if (!this.contentBounds) return;

        // Margin to keep visible (in pixels)
        const margin = 100;

        // Content bounds in screen coordinates
        // x-range: [translateX + bounds.x * scale, translateX + (bounds.x + bounds.width) * scale]
        // y-range: [translateY + bounds.y * scale, translateY + (bounds.y + bounds.height) * scale]

        const scaledWidth = this.contentBounds.width * this.scale;
        const scaledHeight = this.contentBounds.height * this.scale;

        const minTranslateX = this.width - scaledWidth - this.contentBounds.x * this.scale - margin;
        const maxTranslateX = -this.contentBounds.x * this.scale + margin;

        const minTranslateY = this.height - scaledHeight - this.contentBounds.y * this.scale - margin;
        const maxTranslateY = -this.contentBounds.y * this.scale + margin;

        // Only clamp if content is larger than viewport + margin
        // Or if we just generally want to prevent it going way off screen

        // Let's implement a simpler overlap check
        // The right edge of content must be > left edge of viewport + margin
        // The left edge of content must be < right edge of viewport - margin
        // The bottom edge of content must be > top edge of viewport + margin
        // The top edge of content must be < bottom edge of viewport - margin

        // Current content edges in screen space:
        // Left: this.translateX + this.contentBounds.x * this.scale
        // Right: Left + scaledWidth
        // Top: this.translateY + this.contentBounds.y * this.scale
        // Bottom: Top + scaledHeight

        // Constraint 1: Right > margin  => Left + scaledWidth > margin => Left > margin - scaledWidth
        // Constraint 2: Left < width - margin

        const currentLeft = this.translateX + this.contentBounds.x * this.scale;
        const currentTop = this.translateY + this.contentBounds.y * this.scale;

        let newLeft = currentLeft;
        let newTop = currentTop;

        // Horizontal Clamping
        if (newLeft > this.width - margin) {
            newLeft = this.width - margin;
        }
        if (newLeft + scaledWidth < margin) {
            newLeft = margin - scaledWidth;
        }

        // Vertical Clamping
        if (newTop > this.height - margin) {
            newTop = this.height - margin;
        }
        if (newTop + scaledHeight < margin) {
            newTop = margin - scaledHeight;
        }

        // Apply back to translateX/Y
        this.translateX += (newLeft - currentLeft);
        this.translateY += (newTop - currentTop);
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

        // Maintain current scale, just pan
        this.panToPoint(pos.x, pos.y, this.scale, options.animate ?? true);
    }

    /**
     * Focus on a folder.
     */
    focusFolder(folderPath: string, options: { animate?: boolean } = {}): void {
        const folder = this.folderRegions.find(f => f.path === folderPath);
        if (!folder) return;

        const centerX = (folder.x0 + folder.x1) / 2;
        const centerY = (folder.y0 + folder.y1) / 2;

        // Maintain current scale, just pan
        this.panToPoint(centerX, centerY, this.scale, options.animate ?? true);
    }

    /**
     * Pan to a point.
     */
    private panToPoint(x: number, y: number, scale: number, animate: boolean): void {
        this.scale = scale;
        this.translateX = this.width / 2 - x * scale;
        this.translateY = this.height / 2 - y * scale;

        this.clampTranslation();
        this.updateTransform(animate);
    }

    /**
     * Fit all content.
     */
    fitAll(animate: boolean = true): void {
        this.scale = 1;
        this.minScale = 0.5; // Reset default
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform(animate);
    }

    /**
     * Fit content to width (scrollable vertically).
     */
    fitToWidth(
        bounds: { x: number; y: number; width: number; height: number },
        padding: number = 40,
        animate: boolean = true
    ): void {
        const availableWidth = this.width - padding * 2;

        // Calculate scale to fit width
        let scale = availableWidth / bounds.width;

        // Clamp scale to reasonable limits
        scale = Math.min(Math.max(scale, 0.2), 2.0);

        this.scale = scale;

        // Allow zooming out to fit the whole graph (height-wise)
        const availableHeight = this.height - padding * 2;
        const scaleHeight = availableHeight / bounds.height;
        // Min scale should be small enough to fit the whole graph
        this.minScale = Math.min(scale, scaleHeight);

        // Center horizontally
        // x-translation needed: (viewport_width - content_width * scale) / 2 - content_x * scale
        this.translateX = (this.width - bounds.width * scale) / 2 - bounds.x * scale;

        // Align top with padding
        this.translateY = padding - bounds.y * scale;

        this.setBounds(bounds);
        // setBounds already updates transform
    }
}
