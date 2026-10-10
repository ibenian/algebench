import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCodeRef, fileTree, relatedLocations, markedSegments, activeCodeLines, stepCodeLocations, lineActionsFor } from './code-panel-model.js';
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

test('block source references resolve exact files and reject invalid destinations',()=>{
 const files:CodeFile[]=[{id:'job',path:'job.py',source:'first\nsecond'}];
 assert.deepEqual(resolveCodeRef(files,{file:'job',line:2}),{file:files[0],line:2});
 for(const ref of [undefined,{file:'missing',line:1},{file:'job',line:0},{file:'job',line:3},{file:'job',line:1.5}]) assert.equal(resolveCodeRef(files,ref),null);
});

test('push lesson block references target existing source lines in every scenario',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 let count=0;
 function walk(value:unknown) {
  if(!value || typeof value!=='object') return;
  const object=value as Record<string,unknown>;
  if(object.codeRef) {
   const ref=object.codeRef as {file:string;line:number};
   assert.ok(resolveCodeRef(lesson.codeFiles,ref),JSON.stringify(ref));count++;
  }
  Object.values(object).forEach(walk);
 }
 walk(lesson);
 assert.equal(count,144);
});

test('code references mix literal and expression coordinates using fresh scene values',()=>{
 const files:CodeFile[]=[{id:'job',path:'job.py',source:'one\ntwo\nthree'}, {id:'other',path:'other.py',source:'a\nb'}];
 let frame=1;
 const evaluate=(expr:string):unknown=>expr==='selectedFile' ? (frame===1?'job':'other') : frame;
 const ref={file:'job',lineExpr:"dataTable('trace', frame, 'line')"};
 assert.equal(resolveCodeRef(files,ref,evaluate)?.line,1);
 frame=2;assert.equal(resolveCodeRef(files,ref,evaluate)?.line,2);
 assert.equal(resolveCodeRef(files,{fileExpr:'selectedFile',line:1},evaluate)?.file.id,'other');
 assert.equal(resolveCodeRef(files,{fileExpr:'selectedFile',lineExpr:'frame'},evaluate)?.line,2);
 // Expression coordinates override corresponding literals, rather than silently falling back.
 assert.equal(resolveCodeRef(files,{file:'missing',fileExpr:'selectedFile',line:99,lineExpr:'frame'},evaluate)?.line,2);
 assert.equal(resolveCodeRef(files,ref),null);
 assert.equal(resolveCodeRef(files,ref,()=>{throw new Error('missing table');}),null);
 for(const value of [0,-1,1.5,NaN,Infinity,'2',null,undefined]) assert.equal(resolveCodeRef(files,ref,()=>value),null);
 assert.equal(resolveCodeRef(files,{fileExpr:'file',line:1},()=>42),null);
});

test('line actions are scoped to the selection, the scene and existing sliders', () => {
    const file: CodeFile = { id: 'c', path: 'c.py', source: 'a\nb\nc', lineActions: [
        { line: 2, label: 'Crash here', set: { crashPoint: 2, crashTick: 'frame + 1' } },
        { line: 2, label: 'Other scene', scene: 'x', set: { crashPoint: 1 } },
        { line: 3, label: 'Missing slider', set: { nope: 1 } },
    ] };
    const has = (id: string) => id !== 'nope';
    assert.deepEqual(lineActionsFor(file, 2, 2, 'lab', has).map(a => a.label), ['Crash here']);
    assert.deepEqual(lineActionsFor(file, 1, 3, 'x', has).map(a => a.label), ['Crash here', 'Other scene']);
    assert.deepEqual(lineActionsFor(file, 1, 1, 'lab', has), []);
});
