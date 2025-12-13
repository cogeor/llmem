
// Mocking the class logic for testing (Updated with Fixes)

class GraphViewLogic {
    computeDisplayedName(nodeLabel: string, currentPath: string | null): string {
        if (!currentPath) return nodeLabel;

        // Normalize
        const normLabel = nodeLabel.replace(/\\/g, '/');
        const normPath = currentPath.replace(/\\/g, '/');

        // Handle Call Graph labels which might be "path/to/file.ts:functionName"
        // We only want to relativize the file path part.
        let filePath = normLabel;
        let suffix = "";

        // Find the colon separator. 
        // Note: Windows paths shouldn't have colons here because we use fileId which is relative from root.
        const colonIndex = normLabel.lastIndexOf(':');
        if (colonIndex !== -1) {
            filePath = normLabel.substring(0, colonIndex);
            suffix = normLabel.substring(colonIndex);
        }

        const relative = this.getRelativePath(normPath, filePath);
        return relative + suffix;
    }

    getRelativePath(from: string, to: string): string {
        // Normalize slashes and split
        const normalize = (p: string) => p ? p.replace(/\\/g, '/').split('/').filter(x => x.length > 0) : [];
        const fromParts = normalize(from);
        const toParts = normalize(to);

        let i = 0;
        // Case-insensitive comparison for Windows robustness
        while (i < fromParts.length && i < toParts.length &&
            fromParts[i].toLowerCase() === toParts[i].toLowerCase()) {
            i++;
        }

        const upMoves = fromParts.length - i;
        const downMoves = toParts.slice(i);

        let result = "";
        if (upMoves > 0) {
            result += "../".repeat(upMoves);
        }

        if (downMoves.length > 0) {
            result += downMoves.join('/');
        } else if (upMoves === 0) {
            // Exact match (file selected)
            const lastPart = toParts[toParts.length - 1];
            return lastPart;
        }

        return result;
    }
}

const logic = new GraphViewLogic();

interface TestCase {
    from: string;
    to: string;
    expect: string;
}

const testCases: TestCase[] = [
    { from: "src/webview", to: "src/webview/generator.ts", expect: "generator.ts" },
    { from: "src/webview", to: "src/graph/index.ts", expect: "../graph/index.ts" },
    { from: "src", to: "src/webview/generator.ts", expect: "webview/generator.ts" },
    { from: "", to: "src/webview/generator.ts", expect: "src/webview/generator.ts" },
    { from: "src/webview/components", to: "src/utils.ts", expect: "../../utils.ts" },
    // Call Graph cases
    { from: "src/webview", to: "src/webview/generator.ts:func", expect: "generator.ts:func" },
    { from: "src/webview", to: "src/graph/index.ts:func", expect: "../graph/index.ts:func" },
    // Specific failure case user mentioned (deep to other deep)
    { from: "src/webview/js/components", to: "src/graph/index.ts", expect: "../../../graph/index.ts" },
    // Case sensitivity test
    { from: "src/Webview", to: "src/webview/generator.ts", expect: "generator.ts" }
];

console.log("Running Tests...");
let failed = false;
testCases.forEach(tc => {
    const actual = logic.computeDisplayedName(tc.to, tc.from);
    if (actual !== tc.expect) {
        console.log(`[FAIL] From: "${tc.from}" To: "${tc.to}"`);
        console.log(`    Expected: "${tc.expect}"`);
        console.log(`    Actual:   "${actual}"`);
        failed = true;
    } else {
        console.log(`[PASS] From: "${tc.from}" -> "${actual}"`);
    }
});

if (failed) process.exit(1);
