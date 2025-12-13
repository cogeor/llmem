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

            const candidates = [];

            // 1. Full path (e.g. "src/extension")
            candidates.push(currentPath);

            // 2. Basename (e.g. "extension" from "src/extension")
            // Only if different from full path
            const baseName = currentPath.split('/').pop();
            if (baseName && baseName !== currentPath) {
                candidates.push(baseName);
            }

            // PHASE 1: Check Bundle (Priority)
            // Verify all candidates in the bundle first to avoid unnecessary 404 network logs
            for (const key of candidates) {
                const htmlKey = `${key}.html`;
                const txtKey = `${key}.txt`;

                if (bundledDocs[htmlKey]) return bundledDocs[htmlKey];
                if (bundledDocs[txtKey]) return bundledDocs[txtKey];
            }

            // PHASE 2: Fetch (Fallthrough - ONLY if bundle is empty)
            // If we have a populated bundle, we assume it's authoritative.
            const hasBundle = Object.keys(bundledDocs).length > 0;
            // DEBUG: Check if we are seeing the bundle
            // console.log(`DesignDocService: hasBundle=${hasBundle}, count=${Object.keys(bundledDocs).length}`);

            if (!hasBundle) {
                // If no bundle, we must fetch
                for (const key of candidates) {
                    const extensions = ['.html', '.txt'];
                    for (const ext of extensions) {
                        const archUrl = `arch/${key}${ext}`;
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
            } else {
                // Bundle exists but file not found in it. Return null.
                // console.log(`DesignDocService: Bundle active. '${currentPath}' not found in bundle. Skipping fetch.`);
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
