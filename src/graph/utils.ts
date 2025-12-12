import * as path from 'path';

/**
 * Normalizes a file path to a canonical repo-relative format (forward slashes).
 * e.g., "src\foo\bar.ts" -> "src/foo/bar.ts"
 */
export function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

/**
 * Derives a consistent FileID from a repo-relative path.
 */
export function deriveFileId(repoRelativePath: string): string {
    return normalizePath(repoRelativePath);
}

/**
 * Generates a global entity ID.
 */
export function deriveEntityId(fileId: string, localEntityId: string): string {
    return `${fileId}#${localEntityId}`;
}

/**
 * Generates a derived ID for call sites to ensure uniqueness.
 */
export function deriveCallSiteKey(fileId: string, callerEntityId: string, originalCallSiteId: string, index: number): string {
    return `${fileId}#${callerEntityId}#${originalCallSiteId}#${index}`;
}

export class ColorGenerator {
    /**
     * Generates colors for a set of nodes based on their folder structure.
     * Returns a map of Node ID -> Color String (HSL)
     */
    public generateColors(nodes: Iterable<any>): Map<string, string> {
        const colors = new Map<string, string>();
        const nodesByFolder = new Map<string, any[]>();

        // 1. Group by folder
        for (const node of nodes) {
            let folder = 'misc';
            // Try to extract path from known node types or fallback
            if (node.path) { // FileNode
                folder = path.dirname(node.path);
            } else if (node.fileId) { // EntityNode
                folder = path.dirname(node.fileId);
            }

            // Normalize
            folder = normalizePath(folder);

            if (!nodesByFolder.has(folder)) {
                nodesByFolder.set(folder, []);
            }
            nodesByFolder.get(folder)!.push(node);
        }

        // 2. Sort folders
        const sortedFolders = Array.from(nodesByFolder.keys()).sort();

        // 3. Assign Colors
        const totalFolders = sortedFolders.length;

        sortedFolders.forEach((folder, folderIndex) => {
            const folderNodes = nodesByFolder.get(folder)!;

            // Sort nodes within folder to be deterministic
            folderNodes.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

            // Assign Hue based on folder index (evenly distributed)
            // Use 360 degrees
            const hue = Math.floor((folderIndex / totalFolders) * 360);

            const count = folderNodes.length;

            folderNodes.forEach((node, nodeIndex) => {
                // Vary Lightness 40% - 80% to keep text readable (assuming black text? or white?)
                // If background is dark, maybe 40-70? 
                // Let's go with 50-90 if dark mode, or 30-70 if light mode?
                // VisJS default usually white text on dark nodes? No, usually black on blue.
                // Let's try 60-85% lightness for pastel/readable colors.
                // Saturation: 80%

                let lightness = 70;
                if (count > 1) {
                    // Spread between 50 and 85
                    lightness = 50 + Math.floor((nodeIndex / (count - 1)) * 35);
                }

                colors.set(node.id, `hsl(${hue}, 80%, ${lightness}%)`);
            });
        });

        return colors;
    }
}
