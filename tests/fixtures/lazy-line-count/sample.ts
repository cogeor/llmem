// sample.ts
// Fixture for tests/unit/graph/lazy-line-count.test.ts
//
// True line count: 29 (pinned in lazy-line-count.test.ts).
// sf.getEnd() returned a CHARACTER offset, ~1200 — three orders of
// magnitude wrong.

export interface SampleA { id: string; }
export interface SampleB { id: string; }
export interface SampleC { id: string; }

export function fnA(x: SampleA): string {
    return x.id;
}

export function fnB(x: SampleB): string {
    return x.id;
}

export function fnC(x: SampleC): string {
    return x.id;
}

export class K {
    a(): void { /* a */ }
    b(): void { /* b */ }
    c(): void { /* c */ }
}
