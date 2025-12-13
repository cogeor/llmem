/**
 * Service to resolve and fetch design docs.
 */
export class DesignDocService {
    /**
     * @param {string} path - The selected file/folder path (e.g. src/utils/foo.ts)
     * @param {string} type - "file" or "directory"
     * @returns {Promise<string|null>} - The HTML/Text content or null if not found
     */
    async fetchDesignDoc(selectedPath, selectedType) {
        if (!selectedPath) return null;

        // Check for bundled docs first (in case we revert to file://)
        const bundledDocs = window.DESIGN_DOCS || {};

        // Normalize initial path to remove extension if it matches common pattern
        // e.g. src/foo.ts -> src/foo (because we look for arch/src/foo.txt)
        // AND Normalize separators to forward slashes for matching bundled keys
        let currentPath = selectedPath.replace(/\\/g, '/');
        if (selectedType === 'file') {
            const lastDotIndex = currentPath.lastIndexOf('.');
            if (lastDotIndex > 0) {
                currentPath = currentPath.substring(0, lastDotIndex);
            }
        }

        // Loop to find doc or parent doc
        while (currentPath !== null) {
            // Check both full path identity and basename matching (for flat arch structure)

            // Candidates to check:
            // 1. Full path: "src/extension.html"
            // 2. Basename: "extension.html" (heuristic for flat structure mapping to folder name)

            const candidates = [
                currentPath,
                currentPath.split('/').pop() // basename
            ];

            for (const baseName of candidates) {
                if (!baseName) continue;

                const htmlKey = `${baseName}.html`;
                const txtKey = `${baseName}.txt`;

                // 1. Try bundled
                if (bundledDocs[htmlKey]) return bundledDocs[htmlKey];
                if (bundledDocs[txtKey]) return bundledDocs[txtKey];

                // 2. Try Fetch (for server mode)
                // We prefer HTML if user says they are HTML
                const extensions = ['.html', '.txt'];
                for (const ext of extensions) {
                    const archUrl = `arch/${baseName}${ext}`;
                    try {
                        const res = await fetch(archUrl);
                        if (res.ok) {
                            return await res.text();
                        }
                    } catch (e) {
                        // console.debug(`Fetch failed for ${archUrl}`);
                    }
                }
            }

            if (currentPath === "") {
                break;
            }

            // Move to parent
            const lastSlash = currentPath.lastIndexOf('/');
            if (lastSlash === -1) {
                currentPath = ""; // Attempt root one last time
            } else {
                currentPath = currentPath.substring(0, lastSlash);
            }
        }

        return null; // Not found
    }
}
