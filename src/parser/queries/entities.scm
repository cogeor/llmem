; Top-level named function + class
(function_declaration
  name: (identifier) @entity.name) @entity.function

(class_declaration
  name: (type_identifier) @entity.name) @entity.class

; Variable-assigned callables
(lexical_declaration
  (variable_declarator
    name: (identifier) @entity.name
    value: (arrow_function) @entity.arrow)) @entity.var_arrow

(lexical_declaration
  (variable_declarator
    name: (identifier) @entity.name
    value: (function_expression) @entity.func_expr)) @entity.var_func

; Class members
(method_definition
  name: (property_identifier) @entity.member_name
  (#not-eq? @entity.member_name "constructor")) @entity.method

; constructor
(method_definition
  name: (property_identifier) @entity.ctor_name
  (#eq? @entity.ctor_name "constructor")) @entity.ctor

; getters/setters
(method_definition
  "get" @entity.get_kw
  name: (property_identifier) @entity.member_name) @entity.getter

(method_definition
  "set" @entity.set_kw
  name: (property_identifier) @entity.member_name) @entity.setter
