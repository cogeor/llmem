/**
 * Scan use-cases aggregator (loop 07). The four public scan use-cases live in
 * focused per-file modules to stay within the application 350-line budget;
 * this module re-exports them under one import surface for the barrel and any
 * intra-`scan/` consumer.
 *
 *   - `scan-file.ts`      → scanFile
 *   - `scan-folder.ts`    → scanFolder
 *   - `scan-recursive.ts` → scanFolderRecursive, rescanAfterSchemaMismatch
 */

export { scanFile } from './scan-file';
export { scanFolder } from './scan-folder';
export { scanFolderRecursive, rescanAfterSchemaMismatch } from './scan-recursive';
