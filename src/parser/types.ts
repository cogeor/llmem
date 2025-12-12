export interface FunctionInfo {
    name: string;
    params: Array<{ name: string; type?: string }>;
    returnType?: string;
    startLine: number;
    endLine: number;
    docstring?: string;
    signature: string;
}

export interface ClassInfo {
    name: string;
    methods: FunctionInfo[];
    properties: Array<{ name: string; type?: string }>;
    startLine: number;
    endLine: number;
    docstring?: string;
}

export interface ImportInfo {
    source: string; // The module path, e.g. "vscode", "./types"
    specifiers: Array<{ name: string; alias?: string }>; // e.g. { name: "Foo", alias: "Bar" }
    startLine: number;
    endLine: number;
}

export interface ExportInfo {
    type: 'default' | 'named';
    name: string; // "default" or the exported name
    localName?: string; // if re-exported or aliased
    startLine: number;
    endLine: number;
}

export interface TypeInfo {
    name: string;
    kind: 'interface' | 'type' | 'enum';
    definition: string; // The signature/definition snippet
    startLine: number;
    endLine: number;
}

export interface FileOutline {
    path: string;
    language: string;
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
    types: TypeInfo[];
}

export interface CodeOutline {
    files: FileOutline[];
    summary?: string;
}
