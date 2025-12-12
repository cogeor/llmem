; Call expressions
(call_expression
  function: (_) @call.callee) @call.expr

; New expressions
(new_expression
  constructor: (_) @call.callee) @call.new
