/**
 * Python Parser Module
 *
 * Tree-sitter based Python code analysis for call graph extraction.
 * Designed for speed (10,000+ lines/sec) rather than full semantic resolution.
 */

export { PythonExtractor } from './extractor';
export { PythonImportParser } from './imports';
export { PythonCallResolver } from './resolver';
export { PythonAdapter } from './adapter';
