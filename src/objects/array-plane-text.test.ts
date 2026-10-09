import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';
import { state } from '/state.js';

class Attribute {
    array: Float32Array;needsUpdate=false;
    itemSize:number;
    constructor(values:number[]|Float32Array,itemSize:number){this.array=new Float32Array(values);this.itemSize=itemSize;}
    setXYZ(i:number,x:number,y:number,z:number){this.array.set([x,y,z],i*3);}
    getX(i:number){return this.array[i*3]!;}getY(i:number){return this.array[i*3+1]!;}getZ(i:number){return this.array[i*3+2]!;}
}
class Geometry {
    attributes:Record<string,Attribute>={};disposeCount=0;
    setAttribute(key:string,value:Attribute){this.attributes[key]=value;}
    getAttribute(key:string){return this.attributes[key]!;}
    computeBoundingSphere(){}dispose(){this.disposeCount++;}
}
class Texture {disposeCount=0;needsUpdate=false;canvas:unknown;constructor(canvas:unknown){this.canvas=canvas;}dispose(){this.disposeCount++;}}
class Material {
    listeners:(()=>void)[]=[];map:Texture;disposeCount=0;
    constructor(options:{map:Texture}){this.map=options.map;}
    addEventListener(_type:string,listener:()=>void){this.listeners.push(listener);}
    dispose(){this.disposeCount++;for(const listener of this.listeners)listener();}
}
class FakeMesh {
    userData:Record<string,unknown>={};removed=0;
    geometry:Geometry;material:Material;
    constructor(geometry:Geometry,material:Material){this.geometry=geometry;this.material=material;}
    removeFromParent(){this.removed++;}
}
class Vector {
    x=0;y=0;z=0;
    set(x:number,y:number,z=0){this.x=x;this.y=y;this.z=z;return this;}
    applyMatrix4(){return this;}
    project(camera:{zoom:number}){this.x*=camera.zoom;this.y*=camera.zoom;return this;}
}
let draws=0;
const context={font:'',fillStyle:'',textAlign:'',textBaseline:'',clearRect(){},
    measureText(text:string){return {width:text.length*parseFloat(this.font.match(/\d+px/)?.[0]??'1')*.6};},
    fillText(){draws++;}};
Object.assign(globalThis,{math:mathjs,window:globalThis,document:{createElement:()=>({width:0,height:0,getContext:()=>context})},
    THREE:{Vector2:Vector,Vector3:Vector,CanvasTexture:Texture,BufferGeometry:Geometry,Float32BufferAttribute:Attribute,MeshBasicMaterial:Material,Mesh:FakeMesh,LinearFilter:1,DoubleSide:2}});
const {createArrayPlaneText,clipArrayPlaneMirror,planeTextTextureSize}=await import('/objects/array-plane-text.js');

function init(){state.currentRange=[[-10,10],[-10,10],[-10,10]];state.currentScale=[1,1,1];}
test('array glyph vertices remain on the array face and move without repainting text',()=>{
    init();draws=0;const layer=createArrayPlaneText(4,2,'#ffffff');
    layer.set('n1:u1',[2,3,1]);
    const mesh=layer.mesh as unknown as FakeMesh;
    const vertices=mesh.geometry.getAttribute('position').array;
    assert.ok(Math.abs(vertices[0]!-0)<1e-6);
    assert.ok(Math.abs(vertices[1]!-.2)<1e-6);
    for(let i=2;i<vertices.length;i+=3)assert.ok(Math.abs(vertices[i]!-.1)<1e-6);
    assert.equal(draws,1);
    layer.set('n1:u1',[2,3,1]);assert.equal(draws,1);
    layer.set('n1:u1',[4,3,1]);assert.equal(draws,1);
    assert.ok(Math.abs(vertices[0]!-.2)<1e-6);
    layer.set('n1:u2',[4,3,1]);assert.equal(draws,2);
    layer.dispose();
});
test('array plane text caps texture dimensions and disposes each resource once',()=>{
    const layer=createArrayPlaneText(1000,10,'#ffffff');
    const mesh=layer.mesh as unknown as FakeMesh;
    const canvas=mesh.material.map.canvas as {width:number;height:number};
    assert.deepEqual([canvas.width,canvas.height],[2048,20]);
    layer.dispose();layer.dispose();
    assert.equal(mesh.geometry.disposeCount,1);assert.equal(mesh.material.disposeCount,1);
    assert.equal(mesh.material.map.disposeCount,1);assert.equal(mesh.removed,1);
});

test('native array accessibility mirrors remain clipped when step fades restore opacity',()=>{
    const mirror={textContent:'n1:u2#1',style:{opacity:'0'}};
    clipArrayPlaneMirror(mirror as unknown as HTMLElement);
    mirror.style.opacity='1'; // scene transitions restore all tracked label opacities
    assert.equal((mirror.style as unknown as Record<string,string>).clipPath,'inset(50%)');
    assert.equal((mirror.style as unknown as Record<string,string>).width,'1px');
    assert.equal((mirror.style as unknown as Record<string,string>).height,'1px');
    assert.equal(mirror.textContent,'n1:u2#1');
});

test('zoom redraws glyphs at projected pixel density without moving the text plane',()=>{
 init();draws=0;
 const layer=createArrayPlaneText(1,1,'#000000');layer.set('n1 @ publisher-1',[0,0,0]);
 const mesh=layer.mesh as unknown as FakeMesh,canvas=mesh.material.map.canvas as {width:number;height:number};
 const renderer={getDrawingBufferSize:(v:Vector)=>v.set(1000,1000)},camera={zoom:10};
 const vertices=Array.from(mesh.geometry.getAttribute('position').array);
 layer.prepare(renderer as never,camera as never);
 assert.ok(canvas.width>=512);assert.equal(canvas.width,canvas.height);assert.equal(draws,2);
 layer.prepare(renderer as never,camera as never);assert.equal(draws,2);
 assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array),vertices);
 camera.zoom=1;layer.prepare(renderer as never,camera as never);assert.equal(canvas.width,128);assert.equal(draws,3);
 layer.dispose();
});
test('text textures retain aspect ratio and a bounded texel budget at extreme zoom',()=>{
 const [w,h]=planeTextTextureSize(4,1,100000);
 assert.equal(w/h,4);assert.ok(w*h<=1048576);assert.ok(w<=2048&&h<=2048);
});
