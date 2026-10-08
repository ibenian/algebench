import { test } from 'node:test';
import assert from 'node:assert/strict';
import { all, create } from 'mathjs';
import { readFileSync } from 'node:fs';
import { arrayOperation, arrayValues, arrayResult, arrayCount, arrayAt } from './array-operations.js';
const base = [30,10,20,10];
const cases: [string,unknown,unknown,unknown[],unknown][] = [
 ['get',2,0,base,20], ['length',0,0,base,4], ['set',1,99,[30,99,20,10],99],
 ['insert',1,99,[30,99,10,20,10],5], ['remove',1,0,[30,20,10],10],
 ['push',99,0,[30,10,20,10,99],5], ['pop',0,0,[30,10,20],10],
 ['unshift',99,0,[99,30,10,20,10],5], ['shift',0,0,[10,20,10],30],
 ['swap',0,2,[20,10,30,10],[20,10,30,10]], ['reverse',0,0,[10,20,10,30],[10,20,10,30]],
 ['sort',0,0,[10,10,20,30],[10,10,20,30]], ['indexOf',10,0,base,1],
 ['includes',99,0,base,false], ['slice',1,3,[10,20],[10,20]],
 ['concat',[7,8],0,[30,10,20,10,7,8],[30,10,20,10,7,8]],
 ['fill',7,0,[7,7,7,7],[7,7,7,7]], ['resize',6,0,[30,10,20,10,0,0],6],
 ['clear',0,0,[],0], ['traverse',3,0,base,10],
];
for (const [op,a,b,values,result] of cases) test(`${op} returns the expected array and result without mutating its input`, () => {
 const input = Object.freeze(base.slice());
 const snapshot = arrayOperation(input,op,a,b);
 assert.deepEqual(snapshot.values,values); assert.deepEqual(snapshot.result,result);
 assert.deepEqual(input,base); assert.notEqual(snapshot.values,input);
});
test('insertion, deletion, and shrinking report shifted and removed indices',()=>{
 assert.deepEqual(arrayOperation(base,'insert',1,99).changed,[1,2,3,4]);
 assert.deepEqual(arrayOperation(base,'remove',0).changed,[0,1,2,3]);
 assert.deepEqual(arrayOperation(base,'resize',2).changed,[2,3]);
 assert.deepEqual(arrayOperation(base,'get',1).changed,[]);
});
test('boundary and empty operations remain well-defined',()=>{
 assert.deepEqual(arrayValues([],'insert',0,null),[null]);
 assert.equal(arrayOperation([],'pop').result,null); assert.equal(arrayOperation([],'shift').result,null);
 assert.deepEqual(arrayValues([],'sort'),[]); assert.deepEqual(arrayValues(base,'resize',0),[]);
 assert.deepEqual(arrayValues(base,'slice',4,4),[]);
 assert.equal(arrayOperation(base,'indexOf',99).result,-1);
});
test('mixed primitive types are preserved and searches never coerce them',()=>{
 const mixed=[42,'42',false,null,'🙂'];
 assert.equal(arrayOperation(mixed,'indexOf','42').result,1);
 assert.equal(arrayOperation(mixed,'includes',0).result,false);
 assert.deepEqual(arrayValues(mixed,'set',0,true),[true,'42',false,null,'🙂']);
 assert.equal(arrayResult(mixed,'get',3),'∅'); assert.equal(arrayResult(mixed,'get',1),'"42"');
 assert.deepEqual(arrayValues(['z','a','λ'],'sort'),['a','z','λ']);
 assert.throws(()=>arrayValues(mixed,'sort'));
});
test('invalid indices, values, and growth fail without changing the input',()=>{
 for(const i of [-1,4,1.5,NaN,'1'])assert.throws(()=>arrayOperation(base,'get',i));
 assert.throws(()=>arrayOperation(base,'insert',5,0));
 assert.throws(()=>arrayOperation(base,'swap',0,4));
 assert.throws(()=>arrayOperation(base,'slice',3,2));
 for(const v of [undefined,{},[],NaN,Infinity])assert.throws(()=>arrayValues(base,'push',v));
 assert.throws(()=>arrayValues(Array(256).fill(0),'push',1));
 assert.throws(()=>arrayValues(base,'resize',257));
 assert.throws(()=>arrayValues(base,'concat',Array(253).fill(0)));
 assert.throws(()=>arrayValues(base,'unknown')); assert.deepEqual(base,[30,10,20,10]);
});
test('math.js helpers handle literal matrices and per-cell expressions without JS trust',()=>{
 const math=create(all!); // mathjs exports the full factory map in this build.
 math.import({arrayValues,arrayResult,arrayCount,arrayAt});
 assert.equal(math.evaluate("arrayCount(arrayValues([1,2], 'insert', 1, 9))"),3);
 assert.equal(math.evaluate("arrayAt(arrayValues([1,2], 'insert', 1, 9), 1)"),9);
 assert.equal(math.evaluate("arrayResult([10,20], 'indexOf', 20)"),'1');
 assert.deepEqual(math.evaluate("arrayValues([1,2], 'concat', [3,4])"),[1,2,3,4]);
});
test('every authored operation example evaluates its length, values, highlights and result',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../scenes/draft/test-code-panel.json',import.meta.url),'utf8'));
 const scene=lesson.scenes.find((s:{id:string})=>s.id==='array-operations');
 const math=create(all!); // mathjs exports the full factory map in this build.
 math.import({arrayValues,arrayResult,arrayCount,arrayAt,concat:(...values:unknown[])=>values.join('')},{override:true});
 for(let operation=0;operation<scene.data.operations.length;operation++){
  const scope:Record<string,unknown>={operation,dataTable:(table:string,row:number,column:string)=>scene.data[table][row][column]};
  for(const def of scene.functions)scope[def.name]=()=>math.evaluate(def.expr,scope);
  const after=scene.steps[0].add.find((e:{id:string})=>e.id==='ops-after');
  const row=scene.data.operations[operation];
  const expected=arrayValues(scene.data.base[0].values,row.name,row.a,row.b);
  assert.equal(math.evaluate(after.lengthExpr,scope),expected.length);
  for(let idx=0;idx<expected.length;idx++){
   const cellScope={...scope,idx};
   assert.equal(math.evaluate(after.valueExpr,cellScope),expected[idx]);
   if(after.highlightExpr)assert.equal(typeof math.evaluate(after.highlightExpr,cellScope),'boolean');
  }
  const result=scene.steps[0].add.find((e:{id:string})=>e.id==='ops-result');
  assert.equal(math.evaluate(result.textExpr,scope),'result = '+arrayResult(scene.data.base[0].values,row.name,row.a,row.b));
 }
});
