/** Display-only code data. No evaluation of source text. */
import type { CodeFile } from '/types/lesson.js';
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
