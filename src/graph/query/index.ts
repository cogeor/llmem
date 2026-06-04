/**
 * Graph query helpers — pure projections over edge-list entries.
 *
 * Loop 10 (quality-refactor): this is the new home for the edge-edge query
 * helpers that previously lived in `src/info/filter.ts`. They depend only on
 * `graph/edgelist` types and `core/ids`, so they belong in the graph layer.
 */

export * from './filter';
