# Graph Module Design

## Goal
Generate graph representations (Import Graph and Call Graph) from `.artifact` JSON files produced by the parser.

## Architecture

### File Structure
```text
src/graph/
├── index.ts          # Module entry point (exports buildGraph)
├── types.ts          # Graph data types (strong typing)
├── builder.ts        # Core logic to process artifacts and build graphs
├── resolver.ts       # Logic for resolving imports and function calls
└── utils.ts          # Helper functions (ID generation, normalization)
```

### Data Types (Strong Schema)

#### Base Graph Types
```typescript
export interface Node {
  id: string;      // Unique identifier
  label: string;   // Human-readable label (e.g., filename, function name)
}

export interface Edge {
  source: string;  // Source Node ID
  target: string;  // Target Node ID
}

export interface Graph<N extends Node, E extends Edge> {
  nodes: Map<string, N>;
  edges: E[];
}
```

#### Import Graph Types
```typescript
export interface FileNode extends Node {
  kind: 'file';
  path: string;    // Repo-relative path (e.g., "src/parser/parser.ts")
  language: string;
}

export interface ImportEdge extends Edge {
  kind: 'import';
  specifiers: Array<{ name: string; alias?: string }>; // What is imported
}

export type ImportGraph = Graph<FileNode, ImportEdge>;
```

#### Call Graph Types
```typescript
export interface EntityNode extends Node {
  kind: 'function' | 'method' | 'class' | 'constructor';
  fileId: string;  // Reference to the FileNode ID
  parentEntityId?: string; // For methods inside classes
  signature?: string;
}

export interface CallEdge extends Edge {
  kind: 'call';
  callSiteId: string; // ID from the artifact CallSite
}

export type CallGraph = Graph<EntityNode, CallEdge>;
```

## Module Interface

### `src/graph/index.ts`
```typescript
import { ImportGraph, CallGraph } from './types';

export function buildGraphs(artifactDir: string): Promise<{
    importGraph: ImportGraph;
    callGraph: CallGraph;
}>;
```

---
# Original Detailed Implementation Plan

Design doc: Build graphs from *.artifact JSON files
2: Goal
3: 
4: Given a repository root containing per-file *.artifact JSON (like your example), build two directed graphs:
5: 
6: Import Graph (file-level)
7: 
8: Nodes: files (one node per artifact / source file)
9: 
10: Edges: A -> B if file A imports file B within the codebase (resolvedPath points to an internal file)
11: 
12: Node attributes: external import/export info (“outside sources”), plus in-repo import/export lists.
13: 
14: Call Graph (callable-level)
15: 
16: Nodes: functions/methods/ctors (from entities[])
17: 
18: Edges: callerEntity -> calleeEntity when there’s a resolvable call
19: 
20: Calls that can’t be resolved are preserved as “unresolved edges” metadata.
21: 
22: We keep these as separate graph structures.
23: 
24: Assumptions about artifacts
25: 
26: From your sample:
27: 
28: Artifact contains imports[] with { source, resolvedPath, specifiers[] }
29: 
30: Artifact contains exports[] with { type, name, loc } (no direct entity id reference)
31: 
32: Artifact contains entities[] with { id, kind, name, signature, calls[] }
33: 
34: Calls are normalized to calleeName strings such as:
35: 
36: this.getLanguageForFile
37: 
38: path.extname
39: 
40: console.warn
41: 
42: entity.id is unique at least within a file (you’re using startByte as id string).
43: 
44: loc exists but graph building doesn’t require it.
45: 
46: 1) Data structures
47: 1.1 Import Graph
48: type FileId = string; // canonical repo-relative path, e.g. "src/foo.ts"
49: 
50: type ImportNode = {
51:   id: FileId;
52:   path: string;
53:   // “outside sources” summary
54:   externalImports: { source: string; specifiers: { name: string; alias?: string }[] }[];
55:   externalExports: { name: string; type: string }[]; // optional, depends on exports shape
56:   // internal summary (optional but useful)
57:   internalImports: { source: string; resolvedPath: FileId; specifiers: any[] }[];
58:   exports: { type: string; name: string }[];
59: };
60: 
61: type ImportEdge = {
62:   from: FileId;
63:   to: FileId;
64:   source: string;          // original import source string
65:   specifiers: any[];       // raw specifiers
66: };
67: 
68: type ImportGraph = {
69:   nodes: Map<FileId, ImportNode>;
70:   edges: ImportEdge[];
71: };
72: 
73: 1.2 Call Graph
74: type EntityId = string; // global id = `${fileId}#${entity.id}`
75: 
76: type CallableNode = {
77:   id: EntityId;
78:   fileId: FileId;
79:   kind: string;            // "method", "function", "ctor", ...
80:   name: string;            // "parse", "constructor"
81:   signature: string;
82:   // optional: for UI/debug
83:   loc?: any;
84: };
85: 
86: type CallEdge = {
87:   from: EntityId;
88:   to: EntityId;
89:   callSiteId: string;
90:   calleeName: string;      // original string
91:   resolution: {
92:     status: "resolved" | "ambiguous" | "unresolved";
93:     reason?: string;
94:   };
95: };
96: 
97: type UnresolvedCall = {
98:   from: EntityId;
99:   callSiteId: string;
100:   calleeName: string;
101:   kind: string;
102:   loc?: any;
103: };
104: 
105: type CallGraph = {
106:   nodes: Map<EntityId, CallableNode>;
107:   edges: CallEdge[];
108:   unresolved: UnresolvedCall[];
109: };
110: 
111: 2) Canonical IDs
112: 2.1 FileId derivation
113: 
114: Each artifact belongs to a source file. Choose a deterministic mapping:
115: 
116: Preferred: artifact includes file.path or file.id.
117: 
118: If not present, infer from artifact filename:
119: 
120: src/foo.ts.artifact → src/foo.ts
121: 
122: 2.2 Entity global ID
123: 
124: Your entity id is file-local. Make it global:
125: 
126: globalEntityId = ${fileId}#${entity.id}``
127: 
128: This avoids collisions across files and preserves your “startByte id” approach.
129: 
130: 3) Resolution model for call edges (prototype)
131: 
132: We resolve only what we can reliably resolve from artifacts:
133: 
134: Tier A: Intra-file this.methodName
135: 
136: If calleeName starts with this.:
137: 
138: Extract member name up to ( or end: this.getLanguageForFile → getLanguageForFile
139: 
140: Resolve to an entity in the same file with matching name
141: 
142: If multiple match, mark ambiguous.
143: 
144: Tier B: Direct identifier call foo
145: 
146: If callee is a bare identifier (no dots), resolve:
147: 
148: first within same file entities by name == foo
149: 
150: Tier C: External/namespace calls (path.extname, console.warn)
151: 
152: Treat as external by default (no call edge in internal call graph).
153: 
154: Optionally store them as “unresolved/external call” metadata.
155: 
156: Tier D: Cross-file calls via imports/exports (optional if exports are rich enough)
157: 
158: With current export shape {name}, we can do basic linking:
159: 
160: Build export index:
161: 
162: exportedSymbolIndex[fileId][exportName] -> entityId?
163: 
164: “entityId?” can be found by matching entity.name to export.name within same file
165: 
166: For calleeName like X.foo where X is namespace import alias:
167: 
168: find import specifier name:"*" alias:"X" -> resolvedPath file B
169: 
170: resolve foo in B via export index
171: 
172: For direct calls foo() when foo is a named import:
173: 
174: import specifier might include {name:"foo", alias:"fooLocal"}
175: 
176: match calleeName == alias -> resolvedPath file B + exported name name
177: 
178: resolve via export index
179: 
180: If you don’t want cross-file resolution yet, skip Tier D; graph is still buildable (just less connected).
181: 
182: 4) Algorithm (rough pseudocode)
183: 4.1 Main entry
184: function buildGraphs(rootDir):
185:   artifacts = readAllArtifacts(rootDir)              // returns list of (fileId, artifactJson)
186: 
187:   importGraph = initImportGraph()
188:   callGraph = initCallGraph()
189: 
190:   // Pass 1: create file nodes + collect raw import/export data
191:   for each (fileId, A) in artifacts:
192:     addFileNode(importGraph, fileId, A)
193: 
194:   // Pass 2: add import edges (internal only)
195:   for each (fileId, A) in artifacts:
196:     for each imp in A.imports:
197:       if imp.resolvedPath != null AND isInternal(imp.resolvedPath):
198:         toFile = normalizeFileId(imp.resolvedPath)
199:         addImportEdge(importGraph, fileId, toFile, imp)
200: 
201:   // Pass 3: create callable nodes and indexes for resolution
202:   entityIndexByFileAndName = Map<FileId, Map<string, List<EntityId>>>()
203:   exportIndexByFileAndName = Map<FileId, Map<string, EntityId>>()     // best-effort
204:   importBindingIndex = Map<FileId, ImportBindings>()                  // alias->(resolvedPath, exportedName)
205: 
206:   for each (fileId, A) in artifacts:
207:     // 3a) callables
208:     for each entity in A.entities:
209:       if entity.kind in {"function","method","ctor","arrow","getter","setter"}:
210:         gid = fileId + "#" + entity.id
211:         addCallableNode(callGraph, gid, fileId, entity)
212:         index entityIndexByFileAndName[fileId][entity.name].append(gid)
213: 
214:     // 3b) exports -> local entities (best-effort by name match)
215:     exportIndexByFileAndName[fileId] = buildExportIndex(A.exports, A.entities, fileId)
216: 
217:     // 3c) imports -> local binding map
218:     importBindingIndex[fileId] = buildImportBindings(A.imports)
219: 
220:   // Pass 4: resolve calls into call edges
221:   for each (fileId, A) in artifacts:
222:     for each callerEntity in A.entities where callerEntity has calls:
223:       callerGid = fileId + "#" + callerEntity.id
224: 
225:       for each call in callerEntity.calls:
226:         res = resolveCall(fileId, call.calleeName,
227:                           entityIndexByFileAndName,
228:                           importBindingIndex,
229:                           exportIndexByFileAndName)
230: 
231:         if res.status == "resolved":
232:           addCallEdge(callGraph, callerGid, res.targetEntityId, call)
233:         else:
234:           addUnresolved(callGraph, callerGid, call, res)
235: 
236:   return { importGraph, callGraph }
237: 
238: 4.2 Helper: read all artifacts
239: function readAllArtifacts(rootDir):
240:   files = glob(rootDir, "**/*.artifact")
241:   out = []
242:   for f in files:
243:     A = jsonParse(readFile(f))
244:     fileId = deriveFileId(f, A)     // prefer A.file.path if present
245:     out.append((fileId, A))
246:   return out
247: 
248: 4.3 Helper: build export index (best-effort)
249: function buildExportIndex(exports, entities, fileId):
250:   // map exportName -> entityId
251:   byName = map entity.name -> list of entity
252:   idx = empty map
253: 
254:   for ex in exports:
255:     name = ex.name
256:     candidates = byName[name]
257:     if candidates has exactly 1:
258:       idx[name] = fileId + "#" + candidates[0].id
259:     else if candidates empty:
260:       idx[name] = null   // export exists but no matching entity (re-export, default expr, etc.)
261:     else:
262:       idx[name] = null   // ambiguous
263:   return idx
264: 
265: 4.4 Helper: build import bindings
266: 
267: This normalizes “what local names refer to what module exports”.
268: 
269: function buildImportBindings(imports):
270:   bindings = {
271:     named: Map<localName, (targetFileId?, exportedName)>,
272:     namespace: Map<alias, targetFileId?>,
273:     default: Map<localName, targetFileId?>
274:   }
275: 
276:   for imp in imports:
277:     target = normalizeFileId(imp.resolvedPath) if imp.resolvedPath else null
278: 
279:     for spec in imp.specifiers:
280:       if spec.name == "*": bindings.namespace[spec.alias] = target
281:       else if spec.name == "default": bindings.default[spec.alias] = target
282:       else:
283:         // named import: { name as alias }
284:         bindings.named[spec.alias ?? spec.name] = (target, spec.name)
285: 
286:   return bindings
287: 
288: 
289: (Your current specifiers format uses {name, alias} where name:"*" indicates namespace import; if you don’t emit default, decide a convention like name:"default".)
290: 
291: 4.5 Helper: resolve call
292: function resolveCall(fileId, calleeName, entityIndex, importBindings, exportIndex):
293:   // normalize calleeName: strip trailing "(...)" if present
294:   base = stripInvocationSuffix(calleeName)     // "path.extname(file).toLowerCase" stays same
295:   parts = splitOnDot(base)                     // e.g. ["this","getLanguageForFile"]
296: 
297:   // Tier A: this.method
298:   if parts[0] == "this" and parts.length >= 2:
299:     member = parts[1]
300:     candidates = entityIndex[fileId][member]
301:     return resolveCandidates(candidates, reason="this-member")
302: 
303:   // Tier B: bare identifier
304:   if parts.length == 1:
305:     candidates = entityIndex[fileId][parts[0]]
306:     if resolved -> return
307:     // Tier D: named import call (callee is local alias)
308:     if importBindings[fileId].named has parts[0]:
309:       (targetFile, exportedName) = importBindings[fileId].named[parts[0]]
310:       if targetFile != null and exportIndex[targetFile][exportedName] exists:
311:         targetEntity = exportIndex[targetFile][exportedName]
312:         if targetEntity != null: return resolved(targetEntity)
313:     return unresolved("not local, not imported")
314: 
315:   // Tier D: namespace import call: NS.foo(...)
316:   if parts.length >= 2:
317:     ns = parts[0]
318:     member = parts[1]
319:     if importBindings[fileId].namespace has ns:
320:       targetFile = importBindings[fileId].namespace[ns]
321:       if targetFile != null and exportIndex[targetFile][member] != null:
322:         return resolved(exportIndex[targetFile][member])
323:       return unresolved("namespace target not found")
324: 
325:   // external/unknown
326:   return unresolved("external-or-unknown")
327: 
328: 5) Code module design
329: 5.1 Module boundaries
330: artifact-reader
331: 
332: Responsibility: find and parse .artifact files and derive fileId
333: 
334: API:
335: 
336: readArtifacts(rootDir): ArtifactBundle[]
337: 
338: import-graph-builder
339: 
340: Responsibility: build file nodes + internal import edges
341: 
342: API:
343: 
344: buildImportGraph(artifacts): ImportGraph
345: 
346: call-graph-builder
347: 
348: Responsibility:
349: 
350: build callable nodes
351: 
352: build indexes (entity name index, export index, import bindings)
353: 
354: resolve calls into edges + unresolved list
355: 
356: API:
357: 
358: buildCallGraph(artifacts): CallGraph
359: 
360: graph-builder (facade)
361: 
362: Responsibility: orchestrate and return both graphs
363: 
364: API:
365: 
366: buildGraphs(rootDir): { importGraph, callGraph }
367: 
368: 5.2 Suggested folder structure
369: graph/
370:   index.ts
371:   artifact/
372:     reader.ts
373:     types.ts
374:     normalize.ts
375:   importGraph/
376:     types.ts
377:     builder.ts
378:   callGraph/
379:     types.ts
380:     builder.ts
381:     resolution.ts
382:     indexes.ts
383: 
384: 6) Design notes specific to your artifact sample
385: 6.1 “Duplicate” import entries
386: 
387: In your sample, there are two identical imports objects. If that’s not intentional, the builder should dedupe by a key like:
388: (source, resolvedPath, loc.startByte, loc.endByte, specifiers-json)
389: 
390: 6.2 Callsite ID collisions
391: 
392: You have two calls with callSiteId: call@875. That’s a real issue for edge identity and debugging.
393: Fix in the graph builder (without changing artifacts) by generating a derived ID:
394: 
395: derivedCallSiteKey = ${fileId}#${callerEntityId}#${call.callSiteId}#${i}``
396: where i is the index within calls[] for that caller.
397: 
398: 6.3 Class entity vs method entities
399: 
400: You’re currently storing class as an entity but it has empty calls. That’s fine.
401: In the call graph, treat only callable kinds as nodes; keep class nodes out of call graph unless you want new edges to point to class nodes. If you do, add a third edge kind (INSTANTIATES) or keep it as unresolved/external-like.
402: 
403: Given your request (“graph structure of the functions with function calls”), simplest is:
404: 
405: new Parser() edges are either:
406: 
407: unresolved/external (if Parser not in repo), or
408: 
409: resolved to a class/callable in repo if Parser is exported/imported and indexed.
410: 
411: 7) Output shape (what the module returns)
412: type BuildGraphsResult = {
413:   importGraph: ImportGraph;
414:   callGraph: CallGraph;
415: };
416: 
417: 
418: This is enough to:
419: 
420: render two different views
421: 
422: compute in-edges on demand
423: 
424: run centrality / SCC / pruning separately per graph
425: 
426: Addendum: Internal-Only Graph Construction Rules
427: 
428: This addendum defines how the import graph and call graph must be constructed so that they represent only the code inside the repository, even though the AST-derived artifacts may include calls to external libraries, built-ins, or runtime APIs.
429: 
430: The rules below apply only at graph construction time. The parser is allowed to emit all calls it observes; the graph builder is responsible for filtering and resolution.
431: 
432: 1. Definition of “internal”
433: 
434: A symbol (file, function, class, method) is considered internal if and only if:
435: 
436: There exists a corresponding *.artifact file loaded from the repository root, and
437: 
438: The symbol is defined by an entity inside one of those artifacts.
439: 
440: Everything else (Node built-ins, browser APIs, third-party libraries, runtime globals) is external, even if it appears in the AST or artifacts.
441: 
442: This definition is authoritative and replaces any hardcoded allow/deny lists.
443: 
444: 2. Import graph rules
445: 2.1 Nodes
446: 
447: Each artifact file corresponds to one node in the import graph.
448: 
449: Node identity is the canonical repository-relative file path.
450: 
451: 2.2 Edges
452: 
453: Create a directed edge A → B only if:
454: 
455: File A contains an import whose resolvedPath points to a file, and
456: 
457: That resolved file exists among the loaded artifacts.
458: 
459: 2.3 External imports
460: 
461: Imports whose resolvedPath is null or points outside the artifact set:
462: 
463: Do not create graph edges.
464: 
465: Must be recorded as node attributes (e.g., externalImports) for observability.
466: 
467: The resulting import graph is therefore a strict representation of in-repository dependencies only.
468: 
469: 3. Call graph rules
470: 
471: The call graph represents calls between internal functions only. External calls must not appear as edges.
472: 
473: Graph construction proceeds in two distinct stages: filtering, then resolution.
474: 
475: 3.1 Callsite filtering (pre-resolution)
476: 
477: Before attempting to resolve a callsite to a function entity, discard callsites that can be determined to be external by inspection alone.
478: 
479: A callsite must be ignored (not resolved, not added as an edge) if any of the following are true:
480: 
481: 3.1.1 External import roots
482: 
483: The call’s root identifier refers to an import whose resolvedPath is external or missing.
484: 
485: Example: path.extname, fs.readFile, react.useState
486: 
487: 3.1.2 Built-in or runtime globals
488: 
489: The call’s root identifier is a known runtime global or language builtin
490: 
491: Examples: console, Math, JSON, Object, Array, Map, Set, Promise, Date, process
492: 
493: These calls are considered out of scope for the internal call graph.
494: 
495: Filtered callsites may optionally be counted or logged for diagnostics, but they do not participate in graph construction.
496: 
497: 3.2 Call resolution (internal-only)
498: 
499: After filtering, remaining callsites are resolved using internal symbols only.
500: 
501: A callsite may produce a call-graph edge only if it resolves to a function entity defined inside the repository.
502: 
503: Resolution rules:
504: 
505: 3.2.1 Same-file resolution
506: 
507: Calls to this.methodName resolve to a method defined in the same file.
508: 
509: Calls to functionName() resolve to a function defined in the same file.
510: 
511: 3.2.2 Imported symbol resolution
512: 
513: Calls may resolve across files only if:
514: 
515: The symbol is imported from a file with a corresponding artifact, and
516: 
517: The target symbol is exported by that file and defined as an entity.
518: 
519: 3.2.3 Failure cases
520: 
521: If a callsite does not resolve to exactly one internal entity:
522: 
523: No edge is created
524: 
525: The callsite is recorded as unresolved (with reason), or discarded if desired
526: 
527: At no point may a call resolve to an external symbol.
528: 
529: 4. Call graph contents
530: 4.1 Nodes
531: 
532: Nodes represent internal callable entities only:
533: 
534: functions
535: 
536: methods
537: 
538: constructors
539: 
540: getters/setters (if modeled)
541: 
542: Class entities may exist in artifacts but do not participate as call-graph nodes unless explicitly desired.
543: 
544: 4.2 Edges
545: 
546: A directed edge A → B means:
547: 
548: Callable A contains at least one callsite that resolves to callable B.
549: 
550: 4.3 Exclusions
551: 
552: The call graph must not contain:
553: 
554: Calls to external libraries
555: 
556: Calls to runtime globals
557: 
558: Calls that could not be resolved to an internal entity
559: 
560: 5. Entrypoint annotation
561: 
562: The graph builder must annotate exactly one internal callable as an entrypoint.
563: 
564: This annotation is informational only and does not affect graph structure.
565: 
566: 5.1 Selection heuristic
567: 
568: Select the entrypoint using the following priority:
569: 
570: An exported callable whose name suggests execution entry
571: 
572: e.g., main, start, run, init, handler
573: 
574: Otherwise, the first exported callable by deterministic order
575: 
576: Otherwise, the callable with the highest number of internal outgoing calls
577: 
578: 5.2 Storage
579: 
580: The entrypoint is stored as a boolean attribute on the callable node:
581: 
582: isEntrypoint: true
583: 
584: 6. Design outcome
585: 
586: By applying these rules:
587: 
588: The import graph shows only real in-repo dependencies.
589: 
590: The call graph reflects only relationships between internal functions.
591: 
592: External code is observable but does not pollute the graph.
593: 
594: The graph is stable, deterministic, and representative of the codebase’s structure—not its runtime environment.
