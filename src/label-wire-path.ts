/** A gentle screen-space cubic; endpoints stay exact regardless of camera zoom. */
type Point={x:number;y:number};
function wireBend(start:Point,end:Point,departure?:Point,approach?:Point):number {
    const distance=Math.hypot(end.x-start.x,end.y-start.y);
    let bend=Math.min(120,distance*.45,Math.max(12,distance*.32));
    const dx=end.x-start.x,dy=end.y-start.y;
    // Facing ports in a narrow gap need short handles even with a large
    // vertical separation; otherwise the controls overshoot into both boxes.
    if(departure&&approach&&departure.y===0&&approach.y===0&&departure.x*dx>0&&approach.x*dx<0)bend=Math.min(bend,Math.abs(dx)*.45);
    if(departure&&approach&&departure.x===0&&approach.x===0&&departure.y*dy>0&&approach.y*dy<0)bend=Math.min(bend,Math.abs(dy)*.45);
    return bend;
}
/** The source leaves toward the object; the target's outward normal points back. */
export function wholeObjectWireAttachment(start:Point,centre:Point,corners:Point[]):{end:Point;approach:Point} {
    const left=Math.min(...corners.map(p=>p.x)),right=Math.max(...corners.map(p=>p.x));
    const top=Math.min(...corners.map(p=>p.y)),bottom=Math.max(...corners.map(p=>p.y));
    // Object anchors may be their origin; routing needs the centre of the outline.
    centre={x:(left+right)/2,y:(top+bottom)/2};
    const side=start.x<left?-1:start.x>right?1:0;
    const aim=side?{x:centre.x+side*1000,y:centre.y}:start;
    const approach=side?{x:side,y:0}:start.y>bottom?{x:0,y:1}:start.y<top?{x:0,y:-1}:{x:start.x-centre.x,y:start.y-centre.y};
    return {end:projectedCellEdge(aim,centre,corners,5,true),approach};
}
export function labelWirePath(start: Point, end: Point, approach?:Point, departure?:Point): string {
    const bend=wireBend(start,end,departure,approach);
    const direction=end.x>=start.x?1:-1;
    const length=approach?Math.hypot(approach.x,approach.y):0;
    const tangent=length?{x:approach!.x/length,y:approach!.y/length}:{x:-direction,y:0};
    return `M ${start.x} ${start.y} C ${start.x+(departure?.x??direction)*bend} ${start.y+(departure?.y??0)*bend}, ${end.x+tangent.x*bend} ${end.y+tangent.y*bend}, ${end.x} ${end.y}`;
}

export interface WireObstacle {left:number;top:number;right:number;bottom:number;padding?:number}
/** Keep the source tangent outward, then use a side gutter only if text blocks the direct curve. */
export function routedLabelWire(start:Point,end:Point,departure:Point,approach:Point,obstacles:WireObstacle[]):string {
    const bend=wireBend(start,end,departure,approach);
    const norm=Math.hypot(approach.x,approach.y)||1,unit={x:approach.x/norm,y:approach.y/norm};
    const control1={x:start.x+departure.x*bend,y:start.y+departure.y*bend};
    const control2={x:end.x+unit.x*bend,y:end.y+unit.y*bend};
    const collisions=(points:Point[])=>points.reduce((score,p)=>score+Number(obstacles.some(b=>{
        const padding=b.padding??6;
        return p.x>b.left-padding&&p.x<b.right+padding&&p.y>b.top-padding&&p.y<b.bottom+padding;
    })),0);
    const sample=(a:Point,b:Point,c:Point,d:Point)=>Array.from({length:39},(_,i)=>{
        const t=(i+1)/40,u=1-t;
        return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};
    });
    const cost=(points:Point[])=>{
        let length=0,previous=start;
        for(const p of [...points,end]){length+=Math.hypot(p.x-previous.x,p.y-previous.y);previous=p;}
        return collisions(points)*100000+length;
    };
    const direct=sample(start,control1,control2,end);
    let best=labelWirePath(start,end,unit,departure),score=cost(direct);
    if(!collisions(direct))return best;
    // Shorter handles often clear nearby labels without introducing a detour.
    for(const factor of [.65,.35]){
        const a={x:start.x+departure.x*bend*factor,y:start.y+departure.y*bend*factor};
        const b={x:end.x+unit.x*bend*factor,y:end.y+unit.y*bend*factor};
        const points=sample(start,a,b,end),candidate=cost(points);
        if(candidate<score){best=`M ${start.x} ${start.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${end.x} ${end.y}`;score=candidate;}
    }
    const relevant=obstacles.filter(b=>b.bottom>=Math.min(start.y,end.y)-32&&b.top<=Math.max(start.y,end.y)+32);
    for(const side of [Math.sign(departure.x)||1,-(Math.sign(departure.x)||1)]) for(const padding of [16,32,64]) {
        const gutter=side<0?Math.min(start.x,end.x,...relevant.map(b=>b.left))-padding:Math.max(start.x,end.x,...relevant.map(b=>b.right))+padding;
        const direction=Math.sign(end.y-start.y)||1;
        const waypoint={x:gutter,y:end.y+(Math.abs(unit.y)>.5?unit.y:-direction)*28};
        const handle=Math.min(24,Math.abs(gutter-start.x)/2);
        const a={x:start.x+departure.x*handle,y:start.y+departure.y*handle},b={x:gutter,y:start.y};
        const c={x:gutter,y:waypoint.y+direction*12},d={x:end.x+unit.x*24,y:end.y+unit.y*24};
        const candidateScore=cost([...sample(start,a,b,waypoint),...sample(waypoint,c,d,end)]);
        if(candidateScore<score){best=`M ${start.x} ${start.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${waypoint.x} ${waypoint.y} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${end.x} ${end.y}`;score=candidateScore;}
    }
    return best;
}

/** Intersect the centre-to-label ray with the convex projected cell silhouette.
 * A small screen-space gap keeps the endpoint off the box's edge and text. */
export function projectedCellEdge(start:Point,centre:Point,corners:Point[],gap=4,avoidIndex=false):Point {
    const points=corners.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const half=(values:Point[])=>{
        const hull:Point[]=[];
        for(const p of values){while(hull.length>=2&&cross(hull[hull.length-2]!,hull[hull.length-1]!,p)<=0)hull.pop();hull.push(p);}
        return hull.slice(0,-1);
    };
    const hull=[...half(points),...half(points.slice().reverse())];
    const ray={x:start.x-centre.x,y:start.y-centre.y};
    // Indices and object captions sit below the centre. Enter near a lower
    // corner when the variable is below, leaving that text column clear.
    if(avoidIndex && corners.length && start.y>Math.max(...corners.map(p=>p.y))) {
        ray.x=(start.x>=centre.x?1:-1)*(Math.max(...corners.map(p=>p.x))-Math.min(...corners.map(p=>p.x)))/2;
        ray.y=(Math.max(...corners.map(p=>p.y))-Math.min(...corners.map(p=>p.y)))/2;
    }
    const length=Math.hypot(ray.x,ray.y);
    if(!length||hull.length<3)return centre;
    let nearest=Infinity;
    for(let i=0;i<hull.length;i++){
        const a=hull[i]!,b=hull[(i+1)%hull.length]!,s={x:b.x-a.x,y:b.y-a.y};
        const denominator=ray.x*s.y-ray.y*s.x;
        if(Math.abs(denominator)<1e-8)continue;
        const dx=a.x-centre.x,dy=a.y-centre.y;
        const t=(dx*s.y-dy*s.x)/denominator,u=(dx*ray.y-dy*ray.x)/denominator;
        if(t>=0&&u>=0&&u<=1)nearest=Math.min(nearest,t);
    }
    return Number.isFinite(nearest)?{x:centre.x+ray.x*(nearest+gap/length),y:centre.y+ray.y*(nearest+gap/length)}:centre;
}

/**
 * A link between two rows of the same label box: a bracket that leaves one row
 * sideways, bows out past the box edge and returns to the other row. Its bow
 * grows with the distance between the rows so adjacent rows stay tight.
 */
export function rowBracketWire(edgeX:number,fromY:number,toY:number,side:1|-1):string {
    const bow=side*(10+Math.min(28,Math.abs(toY-fromY)*0.3));
    return `M ${edgeX} ${fromY} C ${edgeX+bow} ${fromY}, ${edgeX+bow} ${toY}, ${edgeX} ${toY}`;
}
