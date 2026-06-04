/**
 * File-info extraction — application-layer module.
 *
 * Loop 10 (quality-refactor): lifted out of `src/info/` (which is being
 * deleted to break the application <-> info import cycle). These helpers
 * bridge the parser layer (FileArtifact/Entity) and the graph layer
 * (CallGraph, deriveEntityId) to produce the structural `FileInfo` that
 * drives the document-file prompt. They touch the parser layer, so they
 * live in `src/application/` (which may import both parser and graph) —
 * NOT in `src/graph/` (the layer-matrix test bans graph -> parser).
 */

export * from './file-info-types';
export { extractFileInfo } from './file-info-extractor';
export { buildReverseCallIndex, getCallersForEntity, parseEntityLabel } from './reverse-index';
