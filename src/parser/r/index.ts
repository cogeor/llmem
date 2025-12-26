/**
 * R Parser Module
 *
 * Tree-sitter based R code analysis for import graph extraction.
 * Only import extraction (library/require/source) is supported.
 * Call graph is NOT available for R.
 */

export { RAdapter } from './adapter';
export { RExtractor } from './extractor';
