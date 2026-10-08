import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {create,all} from 'mathjs';
import {arrayAt,arrayCount} from '../array-operations.js';
import {
    prefixSumTrace,twoPointersTrace,slidingWindowTrace,fastSlowTrace,monotonicStackTrace,rotatedSearchTrace,mergeIntervalsTrace,houseRobberTrace,
    PREFIX_SOURCE,TWO_POINTERS_SOURCE,SLIDING_WINDOW_SOURCE,FAST_SLOW_SOURCE,MONOTONIC_STACK_SOURCE,ROTATED_SEARCH_SOURCE,MERGE_INTERVALS_SOURCE,HOUSE_ROBBER_SOURCE,
} from './interview-patterns.js';
import type {Frame} from './interview-patterns.js';
import {INTERVIEW_INPUTS as IN} from './interview-pattern-inputs.js';

const last=(trace:Frame[])=>trace.at(-1)!;

test('prefix sums answer each range query',()=>{
 const trace=prefixSumTrace(IN.prefix.nums,IN.prefix.queries);
 assert.deepEqual(last(trace).prefix,[0,3,4,8,9,14,23,25,31]);
 assert.deepEqual(trace.filter(f=>f.line===8).map(f=>f.answer),IN.prefix.queries.map(([i,j])=>IN.prefix.nums.slice(i,j+1).reduce((s,x)=>s+x,0)));
});
test('two pointers find the pair and report a miss',()=>{
 const hit=last(twoPointersTrace(IN.twoPointers.nums,IN.twoPointers.target));
 assert.equal(hit.found,1);assert.equal(IN.twoPointers.nums[hit.left as number]!+IN.twoPointers.nums[hit.right as number]!,IN.twoPointers.target);
 const miss=last(twoPointersTrace([1,2,4],100));assert.equal(miss.found,0);assert.equal(miss.line,11);
});
test('sliding window tracks the best fixed-size window',()=>{
 const {nums,k}=IN.slidingWindow,done=last(slidingWindowTrace(nums,k));
 const sums=nums.slice(0,nums.length-k+1).map((_,i)=>nums.slice(i,i+k).reduce((s,x)=>s+x,0));
 assert.equal(done.best,Math.max(...sums));assert.equal(done.left,sums.indexOf(Math.max(...sums)));
});
test('Floyd finds the duplicate',()=>{
 assert.equal(last(fastSlowTrace(IN.fastSlow.nums)).slow,1);
 assert.equal(last(fastSlowTrace([1,3,4,2,2])).slow,2);
 assert.equal(last(fastSlowTrace([3,1,3,4,2])).slow,3);
});
test('monotonic stack gives days until warmer',()=>{
 assert.deepEqual(last(monotonicStackTrace(IN.monotonic.temps)).answer,[1,1,4,2,1,1,0,0]);
 for(const f of monotonicStackTrace(IN.monotonic.temps)){
  const temps=(f.stack as number[]).map(i=>IN.monotonic.temps[i]!);
  assert.ok(temps.every((t,i)=>i===0||temps[i-1]!>=t),'stack temperatures never increase bottom to top');
 }
});
test('rotated search finds every element and rejects absent targets',()=>{
 const {nums}=IN.rotated;
 nums.forEach((x,i)=>assert.equal(last(rotatedSearchTrace(nums,x)).found,i));
 assert.equal(last(rotatedSearchTrace(nums,4)).found,-1);
 const used=new Set(rotatedSearchTrace(nums,IN.rotated.target).map(f=>f.line));
 assert.ok(used.has(13)&&used.has(8),'the example exercises both sorted-half branches');
});
test('merge intervals',()=>{
 const done=last(mergeIntervalsTrace(IN.intervals.input));
 assert.deepEqual([done.mStarts,done.mEnds],[[1,8,15],[6,12,18]]);
 const touching=last(mergeIntervalsTrace([[1,4],[4,5]]));assert.deepEqual([touching.mStarts,touching.mEnds],[[1],[5]]);
});
test('house robber',()=>{
 assert.equal((last(houseRobberTrace(IN.dp.houses)).dp as number[]).at(-1),15);
 assert.equal((last(houseRobberTrace([2,1,1,2])).dp as number[]).at(-1),4);
});
test('every trace frame has the same keys and ends Done',()=>{
 for(const trace of [prefixSumTrace(IN.prefix.nums,IN.prefix.queries),twoPointersTrace(IN.twoPointers.nums,IN.twoPointers.target),
  slidingWindowTrace(IN.slidingWindow.nums,IN.slidingWindow.k),fastSlowTrace(IN.fastSlow.nums),monotonicStackTrace(IN.monotonic.temps),
  rotatedSearchTrace(IN.rotated.nums,IN.rotated.target),mergeIntervalsTrace(IN.intervals.input),houseRobberTrace(IN.dp.houses)]){
  const keys=Object.keys(trace[0]!).sort();
  for(const f of trace)assert.deepEqual(Object.keys(f).sort(),keys);
  assert.equal(last(trace).status,'Done');assert.ok(trace.slice(0,-1).every(f=>f.status==='Running'));
 }
});

test('draft lesson is in sync with the traces and every bound expression evaluates',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../scenes/draft/interview-patterns.json',import.meta.url),'utf8'));
 const expected:Record<string,[string,Frame[]]>={
  'prefix-sum':[PREFIX_SOURCE,prefixSumTrace(IN.prefix.nums,IN.prefix.queries)],
  'two-pointers':[TWO_POINTERS_SOURCE,twoPointersTrace(IN.twoPointers.nums,IN.twoPointers.target)],
  'sliding-window':[SLIDING_WINDOW_SOURCE,slidingWindowTrace(IN.slidingWindow.nums,IN.slidingWindow.k)],
  'fast-slow':[FAST_SLOW_SOURCE,fastSlowTrace(IN.fastSlow.nums)],
  'monotonic-stack':[MONOTONIC_STACK_SOURCE,monotonicStackTrace(IN.monotonic.temps)],
  'rotated-search':[ROTATED_SEARCH_SOURCE,rotatedSearchTrace(IN.rotated.nums,IN.rotated.target)],
  'merge-intervals':[MERGE_INTERVALS_SOURCE,mergeIntervalsTrace(IN.intervals.input)],
  'dynamic-programming':[HOUSE_ROBBER_SOURCE,houseRobberTrace(IN.dp.houses)],
 };
 const math=create(all!); // The math.js package supplies its full factory map.
 math.import({arrayAt,arrayCount,concat:(...v:unknown[])=>v.join('')},{override:true});
 const animated=lesson.scenes.filter((s:{data?:unknown})=>s.data);
 assert.deepEqual(animated.map((s:{id:string})=>s.id).sort(),Object.keys(expected).sort());
 for(const scene of animated){
  const [source,trace]=expected[scene.id]!,file=lesson.codeFiles.find((f:{id:string})=>f.id===scene.id);
  assert.equal(file.source,source);assert.deepEqual(scene.data.trace,trace);
  assert.equal(file.locations.length,trace.length);
  const lines=source.split('\n').length;
  for(let frame=0;frame<trace.length;frame++){
   const scope:Record<string,unknown>={frame,dataTable:(table:string,row:number,column:string)=>scene.data[table][row][column]};
   const line=math.evaluate(file.activeLineExpr,scope);
   assert.equal(line,trace[frame]!.line);assert.ok(line>=1&&line<=lines);
   for(const el of scene.steps[0].add){
    for(const key of ['textExpr','visibleExpr'])if(el[key])assert.doesNotThrow(()=>math.evaluate(el[key],scope),`${scene.id}/${el.id}.${key}`);
    if(el.type!=='array'&&el.type!=='stack')continue;
    const length=math.evaluate(el.lengthExpr,scope);
    for(let idx=0;idx<length;idx++){
     assert.doesNotThrow(()=>math.evaluate(el.valueExpr,{...scope,idx}),`${scene.id}/${el.id}.valueExpr`);
     if(el.highlightExpr)assert.equal(typeof math.evaluate(el.highlightExpr,{...scope,idx}),'boolean',`${scene.id}/${el.id}.highlightExpr`);
    }
    for(const m of el.markers??[]){
     const index=math.evaluate(m.indexExpr,scope);assert.ok(Number.isInteger(index),`${scene.id}/${el.id} marker ${m.indexName}`);
     if(m.visibleExpr)math.evaluate(m.visibleExpr,scope);
    }
   }
  }
 }
});
