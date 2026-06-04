/**
 * Concrete edge stores (Loop 14 extraction of `graph/edgelist.ts`).
 *
 * `ImportEdgeListStore` persists file-to-file import relationships to
 * `import-edgelist.json`; `CallEdgeListStore` persists entity-to-entity call
 * relationships to `call-edgelist.json`. Both are thin subclasses of
 * `BaseEdgeListStore` that only pin the filename and edge kind.
 */

import { WorkspaceIO } from '../../workspace/workspace-io';
import { type StructuredLogger } from '../../common/logger';
import { BaseEdgeListStore } from './base-store';

const IMPORT_EDGELIST_FILENAME = 'import-edgelist.json';
const CALL_EDGELIST_FILENAME = 'call-edgelist.json';

/**
 * Stores and manages file-to-file import relationships.
 *
 * Each edge represents one file importing another. Nodes represent source files.
 * Persisted to `import-edgelist.json` in the artifact root.
 *
 * Typical usage:
 * ```typescript
 * const store = new ImportEdgeListStore(artifactRoot, io);
 * await store.load();
 * store.addEdge({ source: 'src/a.ts', target: 'src/b.ts', kind: 'import' });
 * await store.save();
 * ```
 */
export class ImportEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string, io: WorkspaceIO, logger?: StructuredLogger) {
        super(artifactRoot, IMPORT_EDGELIST_FILENAME, 'import', io, logger);
    }
}

/**
 * Stores and manages function/entity call relationships.
 *
 * Each edge represents one code entity (function, method, arrow function) calling
 * another. Nodes represent named entities scoped to their containing file.
 * Persisted to `call-edgelist.json` in the artifact root.
 *
 * Node IDs are constructed by `makeEntityId` in src/core/ids.ts.
 *
 * Typical usage:
 * ```typescript
 * import { makeEntityId } from '../core/ids';
 * const store = new CallEdgeListStore(artifactRoot, io);
 * await store.load();
 * store.addEdge({
 *     source: makeEntityId('src/a.ts', 'foo'),
 *     target: makeEntityId('src/b.ts', 'bar'),
 *     kind: 'call'
 * });
 * await store.save();
 * ```
 */
export class CallEdgeListStore extends BaseEdgeListStore {
    constructor(artifactRoot: string, io: WorkspaceIO, logger?: StructuredLogger) {
        super(artifactRoot, CALL_EDGELIST_FILENAME, 'call', io, logger);
    }
}
