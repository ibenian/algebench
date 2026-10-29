import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as mathjs from 'mathjs';
import {create,all} from 'mathjs';
import {arrayAt,arrayCount} from '../../../src/array-operations.js';
import {
    prefixSumTrace,twoPointersTrace,slidingWindowTrace,fastSlowTrace,fastSlowProofTrace,rhoShape,monotonicStackTrace,rotatedSearchTrace,mergeIntervalsTrace,intervalLanes,houseRobberTrace,kadaneTrace,lcsTrace,topKTrace,trieTrace,linkedListTrace,treeTraversalTrace,islandsTrace,powerTrace,fibTrace,subsetsTrace,topoTrace,topoDfsTrace,twoSumTrace,subarraySumTrace,
    monotonicQueueTrace,greedyTrace,bitsTrace,unionFindTrace,kmpTrace,
    MONOTONIC_QUEUE_SOURCE,GREEDY_SOURCE,BITS_SOURCE,UNION_FIND_SOURCE,KMP_SOURCE,
    PREFIX_SOURCE,TWO_POINTERS_SOURCE,SLIDING_WINDOW_SOURCE,FAST_SLOW_SOURCE,MONOTONIC_STACK_SOURCE,ROTATED_SEARCH_SOURCE,MERGE_INTERVALS_SOURCE,HOUSE_ROBBER_SOURCE,KADANE_SOURCE,LCS_SOURCE,TOP_K_SOURCE,TRIE_SOURCE,LINKED_LIST_SOURCE,TREE_TRAVERSAL_SOURCE,ISLANDS_SOURCE,RECURSION_SOURCE,SUBSETS_SOURCE,TOPO_SOURCE,HASH_MAP_SOURCE,
} from './algorithms.js';
import type {Frame} from './algorithms.js';
import {PATTERN_INPUTS as IN} from './inputs.js';

// expr.ts reads the browser's math.js global at import time.
const g=globalThis as unknown as {math:typeof mathjs;window:typeof globalThis};
g.math=mathjs;g.window??=globalThis;
const {_JS_ONLY_RE,_normalizeSingleQuotes}=await import('/expr.js') as {_JS_ONLY_RE:RegExp;_normalizeSingleQuotes:(s:string)=>string};
const last=(trace:Frame[])=>trace.at(-1)!;

test('prefix sums answer each range query',()=>{
 const trace=prefixSumTrace(IN.prefix.nums,IN.prefix.queries);
 assert.deepEqual(last(trace).prefix,[0,3,4,8,9,14,23,25,31]);
 assert.deepEqual(trace.filter(f=>f.line===8).map(f=>f.answer),IN.prefix.queries.map(([i,j])=>IN.prefix.nums.slice(i,j+1).reduce((s,x)=>s+x,0)));
});
test('two pointers: total always equals the pair it was computed from, even after a pointer moves',()=>{
 const {nums,target}=IN.twoPointers;
 for(const f of twoPointersTrace(nums,target))if(f.hasTotal)assert.equal(f.total,nums[f.sumL as number]!+nums[f.sumR as number]!);
 assert.ok(twoPointersTrace(nums,target).some(f=>f.hasTotal&&(f.sumL!==f.left||f.sumR!==f.right)),'the example has steps where a pointer moved after the sum');
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
test('sliding window: the line-6 comparison uses best before the update',()=>{
 const {nums,k}=IN.slidingWindow,trace=slidingWindowTrace(nums,k);
 for(const f of trace.filter(f=>f.line===6)){
  assert.equal(f.improved,(f.window as number)>(f.prevBest as number)?1:0);
  assert.equal(f.best,Math.max(f.prevBest as number,f.window as number));
 }
 assert.ok(trace.every(f=>f.line===6||(f.prevBest===-1&&f.improved===0)));
 assert.ok(trace.some(f=>f.line===6&&f.improved)&&trace.some(f=>f.line===6&&!f.improved),'the example shows both outcomes');
});
test('sliding window: the recorded update always reproduces the shown window',()=>{
 const {nums,k}=IN.slidingWindow;
 for(const f of slidingWindowTrace(nums,k)){
  if((f.wOld as number)<0){if(f.line<=3)assert.equal(f.window,nums.slice(0,k).reduce((a,b)=>a+b,0));continue;}
  const r=f.wRight as number;
  assert.equal(f.wIn,nums[r]);assert.equal(f.wOut,nums[r-k]);
  assert.equal(f.window,(f.wOld as number)+(f.wIn as number)-(f.wOut as number));
 }
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
test('each interval keeps one lane through the sort, and lane-mates never overlap',()=>{
 const input=IN.intervals.input,lanes=intervalLanes(input);
 for(let a=0;a<input.length;a++)for(let b=a+1;b<input.length;b++)
  if(lanes[a]===lanes[b])assert.ok(input[a]![1]<input[b]![0]||input[b]![1]<input[a]![0],`lane ${lanes[a]} holds overlapping ${input[a]} and ${input[b]}`);
 const laneOf=new Map(input.map((iv,i)=>[iv.join(','),lanes[i]]));
 for(const f of mergeIntervalsTrace(input)){
  const starts=f.starts as number[],ends=f.ends as number[],fl=f.lanes as number[];
  starts.forEach((s,i)=>assert.equal(fl[i],laneOf.get(`${s},${ends[i]}`),'an interval keeps its lane in every step'));
 }
});
test('merge intervals: the overlap check compares start with the last end before extending it',()=>{
 const trace=mergeIntervalsTrace(IN.intervals.input);
 for(const f of trace.filter(f=>f.line===5)){
  const k=f.k as number,start=(f.starts as number[])[k]!;
  assert.equal(f.cmpStart,start);
  if(f.cmp===-1)assert.equal(f.m,0);
  else assert.equal(f.cmp,start<=(f.cmpEnd as number)?1:0);
 }
 assert.deepEqual([...new Set(trace.filter(f=>f.line===5).map(f=>f.cmp))].sort(),[-1,0,1],'the example shows empty, overlap and no overlap');
});
test('house robber',()=>{
 assert.equal((last(houseRobberTrace(IN.dp.houses)).dp as number[]).at(-1),15);
 assert.equal((last(houseRobberTrace([2,1,1,2])).dp as number[]).at(-1),4);
});
test('kadane finds the maximum subarray sum and its range',()=>{
 const brute=(a:number[])=>{let m=-Infinity;for(let i=0;i<a.length;i++)for(let j=i;j<a.length;j++)m=Math.max(m,a.slice(i,j+1).reduce((x,y)=>x+y,0));return m;};
 for(const nums of [IN.kadane.nums,[-3,-1,-2],[5],[2,-1,2,-1,2],[1,-5,3]]){
  const f=last(kadaneTrace(nums));
  assert.equal(f.best,brute(nums));
  assert.equal(nums.slice(f.bs as number,(f.be as number)+1).reduce((x,y)=>x+y,0),f.best);
 }
 assert.equal(last(kadaneTrace(IN.kadane.nums)).best,6);
});
test('LCS fills the table and finds the longest common subsequence length',()=>{
 const brute=(a:string,b:string):number=>!a||!b?0:a[0]===b[0]?1+brute(a.slice(1),b.slice(1)):Math.max(brute(a.slice(1),b),brute(a,b.slice(1)));
 for(const [a,b] of [[IN.lcs.a,IN.lcs.b],['abcde','ace'],['abc','def'],['aaaa','aa']] as [string,string][]){
  const f=last(lcsTrace(a,b));
  assert.equal((f[`r${b.length}`] as number[])[a.length],brute(a,b));
  for(let i=0;i<=b.length;i++)for(let j=0;j<=a.length;j++)assert.equal((f[`r${i}`] as number[])[j],brute(a.slice(0,j),b.slice(0,i)));
 }
});
test('top-k keeps a valid min-heap of the k largest and answers the k-th largest',()=>{
 const isHeap=(h:number[])=>h.every((x,i)=>i===0||h[(i-1)>>1]!<=x);
 for(const [nums,k] of [[IN.topK.nums,IN.topK.k],[[3,2,1,5,6,4],2],[[3,2,3,1,2,4,5,5,6],4],[[1],1]] as [number[],number][]){
  const trace=topKTrace(nums,k),f=last(trace);
  assert.equal((f.heap as number[])[0],[...nums].sort((x,y)=>y-x)[k-1]);
  assert.deepEqual([...(f.heap as number[])].sort((x,y)=>x-y),[...nums].sort((x,y)=>y-x).slice(0,k).sort((x,y)=>x-y));
  // Between sifts (no slots under comparison) the heap rule holds and the heap never exceeds k after line 8.
  for(const fr of trace){if(fr.a===-1)assert.ok(isHeap(fr.heap as number[]),`heap rule at line ${fr.line}`);if(fr.line===5)assert.ok((fr.heap as number[]).length<=k);}
  assert.ok((f.dropped as number[]).every(d=>d<=(f.heap as number[])[0]!));
 }
});
test('trie shares prefixes, marks word ends, and answers starts_with',()=>{
 const {words,queries}=IN.trie,{trace,nodes}=trieTrace(words,queries),f=last(trace);
 // One node per distinct prefix, plus the root.
 assert.equal(nodes.length,new Set(words.flatMap(w=>[...w].map((_,i)=>w.slice(0,i+1)))).size+1);
 const spell=(i:number):string=>i<=0?'':spell(nodes[i]!.parent)+nodes[i]!.ch;
 assert.deepEqual(new Set((f.ends as number[]).flatMap((e,i)=>e?[spell(i)]:[])),new Set(words));
 // Each query's answer is recorded on its return line, and matches a direct check.
 const answers=trace.filter(fr=>fr.line===21||(fr.line===23&&fr.status==='Running')).map(fr=>fr.result);
 assert.deepEqual(answers,queries.map(q=>words.some(w=>w.startsWith(q))?'True':'False'));
 // Nodes appear in index order, and the walk is always a root path.
 for(const fr of trace){
  assert.ok((fr.count as number)>=1&&(fr.cur as number)<(fr.count as number));
  const on=(fr.onPath as number[]).flatMap((x,i)=>x?[i]:[]);
  for(const i of on)assert.ok(i===0||on.includes(nodes[i]!.parent));
 }
});
test('linked list reversal flips every next pointer and returns the old tail',()=>{
 for(const values of [IN.linkedList.values,[7],[4,9]]){
  const trace=linkedListTrace(values),f=last(trace),n=values.length;
  assert.equal(f.head,n-1,'the old tail is the new head');
  assert.deepEqual(f.next,values.map((_,i)=>i-1),'each node points at the one before it');
  assert.equal(f.fromPrev,[...values].reverse().concat([]).map(String).join(' → ')+' → None');
  // Between steps (not mid-flip, where curr already points into the reversed part) the two lists split the nodes.
  for(const fr of trace)if([8,9,10,13].includes(fr.line as number)||fr.status==='Done'){
   const count=(s:string)=>s==='None'?0:s.split(' → ').length-1;
   assert.equal(count(fr.fromPrev as string)+count(fr.fromCurr as string),n,`frame at line ${fr.line}`);
  }
 }
});
test('tree traversals visit every node once, in the textbook orders',()=>{
 const {values,parents,sides}=IN.tree;
 const out=(o:'preorder'|'inorder'|'postorder'|'level')=>last(treeTraversalTrace(o,values,parents,sides)).out;
 assert.deepEqual(out('preorder'),[8,4,2,1,3,6,12,10,14]);
 assert.deepEqual(out('inorder'),[1,2,3,4,6,8,10,12,14],'inorder reads a BST sorted');
 assert.deepEqual(out('postorder'),[1,3,2,6,4,10,14,12,8]);
 assert.deepEqual(out('level'),[8,4,12,2,6,10,14,1,3]);
 for(const o of ['preorder','inorder','postorder'] as const)for(const f of treeTraversalTrace(o,values,parents,sides)){
  // The call stack is always a root-to-node path.
  const st=f.stack as number[];
  st.forEach((i,k)=>assert.equal(k===0?parents[i]:st[k-1],parents[i]));
  if((f.cur as number)>=0&&f.status==='Running')assert.equal(st.at(-1),f.cur,`${o}: the node the code is at tops the stack`);
 }
});
test('islands: counts the groups and labels every land cell with its group',()=>{
 const grid=IN.islands.grid,cols=grid[0]!.length,trace=islandsTrace(grid),f=last(trace);
 assert.equal(f.count,5);
 // Every land cell is visited exactly once, into an island whose cells are all joined; water never is.
 const land=grid.flat().map((x,i)=>x===1?i:-1).filter(i=>i>=0),isl=f.island as number[];
 assert.ok(land.every(i=>isl[i]!>0)&&grid.flat().every((x,i)=>x===1||isl[i]===0));
 for(const i of land){const p=(f.from as number[])[i]!;if(p>=0){assert.equal(isl[p],isl[i]);assert.equal(Math.abs(Math.floor(p/cols)-Math.floor(i/cols))+Math.abs(p%cols-i%cols),1,'reached from a neighbour');}}
 assert.equal(new Set(land.map(i=>isl[i])).size,5);
 assert.ok((f.grid as number[]).every(x=>x===0),'dfs marks all land visited by overwriting it');
 // A 1×1 island and an all-water grid.
 assert.equal(last(islandsTrace([[1]])).count,1);assert.equal(last(islandsTrace([[0,0],[0,0]])).count,0);
});
test('recursion: fast power halves n each call; naive fib branches and repeats work',()=>{
 const p=powerTrace(2,13),f=last(p.trace);
 assert.equal(p.parents.length,5,'13, 6, 3, 1, 0');
 assert.deepEqual(p.parents,[-1,0,1,2,3],'a chain: each call makes one smaller call');
 assert.equal((f.text as string[])[0],'power(2, 13) = 8192');
 assert.ok((f.done as number[]).every(d=>d===1));
 // The deepest moment: four recursive calls wait on line 4 (the first call came from outside the code).
 assert.equal(Math.max(...p.trace.map(fr=>(fr.calls as number[]).length)),4);
 assert.ok(p.trace.every(fr=>(fr.calls as number[]).every(l=>l===4)));assert.deepEqual(f.calls,[]);
 const q=fibTrace(4),g=last(q.trace),texts=g.text as string[];
 assert.equal(texts[0],'fib(4) = 3');
 assert.equal(q.parents.length,9,'fib(4) makes 9 calls');
 assert.equal(texts.filter(t=>t.startsWith('fib(2)')).length,2,'fib(2) is solved twice');
 // While running, the waiting calls are a path from the first call.
 for(const run of [p,q])for(const fr of run.trace){
  const on=(fr.stack as number[]).flatMap((x,i)=>x?[i]:[]);
  on.forEach((i,k)=>assert.equal(k===0?-1:on[k-1],run.parents[i]));
 }
});
test('backtracking records every subset once, and the path is undone after each choice',()=>{
 const {trace,parents}=subsetsTrace([1,2,3]),f=last(trace),texts=f.text as string[];
 assert.equal(f.out,8);assert.equal(parents.length,8,'one call per subset');
 assert.deepEqual([...texts].sort(),['[1, 2, 3]','[1, 2]','[1, 3]','[1]','[2, 3]','[2]','[3]','[]']);
 assert.deepEqual(f.path,[],'every choice was undone');
 // Each frame's waiting calls: the first made from line 11, every deeper one from line 8, one per waiting call.
 for(const fr of trace){const c=fr.calls as number[],w=(fr.stack as number[]).reduce((a,b)=>a+b,0);assert.equal(c.length,w);c.forEach((l,k)=>assert.equal(l,k===0?11:8));}
 assert.deepEqual(f.calls,[],'every call has returned');
 assert.deepEqual(f.outText,texts,'out holds each call\'s subset, in call order');
 // Each child's path is its parent's path plus one larger number.
 parents.forEach((p,k)=>{if(p<0)return;const a=JSON.parse(texts[p]!),b=JSON.parse(texts[k]!);assert.deepEqual(b.slice(0,-1),a);assert.ok(a.length===0||b.at(-1)>a.at(-1));});
 assert.equal(subsetsTrace([]).trace.at(-1)!.out,1,'the empty list has one subset');
});
test('topological sort orders every course after its prerequisites, and a cycle returns nothing',()=>{
 const pre:[number,number][]=[[1,0],[2,0],[3,1],[3,2],[4,2],[5,3],[5,4]];
 const {trace,graph}=topoTrace(6,pre),f=last(trace),order=f.order as number[];
 assert.equal(order.length,6);assert.equal(f.result,JSON.stringify(order).replace(/,/g,', '));
 for(const [c,p] of pre)assert.ok(order.indexOf(p)<order.indexOf(c),`${p} before ${c}`);
 assert.deepEqual(f.indeg,[0,0,0,0,0,0]);assert.deepEqual(f.queue,[]);
 assert.deepEqual(f.seen,graph.map(g=>g.length),'every edge relaxed once');
 // A course in the queue has nothing left to wait for.
 for(const fr of trace)for(const q of fr.queue as number[])assert.equal((fr.indeg as number[])[q],0);
 const cyc=last(topoTrace(3,[[1,0],[2,1],[1,2]]).trace);
 assert.equal(cyc.result,'[]');assert.deepEqual(cyc.order,[0],'1 and 2 wait on each other');
});
test('topological sort by DFS reverses the post-order, with no in-degrees, and finds a cycle on the path',()=>{
 const pre:[number,number][]=[[1,0],[2,0],[3,1],[3,2],[4,2],[5,3],[5,4]];
 const {trace}=topoDfsTrace(6,pre),f=last(trace),order=JSON.parse(f.result as string) as number[];
 assert.equal(order.length,6);
 for(const [c,p] of pre)assert.ok(order.indexOf(p)<order.indexOf(c),`${p} before ${c}`);
 assert.deepEqual([...(f.order as number[])].reverse(),order);assert.deepEqual(f.state,[2,2,2,2,2,2]);
 assert.deepEqual(f.calls,[],'every dfs call returned');
 // A course is appended only after everything that depends on it.
 for(const [c,p] of pre)assert.ok((f.order as number[]).indexOf(c)<(f.order as number[]).indexOf(p));
 // The waiting calls match the courses on the path (state 1), one each.
 for(const fr of trace)assert.ok((fr.calls as number[]).length>=(fr.state as number[]).filter(x=>x===1).length);
 assert.equal(last(topoDfsTrace(3,[[1,0],[2,1],[1,2]]).trace).result,'[]');
});
test('two sum with a dict finds the pair in one pass; subarray sum counts by earlier prefixes',()=>{
 const t=twoSumTrace([4,11,7,2,15,5],9),f=last(t);
 assert.equal(f.result,'[2, 3]');assert.deepEqual(f.keys,[4,11,7],'the hit returns before 2 is stored');
 // Brute force agrees on every small case, and each number is looked up once.
 const brute=(a:number[],t:number)=>{for(let j=0;j<a.length;j++)for(let i=0;i<j;i++)if(a[i]!+a[j]! === t)return `[${i}, ${j}]`;return '[]';};
 for(const [a,tg] of [[[3,3],6],[[1,2,3],7],[[5,1,4,2],6],[[2,7,11,15],9]] as [number[],number][])assert.equal(last(twoSumTrace(a,tg)).result,brute(a,tg));
 const s=subarraySumTrace([1,2,1,2,1],3),g=last(s);
 assert.equal(g.total,4);assert.deepEqual(g.keys,[0,1,3,4,6,7]);assert.deepEqual(g.vals,[1,1,1,1,1,1]);
 const count=(a:number[],k:number)=>{let c=0;for(let i=0;i<a.length;i++){let x=0;for(let j=i;j<a.length;j++){x+=a[j]!;if(x===k)c++;}}return c;};
 for(const [a,k] of [[[1,1,1],2],[[1,-1,0],0],[[3,4,7,2,-3,1,4,2],7]] as [number[],number][])assert.equal(last(subarraySumTrace(a,k)).total,count(a,k));
});
test('monotonic queue gives every window maximum and keeps the deque decreasing',()=>{
 const {nums,k}=IN.monoQueue,trace=monotonicQueueTrace(nums,k);
 assert.deepEqual(last(trace).out,nums.slice(0,nums.length-k+1).map((_,i)=>Math.max(...nums.slice(i,i+k))));
 for(const f of trace){const vals=(f.dq as number[]).map(i=>nums[i]!);assert.ok(vals.every((x,i)=>i===0||vals[i-1]!>x));}
 assert.equal(trace[0]!.front,-1);
});
test('monotonic queue shows every condition evaluation, with the cells line 6 reads',()=>{
 const {nums,k}=IN.monoQueue,trace=monotonicQueueTrace(nums,k);
 const rows={6:'cond_w',9:'cond_e',11:'cond_f'} as Record<number,string>;
 for(const f of trace){
  const row=rows[f.line];
  if(row)assert.match((f as Record<string,unknown>)[row] as string,/→ (True|False)$/);
  if(f.line===6&&(f.back as number)>=0)assert.equal((f.cond_w as string).endsWith('True'),nums[f.back as number]!<=(f.x as number));
  if(f.line!==6)assert.equal(f.back,-1);
 }
 assert.equal(trace.filter(f=>f.line===11).length,nums.length,'the full-window check runs once per index, false ones included');
});
test('greedy jump game',()=>{
 assert.equal(last(greedyTrace(IN.greedy.nums)).ok,0);
 assert.equal(last(greedyTrace([2,3,1,1,4])).ok,1);
});
test('XOR leaves the single number, and bits match the values',()=>{
 const trace=bitsTrace(IN.bits.nums);
 assert.equal(last(trace).result,4);
 for(const f of trace)assert.equal(parseInt((f.rBits as number[]).join(''),2),f.result);
});
test('bits: on each XOR step, result = before XOR x, bit by bit',()=>{
 for(const f of bitsTrace(IN.bits.nums)){
  const b=f.bBits as number[],x=f.xBits as number[],r=f.rBits as number[];
  if(f.line===4)assert.deepEqual(r,b.map((bit,i)=>bit^x[i]!));
  else assert.deepEqual(r,b,'before equals result outside the XOR step');
 }
});
test('KMP shows every while/if evaluation, false ones included, with the cells it compared',()=>{
 const {text,pattern}=IN.kmp,P=[...pattern],Tx=[...text],trace=kmpTrace(text,pattern);
 const rows={4:'cond_bw',6:'cond_bi',14:'cond_sw',16:'cond_si',18:'cond_sm'} as Record<number,string>;
 for(const f of trace){
  const row=rows[f.line];
  if(row)assert.match(f[row] as string,/→ (True|False)$/,`line ${f.line} shows its result`);
  if(f.line===6||f.line===16){
   const left=f.line===6?P[f.cmpA as number]:Tx[f.cmpT as number];
   assert.equal((f[row!] as string).endsWith('True'),left===P[f.cmpB as number]);
  } else if(!row)assert.ok(f.cmpT===-1&&f.cmpA===-1&&f.cmpB===-1,`no cells compared on line ${f.line}`);
 }
 for(const line of [4,14,18])assert.ok(trace.some(f=>f.line===line&&(f[rows[line]!] as string).endsWith('False')),`line ${line} records a False evaluation`);
 assert.deepEqual(last(trace).hits,[0,9,12]);
});
test('union-find counts components',()=>{
 const done=last(unionFindTrace(IN.unionFind.n,IN.unionFind.edges));
 assert.equal(done.count,2);
 const parent=done.parent as number[],root=(x:number):number=>parent[x]===x?x:root(parent[x]!);
 assert.equal(new Set(parent.map((_,i)=>root(i))).size,2);
});
test('KMP finds every occurrence, including overlaps, and builds lps',()=>{
 const naive=(t:string,p:string)=>[...t].map((_,i)=>i).filter(i=>t.startsWith(p,i));
 const {text,pattern}=IN.kmp;
 assert.deepEqual(last(kmpTrace(text,pattern)).hits,naive(text,pattern));
 assert.deepEqual(last(kmpTrace('aaaa','aa')).hits,[0,1,2]);
 assert.deepEqual(last(kmpTrace('abcabd','abcabd')).lps,[0,0,0,1,2,0]);
 for(const f of kmpTrace(text,pattern))if((f.lo as number)>=0)assert.equal(text.slice(f.lo as number,(f.hi as number)+1),pattern.slice(0,(f.hi as number)-(f.lo as number)+1));
});
test('every trace frame has the same keys and ends Done',()=>{
 for(const trace of [prefixSumTrace(IN.prefix.nums,IN.prefix.queries),twoPointersTrace(IN.twoPointers.nums,IN.twoPointers.target),
  slidingWindowTrace(IN.slidingWindow.nums,IN.slidingWindow.k),fastSlowTrace(IN.fastSlow.nums),monotonicStackTrace(IN.monotonic.temps),
  rotatedSearchTrace(IN.rotated.nums,IN.rotated.target),mergeIntervalsTrace(IN.intervals.input),houseRobberTrace(IN.dp.houses),kadaneTrace(IN.kadane.nums),lcsTrace(IN.lcs.a,IN.lcs.b),topKTrace(IN.topK.nums,IN.topK.k),trieTrace(IN.trie.words,IN.trie.queries).trace,linkedListTrace(IN.linkedList.values),...(['preorder','inorder','postorder','level'] as const).map(o=>treeTraversalTrace(o,IN.tree.values,IN.tree.parents,IN.tree.sides)),islandsTrace(IN.islands.grid),powerTrace(IN.recursion.x,IN.recursion.n).trace,fibTrace(IN.recursion.fib).trace,subsetsTrace(IN.subsets.nums).trace,topoTrace(IN.topo.n,IN.topo.prerequisites).trace,topoDfsTrace(IN.topo.n,IN.topo.prerequisites).trace,twoSumTrace(IN.hashMap.nums,IN.hashMap.target),subarraySumTrace(IN.hashMap.sums,IN.hashMap.sumTarget),
  monotonicQueueTrace(IN.monoQueue.nums,IN.monoQueue.k),greedyTrace(IN.greedy.nums),bitsTrace(IN.bits.nums),
  unionFindTrace(IN.unionFind.n,IN.unionFind.edges),kmpTrace(IN.kmp.text,IN.kmp.pattern)]){
  const keys=Object.keys(trace[0]!).sort();
  for(const f of trace)assert.deepEqual(Object.keys(f).sort(),keys);
  assert.equal(last(trace).status,'Done');assert.ok(trace.slice(0,-1).every(f=>f.status==='Running'));
 }
});

test('draft lesson is in sync with the traces and every bound expression evaluates',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 const expected:Record<string,[string,Frame[]]>={
  'prefix-sum':[PREFIX_SOURCE,prefixSumTrace(IN.prefix.nums,IN.prefix.queries)],
  'two-pointers':[TWO_POINTERS_SOURCE,twoPointersTrace(IN.twoPointers.nums,IN.twoPointers.target)],
  'sliding-window':[SLIDING_WINDOW_SOURCE,slidingWindowTrace(IN.slidingWindow.nums,IN.slidingWindow.k)],
  'fast-slow':[FAST_SLOW_SOURCE,fastSlowTrace(IN.fastSlow.nums)],
  'monotonic-stack':[MONOTONIC_STACK_SOURCE,monotonicStackTrace(IN.monotonic.temps)],
  'rotated-search':[ROTATED_SEARCH_SOURCE,rotatedSearchTrace(IN.rotated.nums,IN.rotated.target)],
  'merge-intervals':[MERGE_INTERVALS_SOURCE,mergeIntervalsTrace(IN.intervals.input)],
  'dynamic-programming':[HOUSE_ROBBER_SOURCE,houseRobberTrace(IN.dp.houses)],
  'kadane':[KADANE_SOURCE,kadaneTrace(IN.kadane.nums)],
  'dp-2d':[LCS_SOURCE,lcsTrace(IN.lcs.a,IN.lcs.b)],
  'top-k':[TOP_K_SOURCE,topKTrace(IN.topK.nums,IN.topK.k)],
  'trie':[TRIE_SOURCE,trieTrace(IN.trie.words,IN.trie.queries).trace],
  'linked-list-reversal':[LINKED_LIST_SOURCE,linkedListTrace(IN.linkedList.values)],
  'tree-traversal':[TREE_TRAVERSAL_SOURCE,treeTraversalTrace('preorder',IN.tree.values,IN.tree.parents,IN.tree.sides)],
  'matrix-traversal':[ISLANDS_SOURCE,islandsTrace(IN.islands.grid)],
  'recursion':[RECURSION_SOURCE,powerTrace(IN.recursion.x,IN.recursion.n).trace],
  'backtracking':[SUBSETS_SOURCE,subsetsTrace(IN.subsets.nums).trace],
  'topological-sort':[TOPO_SOURCE,topoDfsTrace(IN.topo.n,IN.topo.prerequisites).trace],
  'hash-map':[HASH_MAP_SOURCE,twoSumTrace(IN.hashMap.nums,IN.hashMap.target)],
  'monotonic-queue':[MONOTONIC_QUEUE_SOURCE,monotonicQueueTrace(IN.monoQueue.nums,IN.monoQueue.k)],
  'greedy':[GREEDY_SOURCE,greedyTrace(IN.greedy.nums)],
  'bit-manipulation':[BITS_SOURCE,bitsTrace(IN.bits.nums)],
  'union-find':[UNION_FIND_SOURCE,unionFindTrace(IN.unionFind.n,IN.unionFind.edges)],
  'string-matching':[KMP_SOURCE,kmpTrace(IN.kmp.text,IN.kmp.pattern)],
 };
 const raw=create(all!); // The math.js package supplies its full factory map.
 raw.import({arrayAt,arrayCount,concat:(...v:unknown[])=>v.join('')},{override:true});
 // Evaluate as the app does: single-quoted strings keep their contents literally.
 const math={evaluate:(expr:string,scope:Record<string,unknown>)=>raw.evaluate(_normalizeSingleQuotes(expr),scope)};
 const animated=lesson.scenes.filter((s:{data?:{trace?:unknown}})=>s.data?.trace);
 assert.deepEqual(animated.map((s:{id:string})=>s.id).sort(),Object.keys(expected).sort());
 for(const scene of animated){
  const [source,trace]=expected[scene.id]!,file=lesson.codeFiles.find((f:{id:string})=>f.id===scene.id);
  assert.equal(scene.codeRef.file,scene.id);assert.equal(file.source,source);assert.deepEqual(scene.data.trace,trace);
  assert.equal(file.locations.filter((l:{step:string})=>l.step==='run').length,trace.length);
  const lines=source.split('\n').length;
  for(let frame=0;frame<trace.length;frame++){
   const scope:Record<string,unknown>={frame,dataTable:(table:string,row:number,column:string)=>scene.data[table][row][column]};
   const line=math.evaluate(scene.codeRef.lineExpr,scope);
   assert.equal(line,trace[frame]!.line);assert.ok(line>=1&&line<=lines);
   for(const el of scene.steps[0].add){
    // Arrays, stacks and dicts evaluate per cell, with idx (and value) bound.
    const cells=['array','stack','dict'].includes(el.type);
    for(const key of ['textExpr','visibleExpr','highlightExpr','tooltipExpr'])if(el[key]&&!cells)assert.doesNotThrow(()=>math.evaluate(el[key],scope),`${scene.id}/${el.id}.${key}`);
    if(!cells)continue;
    const length=math.evaluate(el.lengthExpr,scope);
    for(let idx=0;idx<length;idx++){
     const value=math.evaluate(el.valueExpr,{...scope,idx});
     if(el.keyExpr)assert.doesNotThrow(()=>math.evaluate(el.keyExpr,{...scope,idx,value}),`${scene.id}/${el.id}.keyExpr`);
     // The array renderer binds each cell's idx and value for highlightExpr.
     if(el.highlightExpr)assert.equal(typeof math.evaluate(el.highlightExpr,{...scope,idx,value}),'boolean',`${scene.id}/${el.id}.highlightExpr`);
    }
    for(const m of el.markers??[]){
     const index=math.evaluate(m.indexExpr,scope);assert.ok(Number.isInteger(index),`${scene.id}/${el.id} marker ${m.indexName}`);
     if(m.visibleExpr)math.evaluate(m.visibleExpr,scope);
    }
   }
  }
 }
});

test('no lesson expression reads as native JavaScript, so the lesson never asks for trust',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 const flagged:string[]=[];
 const walk=(v:unknown,key:string)=>{
  if(typeof v==='string'){if((key.endsWith('Expr')||key==='content')&&_JS_ONLY_RE.test(v))flagged.push(`${key}: ${v}`);}
  else if(Array.isArray(v))v.forEach(x=>walk(x,key));
  else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v))walk(x,k);
 };
 walk(lesson,'');
 assert.deepEqual(flagged,[]);
});

test('every pattern scene states its problem first: as the step-0 caption and at the top of its doc',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 for(const scene of lesson.scenes.slice(1)){
  const [heading,,problem]=scene.markdown.split('\n');
  assert.equal(heading,`# ${scene.title}`,scene.id);
  assert.equal(problem,`**Problem:** ${scene.description}`,scene.id);
  if(scene.data)assert.match(scene.markdown,/\n\*\*Example:\*\* /,`${scene.id} has a worked example`);
 }
});

test('every label tooltip reads a recorded tip column of well-formed LaTeX',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 let tips=0;
 for(const scene of lesson.scenes.filter((s:{data?:{trace?:unknown}})=>s.data?.trace)){
  for(const el of scene.steps[0].add.filter((e:{tooltipExpr?:string})=>e.tooltipExpr)){
   const column=/dataTable\('trace', frame, '(tip_\w+)'\)/.exec(el.tooltipExpr)?.[1];
   assert.ok(column,`${scene.id}/${el.id} reads a tip column`);
   for(const frame of scene.data.trace){
    const tex:string=frame[column!];
    assert.equal(typeof tex,'string',`${scene.id}/${el.id}: ${column} exists on every step`);
    let depth=0;for(const ch of tex){depth+=ch==='{'?1:ch==='}'?-1:0;assert.ok(depth>=0);}
    assert.equal(depth,0,`${scene.id}/${el.id}: balanced braces in ${tex}`);
    assert.equal(tex.split('\\lbrack').length,tex.split('\\rbrack').length,`${scene.id}/${el.id}: paired brackets in ${tex}`);
    if(tex)tips++;
   }
  }
 }
 assert.ok(tips>200,'tooltips are present across the lesson');
});

test('label code links resolve to a real line, the one that last assigned the value',()=>{
 const lineMath=create(all!);
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 let links=0;
 for(const scene of lesson.scenes.filter((s:{data?:{trace?:unknown}})=>s.data?.trace)){
  const file=lesson.codeFiles.find((f:{id:string})=>f.id===scene.codeRef.file),lines=file.source.split('\n').length;
  for(const el of scene.steps[0].add.filter((e:{codeRef?:unknown})=>e.codeRef)){
   assert.equal(el.codeRef.file,file.id,`${scene.id}/${el.id} links into the scene's file`);
   for(const frame of scene.data.trace){
    // An ln_<var> column names the line that last assigned the value; any other lineExpr is evaluated.
    const ln=el.codeRef.lineExpr&&/'(ln_\w+)'/.exec(el.codeRef.lineExpr);
    const line=ln?frame[ln[1]!]:el.codeRef.lineExpr?lineMath.evaluate(_normalizeSingleQuotes(el.codeRef.lineExpr),{frame:scene.data.trace.indexOf(frame),dataTable:(t:string,r:number,c:string)=>scene.data[t][r][c]}):el.codeRef.line;
    assert.ok(Number.isInteger(line)&&line>=0&&line<=lines,`${scene.id}/${el.id}: line ${line}`);
    if(line)links++;
   }
  }
 }
 assert.ok(links>300);
 // Binary search assigns lo on lines 2, 11, 14 and hi on 2, 9, 16: the links follow whichever ran last.
 const rs=lesson.scenes.find((s:{id:string})=>s.id==='rotated-search').data.trace;
 const used=(key:'ln_lo'|'ln_hi')=>new Set<number>(rs.map((f:Record<string,number>)=>f[key]));
 for(const line of used('ln_lo'))assert.ok([2,11,14].includes(line),`lo links to line ${line}, which assigns it`);
 for(const line of used('ln_hi'))assert.ok([2,9,16].includes(line),`hi links to line ${line}, which assigns it`);
 assert.ok(used('ln_lo').size>1,'the lo link moves to the line that reassigned it');
});

test('the fast-slow proof step measures A, B and C and plays its own table',()=>{
 const nums=IN.fastSlow.nums;
 assert.deepEqual(rhoShape(nums),{path:[0,2,4,3],cycle:[1,6,5],entrance:1,A:4,C:3});
 const run=fastSlowProofTrace(nums),end=last(run);
 assert.equal(end.meet,5);assert.equal(end.B,2);assert.equal(end.slow,1);assert.equal(end.fast,1);
 const firstMeeting=run.find(f=>f.phase===1&&f.slow===f.fast&&f.t>0)!;
 assert.equal(firstMeeting.t,6,'2t - t = kC: t = 6 = 2·3, and t = A + B + mC: 6 = 4 + 2 + 0·3');
 assert.equal(run.filter(f=>f.phase===2).at(-1)!.phaseSteps,4,'phase 2 meets after A steps');
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/common-algorithm-patterns.json',import.meta.url),'utf8'));
 const scene=lesson.scenes.find((s:{id:string})=>s.id==='fast-slow'),step=scene.steps.find((s:{id:string})=>s.id==='proof');
 assert.deepEqual(scene.data.proof.map((f:Frame)=>f.message),run.map(f=>f.message));
 assert.equal(step.sliders[0].max,run.length-1);
 const raw=create(all!);raw.import({arrayAt,arrayCount,concat:(...v:unknown[])=>v.join('')},{override:true});
 const lines=FAST_SLOW_SOURCE.split('\n').length;
 for(let frame=0;frame<run.length;frame++){
  const scope:Record<string,unknown>={frame,dataTable:(table:string,row:number,column:string)=>scene.data[table][row][column]};
  const ev=(e:string)=>raw.evaluate(_normalizeSingleQuotes(e),scope);
  const line=ev(step.codeRef.lineExpr);assert.ok(line>=1&&line<=lines);
  assert.equal(typeof ev(step.descriptionExpr),'string');
  for(const el of step.add){
   for(const key of ['textExpr','visibleExpr'])if(el[key])assert.doesNotThrow(()=>ev(el[key]),`proof/${el.id}.${key}`);
   if(el.type!=='graph')continue;
   // The graph: every node has a place, every marker a node, every link a colour and a highlight.
   const count=ev(el.lengthExpr);
   for(let idx=0;idx<count;idx++){
    const value=raw.evaluate(_normalizeSingleQuotes(el.valueExpr),{...scope,idx});
    const at={...scope,idx,value};
    for(const p of el.positionExpr)assert.ok(Number.isFinite(raw.evaluate(_normalizeSingleQuotes(p),at)),`proof/${el.id} node ${idx} position`);
    assert.equal(typeof raw.evaluate(_normalizeSingleQuotes(el.colorExpr),at),'string');
    const to=raw.evaluate(_normalizeSingleQuotes(el.connectTo.indexExpr),at);
    assert.equal(typeof raw.evaluate(_normalizeSingleQuotes(el.connectTo.colorExpr),{...at,to}),'string');
    assert.equal(typeof raw.evaluate(_normalizeSingleQuotes(el.connectTo.highlightExpr),{...at,to}),'boolean');
   }
   for(const m of el.markers)assert.ok(Number.isInteger(ev(m.indexExpr)),`proof marker ${m.indexName}`);
  }
  for(const o of step.info)assert.doesNotThrow(()=>ev(o.visibleExpr),`proof info ${o.id}`);
 }
});
