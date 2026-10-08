import {test} from 'node:test';
import assert from 'node:assert/strict';
import {state} from '/state.js';
import {wireRowHover,updateLabelWire} from './label-wire.js';
import type {Label3D} from '/labels.js';

class Element {
    isConnected=true; namespaceURI='http://www.w3.org/2000/svg';
    style:Record<string,string>={};attributes:Record<string,string>={};children:Element[]=[];
    classList={add(){}};events:Record<string,(event?:{stopPropagation():void})=>void>={};
    addEventListener(name:string,handler:(event?:{stopPropagation():void})=>void){this.events[name]=handler;}
    setAttribute(name:string,value:string){this.attributes[name]=value;}
    append(...children:Element[]){this.children.push(...children);}
    remove(){this.isConnected=false;}
    closest(){return null;}
    getBoundingClientRect(){return {left:100,top:100,right:200,bottom:120,width:100,height:20};}
}
test('hover wire works for a hidden merged member, hides during drag, and clears on leave',()=>{
    const container=new Element();
    container.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:300,width:400,height:300});
    Object.assign(globalThis,{
        document:{getElementById:()=>container,createElementNS:()=>new Element(),createElement:()=>new Element()},
        THREE:{Vector3:class {project(){return {x:.5,y:0,z:0};}}}
    });
    Object.assign(state,{camera:{},renderer:{domElement:container},currentRange:[[-1,1],[-1,1],[-1,1]],currentScale:[1,1,1]});
    const row=new Element();
    const label={el:new Element(),wireTarget:{position:[0,0,0]},annotationHidden:true,annotationCoordinateMode:'screen'} as unknown as Label3D;
    wireRowHover(row as unknown as HTMLElement,label);
    updateLabelWire();assert.equal(container.children.length,0);
    row.events.pointerenter!();updateLabelWire();
    const svg=container.children[0]!;
    assert.equal(svg.style.display,'');
    assert.match(svg.children[0]!.attributes.d!,/^M 200 110 C .*300 150$/);
    assert.equal(svg.style.pointerEvents,'none');
    label.annotationDragging=true;updateLabelWire();assert.equal(svg.style.display,'none');
    label.annotationDragging=false;updateLabelWire();assert.equal(svg.style.display,'');
    row.events.pointerleave!();updateLabelWire();assert.equal(svg.style.display,'none');
    row.events.pointerenter!();row.isConnected=false;updateLabelWire();assert.equal(svg.style.display,'none');
    Object.assign(label.el,{isConnected:false});updateLabelWire();
});
test('each dot pins its own wire, survives regrouping, and toggles back to hover-only',()=>{
    const container=new Element();
    container.getBoundingClientRect=()=>({left:0,top:0,right:400,bottom:300,width:400,height:300});
    Object.assign(globalThis,{
        document:{getElementById:()=>container,createElementNS:()=>new Element(),createElement:()=>new Element()},
        THREE:{Vector3:class {project(){return {x:.5,y:0,z:0};}}}
    });
    Object.assign(state,{camera:{},renderer:{domElement:container},labels:[],currentRange:[[-1,1],[-1,1],[-1,1]],currentScale:[1,1,1]});
    const row=new Element(),label={el:new Element(),wireTarget:{position:[0,0,0]}} as unknown as Label3D;
    wireRowHover(row as unknown as HTMLElement,label);
    const button=row.children[0]!;
    assert.equal(button.attributes['aria-pressed'],'false');
    let stopped=false;button.events.click!({stopPropagation(){stopped=true;}});
    assert.equal(stopped,true);assert.equal(button.attributes['aria-pressed'],'true');
    updateLabelWire();const first=container.children[0]!;assert.equal(first.style.display,'');
    row.events.pointerleave!();updateLabelWire();assert.equal(first.style.display,'');
    row.isConnected=false;
    const replacement=new Element();wireRowHover(replacement as unknown as HTMLElement,label);
    assert.equal(replacement.children[0]!.attributes['aria-pressed'],'true');
    updateLabelWire();assert.equal(first.style.display,'');
    const secondLabel={el:new Element(),wireTarget:{position:[0,0,0]},wirePinned:true} as unknown as Label3D;
    wireRowHover(new Element() as unknown as HTMLElement,secondLabel);updateLabelWire();
    assert.equal(container.children.length,2);assert.equal(container.children[1]!.style.display,'');
    replacement.children[0]!.events.click!({stopPropagation(){}});updateLabelWire();
    assert.equal(first.style.display,'none');assert.equal(container.children[1]!.style.display,'');
    secondLabel.forceHidden=true;updateLabelWire();assert.equal(container.children[1]!.style.display,'none');
    label.wireTarget={object:'missing'};label.wirePinned=true;updateLabelWire();
    assert.equal(first.style.display,'none');assert.equal(replacement.children[0]!.style.display,'none');
    label.wireTarget={position:[0,0,0]};updateLabelWire();
    assert.equal(first.style.display,'');assert.equal(replacement.children[0]!.style.display,'');
    Object.assign(label.el,{isConnected:false});Object.assign(secondLabel.el,{isConnected:false});updateLabelWire();
});
