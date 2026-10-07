import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';
import {state} from '/state.js';
Object.assign(globalThis,{math:mathjs,window:globalThis,THREE:{Color:class {}}});
const {renderPlane}=await import('/objects/plane.js');

test('rectangular panels grow on binding updates and avoid unchanged geometry writes',()=>{
    Object.assign(state,{sceneSliders:{count:{value:0}},activeAnimExprs:[]});
    let data:number[][]=[],writes=0;
    const matrix={surface(){},set(_key:string,next:number[][]){data=next;writes++;}};
    const view={matrix(options:{data:number[][]}){data=options.data;return matrix;}} as unknown as MathBoxNode;
    const panel=renderPlane({type:'plane',points:[[0,0,0],[2,0,0],['0','max(1,count)','0'],['2','max(1,count)','0']]},view);
    assert.equal(data[2]![1],1);
    const rebuild=panel._animExprEntry!._rebuildFn;
    rebuild();assert.equal(writes,0);
    state.sceneSliders.count!.value=3;rebuild();
    assert.equal(data[2]![1],3);assert.equal(data[0]![1],0);assert.equal(writes,1);
    rebuild();assert.equal(writes,1);
    state.sceneSliders.count!.value=0;rebuild();assert.equal(data[2]![1],1);
    panel._animState!.stopped=true;state.sceneSliders.count!.value=4;rebuild();
    assert.equal(data[2]![1],1);
});
