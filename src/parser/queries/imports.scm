; import defaultName from "mod"
(import_statement
  (import_clause
    (identifier) @import.default)
  (string) @import.source) @import.stmt

; import * as NS from "mod"
(import_statement
  (import_clause
    (namespace_import
      (identifier) @import.namespace))
  (string) @import.source) @import.stmt

; import { a, b as c } from "mod"
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @import.imported
        alias: (identifier)? @import.local)?))
  (string) @import.source) @import.stmt

; also handle import_specifier without explicit fields (some versions)
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        (identifier) @import.imported
        (identifier)? @import.local)?))
  (string) @import.source) @import.stmt

; side-effect import: import "mod";
(import_statement
  (string) @import.source) @import.stmt
