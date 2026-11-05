import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkExitAnimation} from './link-exit.js';

test('a link just goes by default, even with a time given',()=>{
    assert.equal(linkExitAnimation(),null);
    assert.equal(linkExitAnimation(undefined,500),null);
});

test('a flicker ends dark and lasts a varying time',()=>{
    for(let k=0;k<20;k++){
        const a=linkExitAnimation('flicker')!;
        assert.ok(a.ms>=450&&a.ms<=950);
        assert.equal(a.frames.at(-1)!.opacity,0);
        const offsets=a.frames.map(f=>f.offset as number);
        assert.deepEqual(offsets,[...offsets].sort((x,y)=>x-y),'keyframes stay in order');
    }
});

test('exitMs sets how long the flicker or fade takes',()=>{
    assert.equal(linkExitAnimation('flicker',200)!.ms,200);
    assert.equal(linkExitAnimation('fade',800)!.ms,800);
    assert.deepEqual(linkExitAnimation('fade')!.frames,[{opacity:1},{opacity:0}]);
});

test('none, or no time at all, means the link just goes',()=>{
    assert.equal(linkExitAnimation('none'),null);
    assert.equal(linkExitAnimation('none',500),null);
    assert.equal(linkExitAnimation('flicker',0),null);
    assert.equal(linkExitAnimation('fade',0),null);
});
