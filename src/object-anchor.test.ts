import {test} from 'node:test';
import assert from 'node:assert/strict';
import {state} from '/state.js';
import {objectWorldAnchor,objectCellAnchor,objectWorldCorners,objectLabelElement,objectTargetExists} from './object-anchor.js';
class Vector {x:number;y:number;z:number;constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}}
class EmptyBounds {isEmpty(){return true;} expandByObject(){}}
Object.assign(globalThis,{THREE:{Vector3:Vector,Box3:EmptyBounds}});
test('object references prefer ids and reject ambiguous, missing and hidden names',()=>{
    state.currentRange=[[-1,1],[-1,1],[-1,1]];state.currentScale=[1,1,1];
    state.animatedElementPos={};state.legendToggledOff=new Set();
    state.elementRegistry={
        a:{hidden:false,label:'shared',tracker:{pointNodes:[{pivotPoints:[[.5,0,0]]}]}},
        b:{hidden:false,label:'shared',tracker:{pointNodes:[{pivotPoints:[[0,.5,0]]}]}}
    };
    assert.deepEqual(objectWorldAnchor('a'),new Vector(.5,0,0));
    assert.equal(objectWorldAnchor('shared'),null);assert.equal(objectWorldAnchor('missing'),null);
    state.elementRegistry.a!.hidden=true;assert.equal(objectWorldAnchor('a'),null);
    state.elementRegistry.a!.hidden=false;state.legendToggledOff.add('a');assert.equal(objectWorldAnchor('a'),null);
});
test('named targets follow live animated positions instead of stale anchors',()=>{
    state.currentRange=[[-1,1],[-1,1],[-1,1]];state.currentScale=[1,1,1];state.legendToggledOff=new Set();
    state.elementRegistry={a:{hidden:false,label:'moving',tracker:{labels:[{dataPos:[0,0,0]}]}}};
    state.animatedElementPos={a:{pos:[.25,.5,.75],time:0}};
    assert.deepEqual(objectWorldAnchor('moving'),new Vector(.25,.5,.75));
    state.animatedElementPos.a!.pos=[.5,.75,1];
    assert.deepEqual(objectWorldAnchor('moving'),new Vector(.5,.75,1));
});
test('cell references follow resized array bounds and never fall back to the whole object',()=>{
    let length=4;
    state.legendToggledOff=new Set();
    state.elementRegistry={array:{hidden:false,tracker:{planeMeshes:[{visible:true,userData:{arrayCellTarget:{at(index:number){
        return Number.isInteger(index)&&index>=0&&index<length?{position:[index*2,0,0],corners:[]}:null;
    }}}}]}}};
    assert.deepEqual(objectCellAnchor('array',3)?.position,[6,0,0]);
    length=3;assert.equal(objectCellAnchor('array',3),null);
    length=4;assert.deepEqual(objectCellAnchor('array',3)?.position,[6,0,0]);
    assert.equal(objectTargetExists('array'),true);
    length=0;assert.equal(objectTargetExists('array'),false);
    assert.equal(objectWorldAnchor('array'),null);
    length=4;assert.equal(objectTargetExists('array'),true);
    for(const index of [-1,4,NaN,1.5])assert.equal(objectCellAnchor('array',index),null);
    state.elementRegistry.array!.hidden=true;assert.equal(objectCellAnchor('array',0),null);
});
test('whole-object wires expose outer bounds while text-only targets expose their label',()=>{
    let expanded=0;
    class Bounds {
        min=new Vector(-2,-1,-.5);max=new Vector(2,1,.5);empty=true;
        expandByObject(){expanded++;this.empty=false;}isEmpty(){return this.empty;}
    }
    Object.assign(globalThis,{THREE:{Vector3:Vector,Box3:Bounds}});
    state.legendToggledOff=new Set();
    const el={isConnected:true} as HTMLElement;
    state.elementRegistry={
        mesh:{hidden:false,tracker:{planeMeshes:[{visible:true}, {visible:true,userData:{annotationTextPlane:true}}]}},
        text:{hidden:false,tracker:{labels:[{el}]}},
    };
    const corners=objectWorldCorners('mesh');
    assert.equal(corners.length,8);
    assert.equal(expanded,1); // A transparent raster text quad must not inflate the box.
    assert.deepEqual(corners[0],new Vector(-2,-1,-.5));
    assert.deepEqual(corners[7],new Vector(2,1,.5));
    assert.equal(objectLabelElement('text'),el);
    state.elementRegistry.mesh!.hidden=true;state.elementRegistry.text!.hidden=true;
    assert.deepEqual(objectWorldCorners('mesh'),[]);assert.equal(objectLabelElement('text'),null);
});

test('array titles and cell glyph children do not inflate whole-array wire bounds',()=>{
    let expanded=0,united=0,updated=0;
    const cellBounds={min:new Vector(-1,-.34,-.11),max:new Vector(1,.34,.11)};
    class Bounds {
        min=new Vector();max=new Vector();empty=true;
        expandByObject(){expanded++;}isEmpty(){return this.empty;}
        union(box:typeof cellBounds){united++;this.min=box.min;this.max=box.max;this.empty=false;}
    }
    Object.assign(globalThis,{THREE:{Vector3:Vector,Box3:Bounds}});
    state.legendToggledOff=new Set();
    state.elementRegistry={array:{hidden:false,tracker:{planeMeshes:[{
        visible:true,userData:{arrayCellTarget:{at:()=>({position:[0,0,0],corners:[]})}},geometry:{boundingBox:{clone:()=>({applyMatrix4:()=>cellBounds})},getAttribute:()=>undefined},
        matrixWorld:{},updateWorldMatrix(){updated++;}
    }]}}};
    const corners=objectWorldCorners('array');
    assert.equal(expanded,0);assert.equal(united,1);assert.equal(updated,1);
    assert.deepEqual(corners[0],cellBounds.min);assert.deepEqual(corners[7],cellBounds.max);
});
