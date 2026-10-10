import test from 'node:test';
import assert from 'node:assert/strict';
import { pipeFlowPath, pipeFlowPhase } from './system-dag-flow.js';

test('routed pipe progress spans bends continuously using arc length',()=>{
    const route=pipeFlowPath([[0,0,0],[3,0,0],[3,4,0],[3,4,2]]);
    assert.deepEqual(route,{length:9,offsets:[0,3,7,9]});
    assert.deepEqual(pipeFlowPath([[0,0,0],[0,0,0],[0,0,2]]),{length:2,offsets:[0,0,2]});
});
test('every connection completes a light cycle in one second regardless of route length',()=>{
    for(const route of [[[0,0,0],[1,0,0]],[[0,0,0],[30,0,0]]]) {
        const length=pipeFlowPath(route).length;
        assert.equal(pipeFlowPhase(250)*length,length*.25);
        assert.equal(pipeFlowPhase(500)*length,length*.5);
        assert.equal(pipeFlowPhase(1000),0);
        assert.equal(pipeFlowPhase(1250),.25);
    }
});
test('empty routes and invalid timestamps have stable finite progress',()=>{
    assert.equal(pipeFlowPath([]).length,0);
    for(const time of [Infinity,NaN])assert.equal(pipeFlowPhase(time),0);
    assert.equal(pipeFlowPhase(-250),.75);
});
