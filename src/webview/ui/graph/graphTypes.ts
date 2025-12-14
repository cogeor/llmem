/**
 * Types for graph rendering.
 */

import { VisNode, VisEdge, WorkTreeNode, DirectoryNode } from '../types';

/**
 * A folder region computed by treemap layout.
 */
export interface FolderRegion {
    path: string;
    label: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    depth: number;
    nodeCount: number;
    children: FolderRegion[];
}

/**
 * A file region within a folder (for call graph function grouping).
 */
export interface FileRegion {
    path: string;       // Full file path (e.g., "src/extension/panel.ts")
    label: string;      // File name only (e.g., "panel.ts")
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    nodeCount: number;  // Number of functions in this file
}

/**
 * Result of hierarchical layout computation.
 */
export interface LayoutResult {
    folders: FolderRegion[];
    fileRegions: FileRegion[];
    nodePositions: Map<string, { x: number; y: number }>;
}

/**
 * Node with position data for force simulation.
 */
export interface PositionedNode extends VisNode {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    fx?: number | null;  // Fixed x position
    fy?: number | null;  // Fixed y position
    folderPath?: string; // Which folder this node belongs to
}

/**
 * Options for graph renderer.
 */
export interface GraphRenderOptions {
    width: number;
    height: number;
    onNodeClick?: (nodeId: string) => void;
    onFolderClick?: (folderPath: string) => void;
    onFileClick?: (filePath: string) => void;
}

/**
 * Style configuration for folder groups.
 */
export interface GroupStyle {
    fill: string;
    stroke: string;
    strokeWidth: number;
    borderRadius: number;
    labelFontSize: number;
    labelColor: string;
}

/**
 * Options for node positioning within a folder.
 */
export interface PositioningOptions {
    padding: number;
    repulsionStrength: number;
    linkStrength: number;
    maxIterations: number;
}

/**
 * Edge rendering style.
 */
export type EdgeStyle = 'straight' | 'curved' | 'bezier';
