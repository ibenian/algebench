import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSystemDAG, pipeArrowDimensions } from './system-dag-layout.js';
import type { SystemBlock, SystemConnection } from '/types/lesson.js';
const block=(id:string,position:SystemBlock['position']=[0,0,0],extras:Partial<SystemBlock>={}):SystemBlock=>({id,label:id,size:[4,2,.16],position,...extras});
const wire=(from:string,to:string,extras:Partial<SystemConnection>={}):SystemConnection=>({id:`${from}-${to}`,from:{block:from},to:{block:to},...extras});
test('containment, world placement, and relative placement resolve independently of wiring',()=>{
 const layout=resolveSystemDAG([block('cluster',[10,4,0],{size:[12,8,.1],blocks:[block('source',[-3,1,0]),block('sink',undefined,{placement:{relativeTo:'source',side:'right',gap:1}})]}),block('external',[0,-5,0],{space:'world'})],[],[1,2,0]);
 assert.deepEqual(layout.nodes.get('source')!.position,[8,7,0]);assert.deepEqual(layout.nodes.get('sink')!.position,[13,7,0]);assert.deepEqual(layout.nodes.get('external')!.position,[0,-5,0]);
});
test('reject duplicate identities, invalid ports, cyclic placement, and escaped children',()=>{
 assert.throws(()=>resolveSystemDAG([block('x'),block('x')]),/Duplicate/);
 assert.throws(()=>resolveSystemDAG([block('a',undefined,{placement:{relativeTo:'b'}}),block('b',undefined,{placement:{relativeTo:'a'}})]),/Cyclic/);
 assert.throws(()=>resolveSystemDAG([block('a')],[wire('a','unknown')]),/Unknown/);
 assert.throws(()=>resolveSystemDAG([block('a'),block('b',[6,0,0])],[wire('a','b',{from:{block:'a',port:'missing'}})]),/Unknown port/);
 assert.throws(()=>resolveSystemDAG([block('parent',undefined,{blocks:[block('child',[4,0,0])]})]),/outside container/);
});
test('named ports connect nested interiors and external services without conflating containment',()=>{
 const group=block('job',undefined,{size:[8,6,.1],ports:[{id:'in',side:'left'}],blocks:[block('source',[-1,0,0],{size:[3,1,.16]})],connections:[wire('job','source',{id:'internal',from:{block:'job',port:'in',inside:true}})]});
 const l=resolveSystemDAG([group,block('kafka',[-10,0,0])],[wire('kafka','job',{to:{block:'job',port:'in'}})]);
 assert.equal(l.wires.length,2);assert.equal(l.wires[0]!.owner,'job');assert.equal(l.nodes.get('source')!.parent,'job');
 assert.equal(l.wires[1]!.points.at(-1)![0],-4);
});
test('orthogonal pipes avoid unrelated blocks and preserve fixed port faces',()=>{
 const l=resolveSystemDAG([block('a',[-6,0,0]),block('obstacle'),block('b',[6,0,0])],[wire('a','b')]);
 const p=l.wires[0]!.points;assert.ok(p.some(v=>Math.abs(v[1])>1));
 for(let i=1;i<p.length;i++)assert.equal(p[i]!.filter((v,j)=>Math.abs(v-p[i-1]![j]!)>1e-6).length,1);
 assert.equal(p[0]![0],-4);assert.equal(p.at(-1)![0],4);
});
test('feedback connections are allowed while placement remains acyclic; owner-local waypoints resolve',()=>{
 const l=resolveSystemDAG([block('a',[-4,0,0]),block('b',[4,0,0])],[wire('a','b'),wire('b','a',{via:[{position:[0,-4,0]}]})],[1,2,0]);
 assert.ok(l.wires[1]!.points.some(p=>p[0]===1&&p[1]===-2));
});
test('pipe arrowheads scale with physical radius and never exaggerate a short connection',()=>{
 assert.deepEqual(pipeArrowDimensions(.05,10),{length:.05*7,radius:.05*3});
 const short=pipeArrowDimensions(.05,.1);assert.ok(short.length<=.075+1e-12);assert.ok(short.radius<=short.length*.44);
});

test('platform containment stacks local children above each supporting surface',()=>{
 const l=resolveSystemDAG([block('base',[0,0,1],{size:[12,8,.12],childElevation:.2,blocks:[block('middle',[0,0,.02],{size:[8,6,.18],childElevation:.15,blocks:[block('leaf',[0,0,0],{size:[3,1,.1]})]})]})]);
 assert.ok(Math.abs(l.nodes.get('middle')!.position[2]-1.37)<1e-9);
 assert.ok(Math.abs(l.nodes.get('leaf')!.position[2]-1.66)<1e-9);
 const plain=resolveSystemDAG([block('base',undefined,{size:[8,6,.12],blocks:[block('leaf',[0,0,.02])]})]);
 assert.equal(plain.nodes.get('leaf')!.position[2],.02);
 assert.throws(()=>resolveSystemDAG([block('base',undefined,{childElevation:-1,blocks:[block('leaf')]})]),/elevation/);
});
