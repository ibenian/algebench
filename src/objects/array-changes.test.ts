import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArrayChangeTracker} from './array-changes.js';
const k=(values:unknown[])=>values.map(v=>JSON.stringify([typeof v,v]));
test('initial display never illuminates every cell, and duplicate rebuilds do nothing',()=>{
 const tracker=new ArrayChangeTracker();
 assert.deepEqual(tracker.update(k([10,20]),'0'),{changed:[],added:[],removed:[]});
 assert.equal(tracker.update(k([10,20]),'0'),null);
});
test('compare the actually visible state when moving forward, backward or jumping',()=>{
 const tracker=new ArrayChangeTracker();tracker.update(k([10,20]),'0');
 assert.deepEqual(tracker.update(k([10,99]),'4'),{changed:[1],added:[],removed:[]});
 assert.equal(tracker.update(k([10,99]),'4'),null);
 assert.deepEqual(tracker.update(k([10,20]),'0'),{changed:[1],added:[],removed:[]});
 assert.deepEqual(tracker.update(k([30,20]),'8'),{changed:[0],added:[],removed:[]});
});
test('growth leaves unchanged prefix cells quiet; shrink and clear report removed slots',()=>{
 const tracker=new ArrayChangeTracker();tracker.update(k([10,20]),'0');
 assert.deepEqual(tracker.update(k([10,20,30]),'1'),{changed:[],added:[2],removed:[]});
 assert.deepEqual(tracker.update(k([10]),'2'),{changed:[],added:[],removed:[1,2]});
 assert.deepEqual(tracker.update([],'3'),{changed:[],added:[],removed:[0]});
 assert.deepEqual(tracker.update(k([10]),'4'),{changed:[],added:[0],removed:[]});
});
test('a new state with equal values clears the last change effect; rebuilds preserve it',()=>{
 const tracker=new ArrayChangeTracker();tracker.update(k([10]),'0');
 tracker.update(k([20]),'1');
 assert.deepEqual(tracker.update(k([20]),'2'),{changed:[],added:[],removed:[]});
 assert.equal(tracker.update(k([20]),'2'),null);
});
test('shifts and primitive type changes are detected without numeric coercion',()=>{
 const tracker=new ArrayChangeTracker();tracker.update(k([10,20,30]),'0');
 assert.deepEqual(tracker.update(k([20,30]),'1'),{changed:[0,1],added:[],removed:[2]});
 assert.deepEqual(tracker.update(k(['20',30]),'1'),{changed:[0],added:[],removed:[]});
});
