/**
 * Rust Parser Module
 *
 * Tree-sitter based Rust code analysis for import graph extraction.
 * Only import extraction (use statements) is supported.
 * Call graph is NOT available for Rust.
 */

export { RustAdapter } from './adapter';
export { RustExtractor } from './extractor';
