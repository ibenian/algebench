import {test} from 'node:test';
import assert from 'node:assert/strict';
import {labelWirePath,projectedCellEdge,routedLabelWire,wholeObjectWireAttachment,rowBracketWire} from './label-wire-path.js';
test('whole-object wires meet the facing edge without doubling back through the object',()=>{
    const corners=[{x:100,y:80},{x:400,y:80},{x:400,y:120},{x:100,y:120}];
    const right=wholeObjectWireAttachment({x:500,y:100},{x:250,y:100},corners);
    assert.equal(right.end.x,405);assert.equal(right.end.y,100);assert.equal(right.approach.x,1);
    assert.deepEqual(wholeObjectWireAttachment({x:500,y:100},{x:100,y:80},corners),right);
    const path=routedLabelWire({x:500,y:100},right.end,{x:-1,y:0},right.approach,[]);
    const xs=path.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_,i)=>i%2===0);
    assert.ok(xs.every(x=>x>=405&&x<=500));
    const left=wholeObjectWireAttachment({x:0,y:100},{x:250,y:100},corners);
    assert.equal(left.end.x,95);assert.equal(left.approach.x,-1);
    const below=wholeObjectWireAttachment({x:260,y:200},{x:250,y:100},corners);
    assert.ok(below.end.x>400&&below.end.y>120);assert.equal(below.approach.y,1);
});
test('hover wires curve in the target direction and retain exact endpoints',()=>{
    assert.equal(labelWirePath({x:10,y:20},{x:110,y:20}),'M 10 20 C 42 20, 78 20, 110 20');
    assert.equal(labelWirePath({x:110,y:20},{x:10,y:20}),'M 110 20 C 78 20, 42 20, 10 20');
    const vertical=labelWirePath({x:10,y:0},{x:10,y:100});
    assert.equal(vertical,'M 10 0 C 42 0, -22 100, 10 100');
});
test('wire curvature is bounded for near and far endpoints',()=>{
    assert.equal(labelWirePath({x:0,y:0},{x:1,y:0}),'M 0 0 C 0.45 0, 0.55 0, 1 0');
    assert.equal(labelWirePath({x:0,y:0},{x:1000,y:0}),'M 0 0 C 120 0, 880 0, 1000 0');
});
test('facing ports in a narrow horizontal gap never overshoot their boxes',()=>{
    const d=labelWirePath({x:110,y:180},{x:100,y:100},{x:1,y:0},{x:-1,y:0});
    assert.equal(d,'M 110 180 C 105.5 180, 104.5 100, 100 100');
});
test('cell wires stop outside the projected box instead of crossing its value',()=>{
    const corners=[{x:-10,y:-5},{x:10,y:-5},{x:10,y:5},{x:-10,y:5}];
    const right=projectedCellEdge({x:100,y:0},{x:0,y:0},corners);
    assert.ok(Math.abs(right.x-14)<1e-9);assert.equal(right.y,0);
    const bottom=projectedCellEdge({x:0,y:100},{x:0,y:0},corners);
    assert.equal(bottom.x,0);assert.ok(Math.abs(bottom.y-9)<1e-9);
    const diamond=[{x:0,y:-20},{x:20,y:0},{x:0,y:20},{x:-20,y:0}];
    const edge=projectedCellEdge({x:100,y:100},{x:0,y:0},diamond);
    assert.ok(Math.abs(edge.x-(10+4/Math.sqrt(2)))<1e-9);
    assert.equal(edge.x,edge.y);
    const scaled=projectedCellEdge({x:100,y:0},{x:0,y:0},corners.map(p=>({x:p.x*2,y:p.y*2})));
    assert.ok(Math.abs(scaled.x-24)<1e-9); // The clearance stays four pixels after zooming.
    const indexClear=projectedCellEdge({x:-1,y:100},{x:0,y:0},corners,4,true);
    assert.ok(indexClear.x < -10 && indexClear.y > 5); // Outside the lower corner, away from the centred index.
});
test('wire leaves the label outward even when its destination is on the other side',()=>{
    const d=labelWirePath({x:100,y:20},{x:200,y:120},{x:0,y:-1},{x:-1,y:0});
    const firstControl=Number(d.match(/^M \S+ \S+ C (\S+)/)![1]);
    assert.ok(firstControl<100);
});
test('a title across the direct curve causes routing through a clear side gutter',()=>{
    const start={x:100,y:0},end={x:100,y:200};
    const d=routedLabelWire(start,end,{x:-1,y:0},{x:-1,y:0},[{left:40,right:160,top:70,bottom:130}]);
    assert.equal((d.match(/ C /g)??[]).length,2);
    // Route waypoints sit left of the title, while source and target stay exact.
    const coordinates=d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    assert.ok(coordinates[6]!<34); // Gutter clears the left edge plus six-pixel text padding.
    assert.ok(d.startsWith('M 100 0 C '));assert.ok(d.endsWith('100 200'));
});
test('fallback routing cannot cut across an array footprint to reach its far side',()=>{
    const d=routedLabelWire({x:800,y:550},{x:125,y:355},{x:1,y:0},{x:-1,y:0},[{left:135,right:1450,top:310,bottom:400,padding:0}]);
    const values=d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    let a={x:values[0]!,y:values[1]!};
    for(let k=2;k<values.length;k+=6){
        const b={x:values[k]!,y:values[k+1]!},c={x:values[k+2]!,y:values[k+3]!},end={x:values[k+4]!,y:values[k+5]!};
        for(let i=1;i<100;i++){
            const t=i/100,u=1-t;
            const x=u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*end.x;
            const y=u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*end.y;
            assert.ok(!(x>135&&x<1450&&y>310&&y<400),`wire crossed array at ${x}, ${y}`);
        }
        a=end;
    }
});
test('connections stay outside source and target boxes from every direction and zoom',()=>{
    for(const zoom of [.5,1,2])for(const source of [{x:0,y:100},{x:500,y:100},{x:250,y:0},{x:250,y:220},{x:0,y:0},{x:500,y:220}]){
        const target={left:100*zoom,right:400*zoom,top:80*zoom,bottom:120*zoom,padding:0};
        const box={left:(source.x-30)*zoom,right:(source.x+30)*zoom,top:(source.y-15)*zoom,bottom:(source.y+15)*zoom,padding:0};
        const corners=[{x:target.left,y:target.top},{x:target.right,y:target.top},{x:target.right,y:target.bottom},{x:target.left,y:target.bottom}];
        const attachment=wholeObjectWireAttachment({x:source.x*zoom,y:source.y*zoom},{x:100*zoom,y:100*zoom},corners);
        const direction=attachment.end.x<source.x*zoom?-1:1;
        const start={x:direction<0?box.left:box.right,y:source.y*zoom};
        const d=routedLabelWire(start,attachment.end,{x:direction,y:0},attachment.approach,[box,target]);
        assert.ok(d.startsWith(`M ${start.x} ${start.y} C `));
        const values=d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        let a=start;
        for(let k=2;k<values.length;k+=6){
            const b={x:values[k]!,y:values[k+1]!},c={x:values[k+2]!,y:values[k+3]!},end={x:values[k+4]!,y:values[k+5]!};
            for(let i=1;i<100;i++){
                const t=i/100,u=1-t;
                const x=u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*end.x;
                const y=u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*end.y;
                for(const obstacle of [box,target])assert.ok(!(x>obstacle.left&&x<obstacle.right&&y>obstacle.top&&y<obstacle.bottom),`crossing at zoom ${zoom}, source ${JSON.stringify(source)}`);
            }
            a=end;
        }
    }
});

test('a row-to-row bracket leaves and returns at the box edge, bowing outward more for distant rows', () => {
    const near = rowBracketWire(100, 10, 30, 1), far = rowBracketWire(100, 10, 130, 1);
    assert.match(near, /^M 100 10 C /); assert.match(near, /, 100 30$/);
    const bow = (d: string) => Number(d.split(' ')[4]) - 100;
    assert.ok(bow(near) > 0 && bow(far) > bow(near), 'bows outward, further for distant rows');
    assert.ok(bow(rowBracketWire(100, 0, 1000, 1)) <= 38, 'the bow is capped');
    assert.ok(bow(rowBracketWire(100, 10, 30, -1)) < 0, 'side -1 bows left');
});
