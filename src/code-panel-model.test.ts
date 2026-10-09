import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTree, relatedLocations, markedSegments, activeCodeLines, stepCodeLocations } from './code-panel-model.js';
import type { CodeFile } from './code-panel-model.js';
test('file browser preserves full paths and groups folders independently of lesson steps',()=>{
 const a={id:'a',path:'brackets/main.py',source:'a'},b={id:'b',path:'brackets/helpers/main.py',source:'b'};
 const tree=fileTree([a,b]);assert.equal(tree.folders.get('brackets')?.files[0],a);
 assert.equal(tree.folders.get('brackets')?.folders.get('helpers')?.files[0],b);
});
test('one line may target multiple steps; repeated targets in a selection are deduplicated',()=>{
 const f:CodeFile={id:'a',path:'main.py',source:'push()',locations:[{line:5,scene:'s',step:'first'},{line:5,scene:'s',step:'second'},{line:6,scene:'s',step:'second'}]};
 assert.equal(relatedLocations(f,5,6).length,2);assert.equal(relatedLocations(f,1,4).length,0);
});
test('one-based end-exclusive marks retain exact source, including HTML-looking text',()=>{
 const source='stack.push(<value>)';
 const result=markedSegments(source,[{line:1,startColumn:1,endColumn:6,color:'blue'},{line:1,startColumn:12,endColumn:19,color:'gold'}]);
 assert.equal(result.map(s=>s.text).join(''),source);assert.equal(result[0]?.text,'stack');assert.equal(result[0]?.color,'blue');
 assert.deepEqual(markedSegments('abc',[{line:1,startColumn:20,endColumn:30,color:'pink'}]),[{text:'abc',color:undefined}]);
});
test('repeated code lines can link to distinct snapshots within one lesson section',()=>{
 const f:CodeFile={id:'stack',path:'stack.py',source:'push()',locations:[{line:1,scene:'s',step:'explore',snapshot:1},{line:1,scene:'s',step:'explore',snapshot:2},{line:1,scene:'s',step:'explore',snapshot:2}]};
 assert.deepEqual(relatedLocations(f,1,1).map(l=>l.snapshot),[1,2]);
});

test('execution bindings accept simultaneous matrix lines and reject invalid positions',()=>{
 assert.deepEqual([...activeCodeLines(4)],[4]);
 assert.deepEqual([...activeCodeLines([3,0,7,3,-1,NaN,2.5,'8'])],[3,7]);
 assert.deepEqual([...activeCodeLines({toArray:()=>[2,5]})],[2,5]);
 assert.equal(activeCodeLines([]).size,0);assert.equal(activeCodeLines(undefined).size,0);
});

test('step links preserve file identity, validate lines, and filter snapshots',()=>{
 const a:CodeFile={id:'a',path:'main.py',source:'one\ntwo\nthree',locations:[
  {line:1,scene:'s',step:'execute'}, {line:1,scene:'s',step:'execute'},
  {line:2,scene:'s',step:'execute',snapshot:4}, {line:3,scene:'other',step:'execute'},
  {line:99,scene:'s',step:'execute'}, {line:3,scene:'s',step:'defend'},
 ]};
 const b:CodeFile={id:'b',path:'worker.py',source:'one',locations:[{line:1,scene:'s',step:'execute'}]};
 const refs=(tick?:number)=>stepCodeLocations([a,b],'s','execute',tick).map(r=>[r.file.id,r.location.line]);
 assert.deepEqual(refs(4),[['a',1],['a',2],['b',1]]);
 assert.deepEqual(refs(3),[['a',1],['b',1]]);
 assert.deepEqual(refs(),[['a',1],['b',1]]);
 assert.deepEqual(stepCodeLocations([a],'s','defend').map(r=>r.location.line),[3]);
 assert.deepEqual(stepCodeLocations([a],'missing','execute'),[]);
});

test('live step links include only the current execution and failure branches',()=>{
 const file:CodeFile={id:'worker',path:'worker.py',source:'send\ncomplete\nretry',locations:[
  {line:1,scene:'s',step:'execute'}, {line:2,scene:'s',step:'execute'}, {line:3,scene:'s',step:'execute'},
 ]};
 const refs=(lines:number[])=>stepCodeLocations([file],'s','execute',5,()=>new Set(lines)).map(r=>r.location.line);
 assert.deepEqual(refs([1,2]),[1,2]);assert.deepEqual(refs([3]),[3]);assert.deepEqual(refs([]),[]);
});
