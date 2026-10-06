import {test} from 'node:test';
import assert from 'node:assert/strict';
import {arrayCell,arrayLength,arrayIndexPosition} from './array-data.js';
test('mixed arrays preserve primitive identity rather than coercing values',()=>{
 assert.equal(arrayCell(42).kind,'number');assert.equal(arrayCell('42').kind,'string');
 assert.equal(arrayCell(false).text,'false');assert.equal(arrayCell(null).text,'∅');
 assert.equal(arrayCell('').text,'""');assert.equal(arrayCell('42').value,'42');
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
