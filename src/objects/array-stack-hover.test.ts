import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackCellOpacities } from './array-stack-hover.js';

test('hover reveals a middle cell by fading only cells nearer the camera', () => {
    assert.deepEqual(stackCellOpacities([3,2,1,0],1),[1,1,0.2,0.2]);
    assert.deepEqual(stackCellOpacities([0,1,2,3],1),[0.2,1,1,1]);
});
test('coplanar cells and the selected cell stay opaque', () => {
    assert.deepEqual(stackCellOpacities([2,2,1],0),[1,1,0.2]);
});
test('leaving or resizing the stack restores every cell', () => {
    for (const index of [null,-1,3,0.5]) assert.deepEqual(stackCellOpacities([3,2,1],index),[1,1,1]);
    assert.deepEqual(stackCellOpacities([],null),[]);
});

test('shared hover picking ignores hidden stacks and cleans up on leave, drag and disposal', async () => {
    const { registerStackHover } = await import('./array-stack-hover.js');
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const globals = globalThis as unknown as {
        THREE: typeof THREE; requestAnimationFrame: typeof requestAnimationFrame; cancelAnimationFrame: typeof cancelAnimationFrame;
    };
    const saved = { THREE: globals.THREE, requestAnimationFrame: globals.requestAnimationFrame, cancelAnimationFrame: globals.cancelAnimationFrame };
    const selections: Array<[string, number | null]> = [];
    const meshA = {} as import('three').Mesh, meshB = {} as import('three').Mesh;
    globals.THREE = {
        Vector2: class { set() {} },
        Raycaster: class {
            setFromCamera() {}
            intersectObjects(objects: import('three').Mesh[]) { return objects.map(object => ({ object, faceIndex: 25 })); }
        },
    } as unknown as typeof THREE;
    globals.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    globals.cancelAnimationFrame = id => { frames.delete(id); };
    const target = new EventTarget() as HTMLElement;
    target.getBoundingClientRect = () => ({ left:0, top:0, width:100, height:100 }) as DOMRect;
    const move = (buttons=0) => target.dispatchEvent(Object.assign(new Event('pointermove'),{clientX:50,clientY:50,buttons}));
    const flush = () => { const callbacks=[...frames.values()]; frames.clear(); callbacks.forEach(callback=>callback(0)); };
    const camera = () => ({} as import('three').Camera);
    let disposeA: (() => void) | undefined, disposeB: (() => void) | undefined;
    try {
        disposeA=registerStackHover(target,camera,{mesh:meshA,visible:()=>false,select:index=>selections.push(['a',index])});
        disposeB=registerStackHover(target,camera,{mesh:meshB,visible:()=>true,select:index=>selections.push(['b',index])});
        move(); move(); assert.equal(frames.size,1); flush();
        assert.deepEqual(selections.splice(0),[['a',null],['b',2]]);
        move(); target.dispatchEvent(new Event('pointerleave')); assert.equal(frames.size,0);
        assert.deepEqual(selections.splice(0),[['a',null],['b',null]]);
        move(1); assert.equal(frames.size,0);
        assert.deepEqual(selections.splice(0),[['a',null],['b',null]]);
        target.dispatchEvent(new Event('pointerdown'));
        assert.deepEqual(selections.splice(0),[['a',null],['b',null]]);
        disposeA(); disposeA=undefined; disposeB(); disposeB=undefined; selections.length=0;
        move(); assert.equal(frames.size,0); assert.deepEqual(selections,[]);
    } finally {
        disposeA?.(); disposeB?.(); Object.assign(globals,saved);
    }
});
