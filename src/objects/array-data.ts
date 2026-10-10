/** Logical cells, separate from layout. Never coerce strings or booleans to numbers. */
import type { Element } from '/types/lesson.js';
export type ArrayItemType = NonNullable<Element['itemType']>;
export type ArrayValue = number | string | boolean | null;
export function arrayCell(value: unknown, type: ArrayItemType = 'mixed'): {value:ArrayValue; kind:Exclude<ArrayItemType,'mixed'>; text:string} {
    const kind=type==='mixed' ? value===null?'empty':typeof value==='string'?'string':typeof value==='boolean'?'boolean':'number' : type;
    if(kind==='empty'&&value===null)return {value,kind,text:'∅'};
    if(kind==='number'&&typeof value==='number'&&Number.isFinite(value))return {value,kind,text:String(value)};
    if(kind==='boolean'&&typeof value==='boolean')return {value,kind,text:String(value)};
    if(kind==='string'&&typeof value==='string')return {value,kind,text:JSON.stringify(value)};
    if(kind==='character'&&typeof value==='string'&&[...value].length===1)return {value,kind,text:({' ':'␠','\n':'↵','\t':'⇥'} as Record<string,string>)[value]??value};
    throw new Error(`Array cell does not match ${kind}`);
}
export function arrayLength(shape: number[]|undefined,values:unknown[]|undefined):number {
    const n=shape?.[0]??values?.length??0;
    if((shape&&shape.length!==1)||!Number.isInteger(n)||n<1||n>256)throw new Error('An array needs 1–256 cells and a one-dimensional shape.');
    if(values&&values.length!==n)throw new Error('Array shape and values have different lengths.');
    return n;
}

/** Dynamic arrays may be empty; reject invalid lengths instead of rounding them. */
export function dynamicArrayLength(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1024)
        throw new Error('Array length must be an integer from 0 to 1024.');
    return value;
}

/** Owned markers cannot point outside their array; the renderer hides null anchors. */
export function arrayCellPosition(index:number,origin:number[],pitch:number,layout:Element['arrayLayout']='horizontal',direction?:number[],spacing=pitch):[number,number,number] {
    if(direction){
        const norm=Math.hypot(...direction);
        if(direction.length!==3||direction.some(v=>!Number.isFinite(v))||!Number.isFinite(norm)||norm===0)throw new Error('Array direction must be a finite nonzero 3D vector.');
        if(!Number.isFinite(spacing)||spacing<=0)throw new Error('Array spacing must be positive.');
        return origin.map((v,axis)=>v+index*spacing*direction[axis]!/norm) as [number,number,number];
    }
    return layout==='vertical' ? [origin[0]!,origin[1]!+index*.78,origin[2]!] : [origin[0]!+index*pitch,origin[1]!,origin[2]!];
}
export function arrayIndexPosition(index:number, length:number, origin:number[], pitch:number,layout:Element['arrayLayout']='horizontal',direction?:number[],spacing=pitch):[number,number,number]|null {
    if (!Number.isInteger(index) || index < 0 || index >= length) return null;
    return arrayCellPosition(index,origin,pitch,layout,direction,spacing);
}

/** Same dimensions as the rendered boxes; all corners support rotated cameras. */
export function arrayCellCorners(centre:number[], pitch:number):number[][] {
    return [-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z =>
        [centre[0]! + x*pitch*.39, centre[1]! + y*.34, centre[2]! + z*.11])));
}

/** A wrapped array remains one-dimensional; fitting preserves all record positions. */
export function wrappedArrayCell(index:number,length:number,origin:number[],pitch:number,columns:number,height?:number) {
    const rows=Math.max(1,Math.ceil(length/columns));
    const rowPitch=height===undefined?.78:height/rows;
    return {position:[origin[0]!+(index%columns)*pitch,origin[1]!-Math.floor(index/columns)*rowPitch,origin[2]!] as [number,number,number],height:rowPitch*(.68/.78)};
}
