export interface Loc {
    startByte: number;
    endByte: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
}

export type ImportSpec = {
    kind: 'es';
    source: string;
    resolvedPath: string | null;
    specifiers: Array<{ name: string; alias?: string }>;
    loc: Loc;
}

export type ExportSpec = {
    type: 'named' | 'default' | 'reexport' | 'all';
    name: string;
    localName?: string;
    source?: string;
    loc: Loc;
}

export type EntityKind = 'class' | 'function' | 'method' | 'arrow' | 'const' | 'getter' | 'setter' | 'ctor';

export interface CallSite {
    callSiteId: string;
    kind: 'function' | 'method' | 'new';
    calleeName: string;
    loc: Loc;
}

export interface Entity {
    id: string;
    kind: EntityKind;
    name: string;
    isExported: boolean;
    loc: Loc;
    signature?: string;
    calls?: CallSite[];
}

export interface FileArtifact {
    schemaVersion: string;
    file: {
        id: string;
        path: string;
        language: string;
    };
    imports: ImportSpec[];
    exports: ExportSpec[];
    entities: Entity[];
}

export interface CodeOutline {
    // Legacy support or new aggregate structure
    files: FileArtifact[];
    summary?: string;
}
