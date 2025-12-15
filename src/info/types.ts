/**
 * Types for file info extraction
 */

/**
 * Information about who calls a function/method
 */
export interface CallerInfo {
    /** Name of the calling function */
    name: string;
    /** File path where the caller is located */
    file: string;
}

/**
 * Information about a function or method
 */
export interface FunctionInfo {
    /** Function name */
    name: string;
    /** Full signature (e.g., "functionName(param: Type): ReturnType") */
    signature: string;
    /** Kind of entity (function, method, arrow, etc.) */
    kind: string;
    /** List of callers */
    calledBy: CallerInfo[];
    /** Whether the function is exported */
    isExported: boolean;
}

/**
 * Information about a class
 */
export interface ClassInfo {
    /** Class name */
    name: string;
    /** Class signature (may include extends/implements) */
    signature: string;
    /** Methods within the class */
    methods: FunctionInfo[];
    /** Whether the class is exported */
    isExported: boolean;
}

/**
 * Complete file information
 */
export interface FileInfo {
    /** Relative file path */
    filePath: string;
    /** Top-level functions in the file */
    functions: FunctionInfo[];
    /** Classes in the file */
    classes: ClassInfo[];
}

/**
 * Reverse call index: maps entity ID to list of callers
 */
export type ReverseCallIndex = Map<string, CallerInfo[]>;
