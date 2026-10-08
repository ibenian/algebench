import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stackBounds} from './stack-layout.js';
import {arrayCellCorners,arrayCellPosition} from './array-data.js';
test('stack container remains visible when empty, contains every cell, and grows only upwards',()=>{
 const origin=[7,-2,0],pitch=1.35,empty=stackBounds(0,origin,pitch);
 assert.ok(empty.top>empty.bottom);
 for(const length of [1,2,10,256]){
  const b=stackBounds(length,origin,pitch);
  assert.equal(b.bottom,empty.bottom);assert.equal(b.left,empty.left);assert.equal(b.right,empty.right);
  for(let i=0;i<length;i++)for(const [x,y,z] of arrayCellCorners(arrayCellPosition(i,origin,pitch,'vertical'),pitch)){
   assert.ok(x!>b.left&&x!<b.right);assert.ok(y!>b.bottom&&y!<b.top);assert.ok(z!>b.back&&z!<b.front);
  }
 }
 assert.equal(stackBounds(1,origin,pitch).top,empty.top);
});
