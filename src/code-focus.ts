/** The Code tab's current line selection, shared with scene objects that represent source code. */
export interface CodeFocus { fileId: string; first: number; last: number }
export interface ResolvedRef { fileId: string; line: number }

let current: CodeFocus | null = null;

export function codeFocus(): CodeFocus | null { return current; }

export function setCodeFocus(focus: CodeFocus | null): void {
    if (JSON.stringify(focus) === JSON.stringify(current)) return;
    current = focus;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('algebench:codefocus'));
}

/** True when any resolved source location falls inside the selected line range of the same file. */
export function focusMatches(refs: readonly (ResolvedRef | null)[], focus: CodeFocus | null): boolean {
    if (!focus) return false;
    return refs.some(ref => !!ref && ref.fileId === focus.fileId && ref.line >= focus.first && ref.line <= focus.last);
}
