import test from 'node:test';
import assert from 'node:assert/strict';
import {readDataTable,createBoundTableReader} from './data-table.js';
test('whole-table reads return the original structured rows including empty tables',()=>{
 const rows=[{tick:1,count:2}],data={submissions:rows,empty:[]};
 assert.equal(readDataTable(data,'submissions'),rows);
 assert.deepEqual(readDataTable(data,'empty'),[]);
 assert.equal(readDataTable(data,'absent'),0);
 assert.equal(readDataTable({reference:{id:1}},'reference'),0);
});
test('cell reads retain clamping, rounding, false/zero values and missing-cell behavior',()=>{
 const data={rows:[{count:0,enabled:false},{count:2,enabled:true}]};
 assert.equal(readDataTable(data,'rows',-10,'count'),0);
 assert.equal(readDataTable(data,'rows',100,'count'),2);
 assert.equal(readDataTable(data,'rows',.6,'count'),2);
 assert.equal(readDataTable(data,'rows',0,'enabled'),false);
 assert.equal(readDataTable(data,'rows',0,'missing'),0);
 assert.equal(readDataTable(null,'rows',0,'count'),0);
});

test('a column read returns that column, one value per row, so a list can be taken from the table itself',()=>{
 const data={stock:[{key:'apple',count:3},{key:'kiwi',count:1},{count:2}]};
 assert.deepEqual(readDataTable(data,'stock','key'),['apple','kiwi',0],'a missing cell reads 0, as a cell read does');
 assert.deepEqual(readDataTable(data,'stock','count'),[3,1,2]);
 assert.equal(readDataTable(data,'absent','key'),0);
});

test('bound tables materialize current rows while ordinary input tables stay unchanged',()=>{
 const read=createBoundTableReader(),data:Record<string,unknown>={input:[{count:2}],trace:[{value:0}]};
 const bindings=[{table:'trace',rowsExpr:'buildTrace(input)'}];let count=2;
 const evaluate=()=>[{value:count}];
 assert.equal(read(data,bindings,'trace',0,'value',evaluate),2);
 count=5;assert.equal(read(data,bindings,'trace',0,'value',evaluate),5);
 assert.deepEqual(data.trace,[{value:5}]);assert.deepEqual(data.input,[{count:2}]);
 assert.deepEqual(read(data,bindings,'input',undefined,undefined,()=>{throw Error('should not run')}),[{count:2}]);
});
test('with an epoch, a binding is evaluated once per epoch and reused for every read in it',()=>{
 let epoch=0,calls=0,count=1;const read=createBoundTableReader(()=>epoch),data:Record<string,unknown>={};
 const bindings=[{table:'trace',rowsExpr:'buildTrace()'}],evaluate=()=>{calls++;return [{value:count},{value:count+1}];};
 for(let i=0;i<50;i++)read(data,bindings,'trace',i%2,'value',evaluate);
 assert.equal(calls,1);
 count=7;assert.equal(read(data,bindings,'trace',0,'value',evaluate),1,'same epoch: rows reused');
 epoch++;assert.equal(read(data,bindings,'trace',0,'value',evaluate),7,'new epoch: re-evaluated');
 assert.equal(calls,2);
 // A different binding expression or a different data object never reuses stale rows.
 assert.equal(read(data,[{table:'trace',rowsExpr:'other()'}],'trace',0,'value',()=>[{value:42}]),42);
 assert.equal(read({},bindings,'trace',0,'value',()=>[{value:9}]),9);
});
test('bound tables reject cycles and malformed results, then recover on the next read',()=>{
 const read=createBoundTableReader(),data={},bindings=[{table:'trace',rowsExpr:'trace'}];
 assert.throws(()=>read(data,bindings,'trace',0,'value',()=>read(data,bindings,'trace',0,'value',()=>[])),/Circular/);
 for(const bad of [null,0,{},[null],[1]])assert.throws(()=>read(data,bindings,'trace',0,'value',()=>bad),/row objects/);
 assert.equal(read(data,bindings,'trace',0,'value',()=>({toArray:()=>[{value:3}]})),3);
});
