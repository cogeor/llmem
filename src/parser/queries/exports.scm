; Direct exports
(export_statement
  (function_declaration
    name: (identifier) @export.name)) @export.stmt

(export_statement
  (class_declaration
    name: (type_identifier) @export.name)) @export.stmt

(export_statement
  (lexical_declaration
    (variable_declarator
      name: (identifier) @export.name
      value: (arrow_function) @export.arrow))) @export.stmt

(export_statement
  (lexical_declaration
    (variable_declarator
      name: (identifier) @export.name
      value: (function_expression) @export.func_expr))) @export.stmt

; Named exports { ... }
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @export.local
      alias: (identifier)? @export.exported)?)) @export.stmt

; Re-exports
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @reexport.imported
      alias: (identifier)? @reexport.exported)?)
  source: (string) @reexport.source) @reexport.stmt

(export_statement
  "*" @export.star
  source: (string) @reexport.source) @reexport.stmt

; Default exports
(export_statement
    "default"
    (function_declaration
      name: (identifier)? @export.default_name)) @export.default

(export_statement
    "default"
    (class_declaration
      name: (type_identifier)? @export.default_name)) @export.default

; export default expr; - catch all for expression
; (export_statement
;     "default"
;     (_) @export.default_expr) @export.default
