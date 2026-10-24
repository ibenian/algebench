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

type Pt={x:number;y:number};
/** The control point an end pulls toward: out along its cell's axis, further for a longer link. */
function linkPull(axis:'v'|'h',from:Pt,to:Pt):Pt {
    // Along the end's own axis, by its share of the gap; when the other end lies mostly across that axis (a link
    // rising from below into a stacked cell's side), at least a stub scaled by the whole gap, so the curve swings
    // out and arrives level instead of hooking in at the last pixels under a crooked arrowhead.
    const d=axis==='v'?to.y-from.y:to.x-from.x, across=axis==='v'?to.x-from.x:to.y-from.y;
    const bend=Math.max(8,Math.abs(d)*.45,Math.min(48,Math.abs(across)*.3))*(d<0?-1:1);
    return axis==='v'?{x:from.x,y:from.y+bend}:{x:from.x+bend,y:from.y};
}
/**
 * A cell-to-cell link between two arrays: each end leaves its cell along the cell's own axis, vertically
 * ('v', off a top or bottom edge of a horizontal row) or horizontally ('h', off the side of a stacked cell).
 * `arrive` is the last control point, the direction the curve enters its target (for an arrowhead).
 */
export function cellLinkCurve(start:Pt,end:Pt,startAxis:'v'|'h'='v',endAxis:'v'|'h'='v'):{d:string;arrive:Pt} {
    const c1=linkPull(startAxis,start,end),c2=linkPull(endAxis,end,start);
    return {d:`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,arrive:c2};
}
export function cellLinkPath(start:Pt,end:Pt,startAxis:'v'|'h'='v',endAxis:'v'|'h'='v'):string {
    return cellLinkCurve(start,end,startAxis,endAxis).d;
}
/**
 * A link between two cells of the same array: an arch that leaves and lands on the same side of the row
 * ('up' / 'down' for a row, 'left' / 'right' for a stack), rising with the distance it spans, so it never
 * crosses the cells in between. Start and end on one cell make a small loop.
 */
export function cellArcCurve(start:Pt,end:Pt,side:'up'|'down'|'left'|'right'):{d:string;arrive:Pt} {
    const span=Math.hypot(end.x-start.x,end.y-start.y),h=Math.max(18,span*.32);
    const [dx,dy]=side==='up'?[0,-h]:side==='down'?[0,h]:side==='left'?[-h,0]:[h,0];
    const c1={x:start.x+dx,y:start.y+dy},c2={x:end.x+dx,y:end.y+dy};
    return {d:`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,arrive:c2};
}
/**
 * A graph edge between two nodes: from the edge of one node's box (or disc, `round`) to the other's, bowing by
 * `bend` of its length to the side away from `centre` (so the two directions of a pair, and edges around a loop,
 * curve apart). A node linked to itself gets a small loop over its top.
 */
export function graphEdgeCurve(a:{centre:Pt;hw:number;hh:number;round?:boolean;poly?:Pt[]},b:{centre:Pt;hw:number;hh:number;round?:boolean;poly?:Pt[]},bend:number,centre:Pt):{d:string;arrive:Pt;end:Pt} {
    const boundary=(n:typeof a,toward:Pt):Pt=>{
        const dx=toward.x-n.centre.x,dy=toward.y-n.centre.y,len=Math.hypot(dx,dy)||1;
        if(n.round){const r=Math.min(n.hw,n.hh)+2;return {x:n.centre.x+dx/len*r,y:n.centre.y+dy/len*r};}
        // The node's face as drawn (its projected corners, in order): exact under any rotation, where the upright
        // box around them would reach into the neighbours and stretch the edge across them.
        if(n.poly&&n.poly.length>=3){const t=rayExit(n.centre,{x:dx/len,y:dy/len},n.poly);if(t!==null)return {x:n.centre.x+dx/len*(t+2),y:n.centre.y+dy/len*(t+2)};}
        const t=Math.min(Math.abs(dx)>1e-6?(n.hw+2)/Math.abs(dx):Infinity,Math.abs(dy)>1e-6?(n.hh+2)/Math.abs(dy):Infinity);
        return {x:n.centre.x+dx*t,y:n.centre.y+dy*t};
    };
    if(Math.hypot(b.centre.x-a.centre.x,b.centre.y-a.centre.y)<1){   // a self-loop over the node
        const top=a.centre.y-a.hh-2,w=Math.max(6,a.hw*.6),h=Math.max(22,a.hh*2.2);
        const s={x:a.centre.x-w,y:top},e={x:a.centre.x+w,y:top},c1={x:a.centre.x-w*2.2,y:top-h},c2={x:a.centre.x+w*2.2,y:top-h};
        return {d:`M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`,arrive:c2,end:e};
    }
    const mid={x:(a.centre.x+b.centre.x)/2,y:(a.centre.y+b.centre.y)/2};
    const dx=b.centre.x-a.centre.x,dy=b.centre.y-a.centre.y,len=Math.hypot(dx,dy);
    let px=-dy/len,py=dx/len;
    if((mid.x-centre.x)*px+(mid.y-centre.y)*py<0){px=-px;py=-py;}
    const control={x:mid.x+px*bend*len,y:mid.y+py*bend*len};
    const s=boundary(a,control),e=boundary(b,control);
    // The head points from `arrive` to the tip. Close nodes (or a zoomed-out view, where the 2 px margin dominates)
    // can put the tip past the control point, which would turn the head round; then it follows the edge itself.
    const ux=dx/len,uy=dy/len,behind=(e.x-control.x)*ux+(e.y-control.y)*uy>1;
    return {d:`M ${s.x} ${s.y} Q ${control.x} ${control.y}, ${e.x} ${e.y}`,arrive:behind?control:{x:e.x-ux*10,y:e.y-uy*10},end:e};
}
/** Distance from `from` (inside the polygon) along the unit direction `dir` to where the ray leaves it, or null. */
export function rayExit(from:Pt,dir:Pt,poly:readonly Pt[]):number|null {
    let best:number|null=null;
    for(let i=0;i<poly.length;i++){
        const p=poly[i]!,q=poly[(i+1)%poly.length]!,ex=q.x-p.x,ey=q.y-p.y,den=dir.x*ey-dir.y*ex;
        if(Math.abs(den)<1e-9)continue;
        const t=((p.x-from.x)*ey-(p.y-from.y)*ex)/den,u=((p.x-from.x)*dir.y-(p.y-from.y)*dir.x)/den;
        if(t>=0&&u>=-1e-9&&u<=1+1e-9&&(best===null||t<best))best=t;
    }
    return best;
}
/**
 * A graph edge drawn as an arc of the circle around `centre` that passes through the source node: from node to
 * node the short way round (clockwise on a tie), trimmed where it enters each node, so a loop of nodes on a
 * circle reads as one round loop. `arrive` sits on the circle just before the end, for the arrowhead.
 */
export function graphArcCurve(a:{centre:Pt;hw:number;hh:number},b:{centre:Pt;hw:number;hh:number},centre:Pt):{d:string;arrive:Pt;end:Pt} {
    const r=Math.hypot(a.centre.x-centre.x,a.centre.y-centre.y)||1;
    const ta=Math.atan2(a.centre.y-centre.y,a.centre.x-centre.x),tb=Math.atan2(b.centre.y-centre.y,b.centre.x-centre.x);
    let d=tb-ta; while(d<=-Math.PI)d+=2*Math.PI; while(d>Math.PI)d-=2*Math.PI;
    if(Math.abs(d)<1e-6)d=2*Math.PI;   // the same node: once round
    const sign=d>0?1:-1;
    const trim=(n:{hw:number;hh:number})=>(Math.min(n.hw,n.hh)+3)/r;
    const s0=ta+sign*trim(a),s1=ta+d-sign*trim(b);
    const at=(t:number):Pt=>({x:centre.x+Math.cos(t)*r,y:centre.y+Math.sin(t)*r});
    const s=at(s0),e=at(s1),span=Math.abs(s1-s0);
    const large=span>Math.PI?1:0,sweep=sign>0?1:0;
    return {d:`M ${s.x} ${s.y} A ${r} ${r} 0 ${large} ${sweep} ${e.x} ${e.y}`,arrive:at(s1-sign*.2),end:e};
}
/** A filled arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowHeadPath(tip:Pt,from:Pt,size=6):string {
    const len=Math.hypot(tip.x-from.x,tip.y-from.y)||1,ux=(tip.x-from.x)/len,uy=(tip.y-from.y)/len;
    const bx=tip.x-ux*size,by=tip.y-uy*size,w=size*.55;
    const r=(n:number)=>Math.round(n*100)/100;
    return `M ${r(tip.x)} ${r(tip.y)} L ${r(bx-uy*w)} ${r(by+ux*w)} L ${r(bx+uy*w)} ${r(by-ux*w)} Z`;
}
