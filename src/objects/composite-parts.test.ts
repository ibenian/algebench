import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '/state.js';
import { registerCompositePart } from './composite-parts.js';
import type { Object3D } from 'three';
const view={group(){return this;}} as unknown as MathBoxNode;
test('composite parts have independent identity, meshes, and contextual labels',()=>{
 state.elementRegistry={};state.legendToggledOff=new Set();
 const mesh={userData:{}} as Object3D;
 const entry=registerCompositePart('dag::block:topic::status','dag::block:topic',view,[mesh],[],'topic status: 8 log / 0 lag','Explain this topic status','text');
 assert.equal(state.elementRegistry['dag::block:topic::status'],entry);
 assert.equal(mesh.userData.askObjectId,'dag::block:topic::status');
 assert.equal(entry.type,'text');assert.match(entry.label,/8 log/);
 entry.label='topic status: 9 log / 1 lag';assert.match(state.elementRegistry['dag::block:topic::status']!.label!,/9 log/);
});
test('nested ask targets inherit parent removal and legend visibility, while remaining independently hideable',()=>{
 state.elementRegistry={};state.legendToggledOff=new Set();
 const parent=registerCompositePart('dag','none',view,[],[],'diagram');
 const block=registerCompositePart('dag::block','dag',view,[],[],'block');
 const child=registerCompositePart('dag::status','dag::block',view,[],[],'status');
 parent.hidden=true;assert.equal(child.hidden,true);
 parent.hidden=false;assert.equal(child.hidden,false);
 state.legendToggledOff.add('dag');assert.equal(child.hidden,true);
 state.legendToggledOff.clear();block.hidden=true;assert.equal(child.hidden,true);
 block.hidden=false;child.hidden=true;assert.equal(parent.hidden,false);assert.equal(block.hidden,false);assert.equal(child.hidden,true);
});
