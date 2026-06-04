/**
 * Graph Status — display helpers.
 *
 * Pure presentation helpers split out of `graph-status.ts` (Loop 09 relocation
 * from src/webview to the application layer) to keep the status-computation
 * module under the application file-size budget. They map a `GraphStatus` to a
 * combined badge status and to a UI color and have no dependency on the folder
 * scan/edge-list machinery.
 */

import { GraphStatus } from './worktree';

/**
 * Get combined status for display (green/orange/red).
 * - 'current' (green): both import and call are current
 * - 'outdated' (orange): at least one is outdated
 * - 'never' (red): at least one has never been computed
 */
export function getCombinedStatus(importStatus: GraphStatus, callStatus: GraphStatus): GraphStatus {
    if (importStatus === 'never' || callStatus === 'never') {
        return 'never';
    }
    if (importStatus === 'outdated' || callStatus === 'outdated') {
        return 'outdated';
    }
    return 'current';
}

/**
 * Get status color for UI display.
 */
export function getStatusColor(status: GraphStatus): string {
    switch (status) {
        case 'current': return '#22c55e';   // Green
        case 'outdated': return '#f97316';  // Orange
        case 'never': return '#ef4444';     // Red
    }
}
