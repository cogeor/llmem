import * as fs from 'fs';
import * as path from 'path';
import { generateWorkTree, ITreeNode } from './worktree';
import { prepareWebviewData, WebviewGraphData } from '../graph/webview-data';
import { DesignDocManager } from './design-docs';
import { ensureArtifacts } from '../artifact/service';

export interface WebviewData {
    graphData: WebviewGraphData;
    workTree: ITreeNode;
    designDocs: { [key: string]: string };
}

/**
 * Service to aggregate all data needed for the webview.
 * Shared by both the static generator and the vscode extension.
 */
export class WebviewDataService {

    /**
    /**
     * Collects all data required for the webview.
     * 
     * @param projectRoot Root directory of the project to analyze
     * @param artifactRoot Root directory of the artifacts (e.g. .artifacts)
     */
    static async collectData(projectRoot: string, artifactRoot: string): Promise<WebviewData> {

        // Ensure artifacts exist for the project
        try {
            await ensureArtifacts(projectRoot, true);
        } catch (error) {
            console.error('Failed to ensure artifacts:', error);
            // Fallthrough to attempt reading what exists
        }

        // Ensure .arch exists
        const archRoot = path.join(projectRoot, '.arch');
        if (!fs.existsSync(archRoot)) {
            try {
                fs.mkdirSync(archRoot, { recursive: true });
            } catch (e) {
                console.error('Failed to create .arch directory:', e);
            }
        }

        // 1. Graph Data
        const graphData = await prepareWebviewData(artifactRoot);

        // 2. Work Tree
        // We scan the entire project root (ignoring node_modules etc via blacklist in worktree.ts)
        const workTree = await generateWorkTree(projectRoot, projectRoot);

        // 3. Design Docs
        // Use DesignDocManager to read from project root/.arch (dynamically converted)
        const docManager = new DesignDocManager(projectRoot);
        const designDocs = await docManager.getAllDocsAsync();

        return {
            graphData,
            workTree,
            designDocs
        };
    }
}
