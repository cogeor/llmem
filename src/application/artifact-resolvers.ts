/**
 * Import- and call-resolution helpers for {@link artifactToEdgeList}.
 *
 * Extracted from `artifact-converter.ts` (which stays under the application-layer
 * file-size budget): these are the two pure resolvers the converter delegates to
 * — `resolveImportTarget` maps an import spec to a target file/module id, and
 * `resolveCallToEdge` maps a call site to a call edge. Both are FS-free pure
 * functions. Living in `src/application/` is correct for the same reason the
 * converter does: they bridge the parser's `FileArtifact` to the graph's
 * edge-list, and the application layer is the only one allowed to depend on both.
 */

import * as path from 'path';
import { ImportSpec, CallSite } from '../parser/types';
import { EdgeEntry } from '../graph/edgelist';
import { normalizePath } from '../graph/utils';
import { ALL_SUPPORTED_EXTENSIONS } from '../parser/config';
import { makeEntityId, isExternalModuleId } from '../core/ids';

/**
 * Resolve an import to a target file ID.
 * Returns either a file path (for workspace files) or module name (for external modules).
 */
export function resolveImportTarget(sourceFileId: string, imp: ImportSpec): string | null {
    // If the import has a resolved path (from extractor), use it
    if (imp.resolvedPath) {
        return normalizePath(imp.resolvedPath);
    }

    // Try to resolve relative imports
    if (imp.source.startsWith('.')) {
        const sourceDir = path.dirname(sourceFileId);

        // Count leading dots to determine directory level
        // .a → current dir, ..a → parent, ...a → grandparent
        const dotMatch = imp.source.match(/^\.+/);
        const dotCount = dotMatch ? dotMatch[0].length : 1;

        // Remove leading dots to get module name
        const modulePart = imp.source.replace(/^\.+/, '');

        // Navigate up directories (1 dot = current dir, 2 dots = parent, etc.)
        const dotsUp = dotCount - 1;
        let targetDir = sourceDir;
        for (let i = 0; i < dotsUp; i++) {
            targetDir = path.dirname(targetDir);
        }

        // Join with module part (convert dots to path separators)
        let resolved: string;
        if (modulePart) {
            // from .a import b → ./a.py
            // from ..foo.bar import b → ../foo/bar.py
            const modulePath = modulePart.split('.').join('/');
            resolved = path.join(targetDir, modulePath);
        } else {
            // from . import b → ./__init__.py
            resolved = targetDir;
        }
        resolved = normalizePath(resolved);

        // Infer extension from source file (e.g., .py file imports .py, .ts imports .ts)
        const sourceExt = path.extname(sourceFileId);
        const defaultExt = sourceExt || '.ts';

        // Try with same extension as source file first, then common extensions
        const extensions = [defaultExt, ...ALL_SUPPORTED_EXTENSIONS.filter(e => e !== defaultExt)];
        for (const ext of extensions) {
            const candidate = resolved + ext;
            // We can't check if file exists here (no FS access in pure conversion)
            // Return first candidate with matching extension
            return candidate;
        }
        return resolved + defaultExt;
    }

    // Absolute / workspace imports - anchor the dotted module at the importing
    // file's own source root.
    //
    // For an absolute Python import like `from aipr.domain.models.contact import X`
    // the dotted module (`aipr.domain.models.contact`) must be rewritten to the
    // file node that actually exists in the graph. Under a `src/` (or any other)
    // source layout that node is `src/aipr/domain/models/contact.py` — the bare
    // `aipr/domain/models/contact.py` (no source-root prefix) never matches and
    // the edge is dropped downstream.
    //
    // Heuristic (pure — uses ONLY sourceFileId, no FS access): take the import's
    // top segment T (`aipr`). If T appears as a DIRECTORY segment in the
    // importer's own path, the prefix before it is the importer's source root;
    // anchor the dotted module there. If T is NOT one of the importer's
    // directory segments, the import refers to an external package (e.g.
    // `sqlalchemy.ext.asyncio`, top `sqlalchemy`) → return T as a bare external
    // module id.
    //
    // KNOWN LIMITATION: cross-top-package internal imports within a single
    // source root (an importer under `src/aipr` importing a sibling top-level
    // package such as `src/other`) are classified external, because `other`
    // never appears in the importer's own path. This is acceptable: the common
    // case (and aipr specifically) has a single top-level package per source
    // root, for which importer-path anchoring is exact.
    if (!imp.source.includes('node_modules')) {
        if (!imp.source.startsWith('.')) {
            const moduleParts = imp.source.split('.');
            const top = moduleParts[0];

            // Importer path segments, excluding the final basename (we only
            // anchor on DIRECTORY segments). Use the FIRST/outermost match.
            const segments = sourceFileId.split('/');
            const dirSegments = segments.slice(0, -1);
            const idx = dirSegments.indexOf(top);

            if (idx >= 0) {
                const prefix = segments.slice(0, idx); // source root before `top`
                const sourceExt = path.extname(sourceFileId) || '.ts';
                const resolved = [...prefix, ...moduleParts].join('/') + sourceExt;
                return normalizePath(resolved);
            }

            // `top` is not part of the importer's path → external package.
            // Return the bare top segment so isExternalModuleId() classifies it
            // as external (no slash and no entity separator).
            return top;
        }

        return imp.source; // Return module name (e.g., 'pathlib', 'os', 'json')
    }

    return null;
}

/**
 * Resolve a call site to an edge.
 */
export function resolveCallToEdge(
    fileId: string,
    callerNodeId: string,
    call: CallSite,
    imports: ImportSpec[],
    externalModules: Set<string>
): EdgeEntry | null {
    // If the call has a resolved definition, use it
    if (call.resolvedDefinition) {
        let targetFileId = call.resolvedDefinition.file;

        // Check if this is a builtin (skip creating edges for builtins)
        if (targetFileId === '<builtin>') {
            return null;
        }

        // Don't normalize module names (they don't have paths). Loop 16:
        // route through the contract's external classifier.
        const isExternal = isExternalModuleId(targetFileId);

        if (!isExternal) {
            targetFileId = normalizePath(targetFileId);
        }

        const targetNodeId = makeEntityId(targetFileId, call.resolvedDefinition.name);
        return {
            source: callerNodeId,
            target: targetNodeId,
            kind: 'call'
        };
    }

    // Try to resolve based on imports
    const calleeName = call.calleeName.split('.')[0]; // Base name (e.g., "Parser" from "Parser.parse")

    for (const imp of imports) {
        const targetFileId = resolveImportTarget(fileId, imp);
        if (!targetFileId) continue;

        // Check if this import brings in the callee
        for (const spec of imp.specifiers) {
            const localName = spec.alias || spec.name;
            if (localName === calleeName) {
                // Found it - the call is to something from this import
                const targetNodeId = makeEntityId(targetFileId, spec.name);
                return {
                    source: callerNodeId,
                    target: targetNodeId,
                    kind: 'call'
                };
            }
        }
    }

    // Local call within same file?
    const targetNodeId = makeEntityId(fileId, calleeName);
    return {
        source: callerNodeId,
        target: targetNodeId,
        kind: 'call'
    };
}
