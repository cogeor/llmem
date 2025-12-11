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
    source: string;
    specifiers: string[];
}

export interface FileOutline {
    path: string;
    language: string;
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports?: ImportInfo[];
}

export interface CodeOutline {
    files: FileOutline[];
    summary?: string;
}
