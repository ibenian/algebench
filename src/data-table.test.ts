import test from 'node:test';
import assert from 'node:assert/strict';
import {readDataTable} from './data-table.js';
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
