import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bracketTrace,BRACKET_SOURCE} from './bracket-validation.js';
import {repairTrace,REPAIR_SOURCE} from './bracket-repair.js';
import {create,all} from 'mathjs';
import {arrayAt,arrayCount} from '../array-operations.js';
const verdict=(text:string)=>bracketTrace(text).at(-1)!.status;
test('validate all three bracket types, adjacent pairs, nesting, text, Unicode and empty input',()=>{
 for(const text of ['', '()', '[]', '{}','()[]{}','{[()]}','(((())))','a(b[c]d)','(🙂)'])assert.equal(verdict(text),'Valid',text);
 for(const text of ['(',')','([)]','())','([',']','{[}]','a[b)c','(()'])assert.equal(verdict(text),'Invalid',text);
});
test('stop at the first mismatch or extra closer and preserve its stack for inspection',()=>{
 const mismatch=bracketTrace('([)]later');
 assert.equal(mismatch.at(-1)!.i,2);assert.equal(mismatch.at(-1)!.line,12);
 assert.deepEqual(mismatch.at(-1)!.stack,[0,1]);assert.equal(mismatch.at(-1)!.expected,'(');
 const missing=bracketTrace(']later');assert.equal(missing.at(-1)!.line,9);assert.equal(missing.at(-1)!.i,0);
 assert.deepEqual(missing.at(-1)!.stack,[]);
 const unclosed=bracketTrace('([');assert.equal(unclosed.at(-1)!.line,14);assert.deepEqual(unclosed.at(-1)!.stack,[0,1]);
});
test('each push/pop changes only the top and snapshots do not share mutable stack storage',()=>{
 const text='{[()]}',trace=bracketTrace(text);
 for(let j=1;j<trace.length;j++){
  const row=trace[j]!,prev=trace[j-1]!;
  assert.notEqual(row.stack,prev.stack);assert.equal(row.n,row.stack.length);
  for(const position of row.stack)assert.ok('([{'.includes(text[position]!));
  if(row.line===6)assert.deepEqual(row.stack,[...prev.stack,row.i]);
  else if(row.line===13){
   assert.deepEqual(row.stack,prev.stack.slice(0,-1));assert.equal(row.matchedOpen,prev.stack.at(-1));
   assert.equal(row.matchedClose,row.i);
  }else assert.deepEqual(row.stack,prev.stack);
 }
 trace[0]!.stack.push(99);assert.deepEqual(trace[1]!.stack,[]);
});
test('short bracket strings agree with an independent closer-expectation validator',()=>{
 function reference(s:string){const expected:string[]=[];for(const c of s){
  const n='([{'.indexOf(c);if(n>=0)expected.push(')]}'[n]!);
  else if(')]}'.includes(c)&&expected.pop()!==c)return false;
 }return expected.length===0;}
 let corpus=[''];for(let depth=0;depth<=4;depth++){
  for(const s of corpus)assert.equal(verdict(s)==='Valid',reference(s),s);
  corpus=corpus.flatMap(s=>[...'()[]{}'].map(c=>s+c));
 }
});
test('input limits and Unicode positions are explicit',()=>{
 assert.equal(bracketTrace('(🙂)').find(r=>r.ch==='🙂')!.i,1);
 assert.equal(verdict('('.repeat(128)+')'.repeat(128)),'Valid');
 assert.throws(()=>bracketTrace('('.repeat(257)),/256/);
});
test('the closer lookup stays visible for the current closing character, including the final verdict',()=>{
 for(const [text,opener] of [['()','('],['[]','['],['{}','{']]){
  const trace=bracketTrace(text!);
  for(const row of trace.filter(r=>r.i===1)){
   assert.equal(row.expected,opener);assert.equal(row.hasExpected,1);
  }
 }
 assert.equal(bracketTrace('(').at(-1)!.hasExpected,0);
 assert.equal(bracketTrace('').at(-1)!.hasExpected,0);
});
test('draft traces match the algorithm and every bound display expression evaluates',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../scenes/draft/parenthesis-validation.json',import.meta.url),'utf8'));
 assert.equal(lesson.codeFiles[0].source,BRACKET_SOURCE);
 const math=create(all!); // The math.js package supplies its full factory map.
 math.import({arrayAt,arrayCount,concat:(...v:unknown[])=>v.join('')},{override:true});
 for(const scene of lesson.scenes){
  const repairing=scene.steps[0].id==='repair';
  assert.deepEqual(scene.data.trace,(repairing?repairTrace:bracketTrace)(scene.data.input[0].chars.join('')));
  if(repairing)assert.equal(lesson.codeFiles[1].source,REPAIR_SOURCE);
  for(let frame=0;frame<scene.data.trace.length;frame++){
   const scope:Record<string,unknown>={frame,dataTable:(table:string,row:number,column:string)=>scene.data[table][row][column]};
   assert.equal(math.evaluate(lesson.codeFiles[0].activeLineExpr,scope),scene.data.trace[frame].line);
   for(const element of scene.steps[0].add){
    for(const key of ['textExpr','visibleExpr'])if(element[key])assert.doesNotThrow(()=>math.evaluate(element[key],scope));
    if(element.type==='array'){
     const length=math.evaluate(element.lengthExpr,scope);
     assert.equal(length,element.id==='stack'?scene.data.trace[frame].n:repairing?scene.data.trace[frame].chars.length:scene.data.input[0].chars.length);
     for(let idx=0;idx<length;idx++)assert.doesNotThrow(()=>math.evaluate(element.valueExpr,{...scope,idx}));
    }
   }
  }
 }
});
