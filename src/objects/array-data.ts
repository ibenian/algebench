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

/** Owned markers cannot point outside their array; the renderer hides null anchors. */
export function arrayIndexPosition(index:number, length:number, origin:number[], pitch:number):[number,number,number]|null {
    if (!Number.isInteger(index) || index < 0 || index >= length) return null;
    return [origin[0]! + index * pitch, origin[1]!, origin[2]!];
}

/** Same dimensions as the rendered boxes; all corners support rotated cameras. */
export function arrayCellCorners(centre:number[], pitch:number):number[][] {
    return [-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z =>
        [centre[0]! + x*pitch*.39, centre[1]! + y*.34, centre[2]! + z*.11])));
}
