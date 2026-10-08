import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStates, heapInsertionSnapshots, interpolate, snapshotIndex, validateSnapshot } from './state.js';
const values=[8,12,10,20,15,18];
test('insertion records full deterministic snapshots, including comparison-only states',()=>{
 const states=heapInsertionSnapshots(values,5);
 assert.deepEqual(states,heapInsertionSnapshots(values,5));
 assert.equal(states.length,7);
 states.forEach(validateSnapshot);
 assert.deepEqual(states[1]!.arrays,states[2]!.arrays);
 const comparison=compareStates(states[1]!,states[2]!);
 assert.deepEqual(comparison.moves,{});
 assert.deepEqual(comparison.execution?.after?.operands,['inserted','item-2']);
 const final=states.at(-1)!;
 assert.deepEqual(final.arrays.heap!.map(id=>final.entities[id]!.value),[5,12,8,20,15,18,10]);
 assert.equal(final.variables.p,undefined);
 assert.deepEqual(values,[8,12,10,20,15,18]);
});
test('moves use stable identities, references resolve entities, relationships rewire',()=>{
 const states=heapInsertionSnapshots(values,5),diff=compareStates(states[2]!,states[3]!);
 assert.deepEqual(diff.moves.inserted,{before:{array:'heap',index:6},after:{array:'heap',index:2}});
 assert.deepEqual(diff.moves['item-2'],{before:{array:'heap',index:2},after:{array:'heap',index:6}});
 assert.deepEqual(diff.entities,{});
 assert.equal(diff.references.i?.after?.entity,'inserted');
 assert.equal(diff.relations['parent-of-inserted']?.after?.from,'item-0');
 assert.equal(diff.relations['parent-of-item-5']?.after?.from,'inserted');
});
test('arbitrary forward and backward jumps compare actual endpoints, without mutation',()=>{
 const states=heapInsertionSnapshots(values,5),frozen=JSON.stringify(states);
 for(const from of states)for(const to of states){
  const diff=compareStates(from,to),reverse=compareStates(to,from);
  for(const [id,move] of Object.entries(diff.moves))assert.deepEqual(reverse.moves[id],{before:move.after,after:move.before});
 }
 assert.equal(JSON.stringify(states),frozen);
 assert.deepEqual(interpolate([9,8,7],[1,2,3],1),[1,2,3]);
 assert.deepEqual(interpolate([9,8,7],[1,2,3],9),[1,2,3]);
 assert.equal(snapshotIndex(99,7),6);assert.equal(snapshotIndex(-1,7),0);
});
test('equal values remain distinct and comparisons can stop without a swap',()=>{
 const states=heapInsertionSnapshots([5,5,5,5,5,5],5),last=states.at(-1)!;
 assert.equal(states.length,4);assert.equal(new Set(last.arrays.heap).size,7);
 assert.deepEqual(compareStates(states[2]!,last).moves,{});
 assert.equal(heapInsertionSnapshots(values,9).length,6);
 assert.equal(heapInsertionSnapshots(values,25).length,4);
});
test('invalid heaps and dangling semantic references are rejected',()=>{
 assert.throws(()=>heapInsertionSnapshots([8,2],5),/not a min-heap/);
 assert.throws(()=>heapInsertionSnapshots([NaN],5),/finite/);
 const s=heapInsertionSnapshots(values,5)[1]!;
 s.variables.i!.reference={array:'other'};
 assert.throws(()=>validateSnapshot(s),/Invalid reference/);
});
test('a stationary index detects replacement of its referent after a swap',()=>{
 const states=heapInsertionSnapshots(values,5),a=structuredClone(states[2]!),b=structuredClone(states[3]!);
 b.variables.i=structuredClone(a.variables.i!);
 const diff=compareStates(a,b);
 assert.equal(diff.variables.i,undefined);
 assert.equal(diff.references.i?.before?.entity,'inserted');
 assert.equal(diff.references.i?.after?.entity,'item-2');
});
