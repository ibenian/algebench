import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrayCell,arrayLength,cellColor,dynamicArrayLength,arrayIndexPosition,arrayCellPosition,arrayCellCorners} from './array-data.js';
test('mixed arrays preserve primitive identity rather than coercing values',()=>{
 assert.equal(arrayCell(42).kind,'number');assert.equal(arrayCell('42').kind,'string');
 assert.equal(arrayCell(false).text,'false');assert.equal(arrayCell(null).text,'∅');
 assert.equal(arrayCell('').text,'""');assert.equal(arrayCell('42').value,'42');
});
test('vertical stacks keep array cell dimensions and compact upward spacing',()=>{
 assert.deepEqual(arrayIndexPosition(2,4,[5,-2,0],2,'vertical'),[5,-.43999999999999995,0]);
 assert.equal(arrayIndexPosition(4,4,[5,-2,0],2,'vertical'),null);
 const first=arrayCellPosition(0,[5,-2,0],2,'vertical'),second=arrayCellPosition(1,[5,-2,0],2,'vertical');
 assert.ok(Math.abs(second[1]-first[1]-.78)<1e-10);
 assert.equal(second[0],first[0]);
 const corners=arrayCellCorners(first,2);
 assert.ok(Math.abs(Math.max(...corners.map(c=>c[1]!))-Math.min(...corners.map(c=>c[1]!))-.68)<1e-10);
});
test('character arrays accept Unicode code points and display whitespace explicitly',()=>{
 assert.equal(arrayCell('🙂','character').text,'🙂');assert.equal(arrayCell(' ','character').text,'␠');
 assert.throws(()=>arrayCell('ab','character'));assert.throws(()=>arrayCell('','character'));
});
test('declared types reject mismatches and unsupported nested/object values',()=>{
 assert.throws(()=>arrayCell('42','number'));assert.throws(()=>arrayCell(0,'boolean'));
 for(const value of [undefined,NaN,Infinity,{},[]])assert.throws(()=>arrayCell(value));
 assert.equal(arrayCell('<script>','string').text,'"<script>"');
});
test('array size is one-dimensional, bounded, and consistent with literal values',()=>{
 assert.equal(arrayLength(undefined,[1,2]),2);assert.equal(arrayLength([4],undefined),4);
 assert.throws(()=>arrayLength([4],[1]));assert.throws(()=>arrayLength([2,2],[1,2,3,4]));
 assert.throws(()=>arrayLength([257],undefined));assert.throws(()=>arrayLength(undefined,[]));
});

test('owned marker layout follows array origin and pitch and hides out-of-range indices', () => {
    assert.deepEqual(arrayIndexPosition(2,4,[-3,1,0],2),[1,1,0]);
    assert.deepEqual(arrayIndexPosition(2,4,[10,-2,3],.5),[11,-2,3]);
    for (const index of [-1,4,1.5,NaN,Infinity]) assert.equal(arrayIndexPosition(index,4,[0,0,0],2),null);
});

test('dynamic lengths support empty arrays and reject invalid resizing requests',()=>{
    for(const length of [0,1,6,256,312,1024])assert.equal(dynamicArrayLength(length),length);
    for(const length of [-1,1025,1.5,NaN,Infinity,'3',null,true])assert.throws(()=>dynamicArrayLength(length));
    assert.equal(arrayIndexPosition(0,0,[0,0,0],2),null);
    assert.equal(arrayIndexPosition(2,2,[0,0,0],2),null);
    assert.deepEqual(arrayIndexPosition(2,3,[0,0,0],2),[4,0,0]);
});

test('wrapped arrays preserve every index and fit rows into the requested height',async()=>{
 const {wrappedArrayCell}=await import('./array-data.js');
 const cells=Array.from({length:24},(_,i)=>wrappedArrayCell(i,24,[-2.14,-.3,.25],.61,8,.66));
 assert.equal(new Set(cells.map(c=>JSON.stringify(c.position))).size,24);
 assert.deepEqual(cells[8]!.position,[-2.14,-.52,.25]);
 assert.ok(cells.every(c=>c.height>0&&c.height<.22));
 const dense=wrappedArrayCell(255,256,[0,0,0],.6,8,.66);
 assert.ok(dense.position[1]>-.66);
 assert.ok(dense.height<cells[0]!.height);
});

test('array direction normalizes vectors and spaces cells without resizing geometry',()=>{
 assert.deepEqual(arrayCellPosition(2,[1,2,3],.8,'horizontal',[0,0,4],.28),[1,2,3.56]);
 assert.deepEqual(arrayIndexPosition(2,4,[1,2,3],.8,'horizontal',[1,0,0],.5),[2,2,3]);
 assert.deepEqual(arrayCellPosition(2,[0,0,0],1,'horizontal',[0,1,0],.5),[0,1,0]);
 const diagonal=arrayCellPosition(1,[0,0,0],1,'horizontal',[1,1,0],2);
 assert.ok(Math.abs(Math.hypot(...diagonal)-2)<1e-10);
 for(const direction of [[0,0,0],[1,2],[NaN,0,1],[Infinity,1,1]])assert.throws(()=>arrayCellPosition(0,[0,0,0],1,'horizontal',direction));
 assert.throws(()=>arrayCellPosition(1,[0,0,0],1,'horizontal',[0,0,1],0));
 assert.equal(arrayIndexPosition(4,4,[0,0,0],1,'horizontal',[0,0,1]),null);
});

test('cellColor accepts only six-digit hex colors', () => {
    assert.equal(cellColor('#4fae7b'), '#4fae7b');
    for (const v of ['', 'red', '#fff', 0, null, undefined, '#12345g']) assert.equal(cellColor(v), null);
});
