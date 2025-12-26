/**
 * C/C++ Parser Module
 *
 * Tree-sitter based C/C++ code analysis for import graph extraction.
 * Only import extraction (#include) is supported.
 * Call graph is NOT available for C/C++.
 */

export { CppAdapter } from './adapter';
export { CppExtractor } from './extractor';
