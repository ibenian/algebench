/** Display-only code data. No evaluation of source text. */
import type { CodeFile, CodeRef } from '/types/lesson.js';
export type { CodeFile } from '/types/lesson.js';
export interface FileTree { folders: Map<string, FileTree>; files: CodeFile[] }
export function fileTree(files: CodeFile[]): FileTree {
    const root: FileTree = {folders:new Map(),files:[]};
    for (const file of files) {
        const parts=file.path.split('/').filter(Boolean);let node=root;
        for(const part of parts.slice(0,-1)) {
            if(!node.folders.has(part))node.folders.set(part,{folders:new Map(),files:[]});
            node=node.folders.get(part)!; // inserted above
        }
        node.files.push(file);
    }
    return root;
}
export function relatedLocations(file: CodeFile, first: number, last: number) {
    const seen=new Set<string>();
    return (file.locations??[]).filter(location=>{
        const key=JSON.stringify([location.scene,location.step,location.snapshot]);
        if(location.line<first||location.line>last||seen.has(key))return false;
        seen.add(key);return true;
    });
}
/** Split at authored range boundaries; columns are one-based, end-exclusive. */
export function markedSegments(text: string, marks: NonNullable<CodeFile['marks']>) {
    const boundaries=new Set([0,text.length]);
    for(const m of marks) {boundaries.add(Math.max(0,Math.min(text.length,m.startColumn-1)));boundaries.add(Math.max(0,Math.min(text.length,m.endColumn-1)));}
    const offsets=[...boundaries].sort((a,b)=>a-b);
    return offsets.slice(0,-1).map((start,i)=>({text:text.slice(start,offsets[i+1]),color:marks.find(m=>start>=m.startColumn-1&&start<m.endColumn-1)?.color}));
}

/** Accept scalar PCs and simultaneous transitions (math.js arrays are matrices). */
export function activeCodeLines(value: unknown): Set<number> {
    const matrix=value as {toArray?:()=>unknown}|null;
    const raw=matrix && typeof matrix.toArray==='function'?matrix.toArray():value;
    const values=Array.isArray(raw)?raw:[raw];
    return new Set(values.filter((line):line is number=>typeof line==='number'&&Number.isInteger(line)&&line>0));
}

/** Reverse the authored code→step map, optionally narrowing it to live lines. */
export function stepCodeLocations(files: CodeFile[], scene: string, step: string, snapshot?: number,
    active?: (file: CodeFile) => Set<number> | undefined) {
    return files.flatMap(file => {
        const seen = new Set<number>();
        const lines = active?.(file);
        const count = file.source.split('\n').length;
        return (file.locations ?? []).filter(location => {
            if (location.scene !== scene || location.step !== step ||
                (location.snapshot !== undefined && location.snapshot !== snapshot) ||
                !Number.isInteger(location.line) || location.line < 1 || location.line > count ||
                (lines && !lines.has(location.line)) || seen.has(location.line)) return false;
            seen.add(location.line);
            return true;
        }).map(location => ({file, location}));
    });
}

/** Resolve authored source locations without accepting missing files or out-of-range lines. */
export function resolveCodeRef(files: CodeFile[], ref?: CodeRef, evaluate?: (expression: string) => unknown) {
    if (!ref) return null;
    try {
        const fileId = ref.fileExpr !== undefined ? evaluate?.(ref.fileExpr) : ref.file;
        const line = ref.lineExpr !== undefined ? evaluate?.(ref.lineExpr) : ref.line;
        if (typeof fileId !== 'string' || typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
        const file = files.find(file => file.id === fileId);
        return file && line <= file.source.split('\n').length ? { file, line } : null;
    } catch { return null; }
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Line actions offered for a selection: inside the range, scoped to the scene, and only when every slider exists. */
export function lineActionsFor(file: CodeFile, first: number, last: number, scene: string | undefined, hasSlider: (id: string) => boolean) {
    const seen = new Set<string>();
    return (file.lineActions ?? []).filter(action => {
        if (action.line < first || action.line > last || (action.scene && action.scene !== scene)) return false;
        // Slider ids come from lesson data; never let a prototype key through to setSliderValue.
        const ids = Object.keys(action.set);
        if (ids.some(id => UNSAFE_KEYS.has(id)) || !ids.every(hasSlider) || seen.has(action.label)) return false;
        seen.add(action.label);
        return true;
    });
}
