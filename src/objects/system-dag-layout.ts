/** Containment and placement are separate from directed message-flow edges. */
import type { SystemBlock, SystemConnection, SystemEndpoint } from '/types/lesson.js';
import type { Vec3 } from '/coords.js';

export interface SystemNode { spec:SystemBlock; parent?:string; position:Vec3; size:Vec3; }
export interface SystemWire { spec:SystemConnection; owner?:string; points:Vec3[]; }
export interface SystemLayout { nodes:Map<string,SystemNode>; wires:SystemWire[]; }
const NORMALS:Record<string,Vec3>={left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0],front:[0,0,1],back:[0,0,-1]};
const add=(a:Vec3,b:Vec3):Vec3=>a.map((v,i)=>v+b[i]!) as Vec3;
function vector(v:number[]|undefined,fallback:Vec3):Vec3 {
    const result=v??fallback;
    if(result.length!==3||result.some(n=>!Number.isFinite(n)))throw new Error('System diagram coordinates must contain three finite numbers.');
    return [...result] as Vec3;
}
export function simplifyPipe(points:Vec3[]):Vec3[] {
    const result:Vec3[]=[];
    for(const p of points){
        if(result.length&&p.every((v,i)=>Math.abs(v-result.at(-1)![i]!)<1e-8))continue;
        if(result.length>=2){
            const a=result.at(-2)!,b=result.at(-1)!;
            const u=b.map((v,i)=>v-a[i]!),v=p.map((n,i)=>n-b[i]!);
            const cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
            if(cross.every(n=>Math.abs(n)<1e-8)&&u.reduce((s,n,i)=>s+n*v[i]!,0)>0)result.pop();
        }
        result.push(p);
    }
    return result;
}
/** Arrowheads stay proportional to pipe radius, including short terminal segments. */
export function pipeArrowDimensions(radius:number,segmentLength:number){
    const length=Math.min(radius*7,segmentLength*.75);
    return {length,radius:Math.min(radius*3,length*.44)};
}
export function resolveSystemDAG(blocks:SystemBlock[],connections:SystemConnection[]=[],origin:Vec3=[0,0,0],defaultRadius=.055):SystemLayout {
    const nodes=new Map<string,SystemNode>(),wires:{spec:SystemConnection;owner?:string}[]=[],edgeIds=new Set<string>();
    function collect(list:SystemBlock[],parent?:string){
        for(const spec of list){
            if(nodes.has(spec.id))throw new Error(`Duplicate system block: ${spec.id}`);
            const size=vector(spec.size,[4,2,.16]);if(size.some(v=>v<=0))throw new Error(`System block ${spec.id} needs positive dimensions.`);
            const ports=new Set<string>();for(const port of spec.ports??[]){if(ports.has(port.id))throw new Error(`Duplicate port ${spec.id}.${port.id}`);ports.add(port.id);if(!NORMALS[port.side]||!Number.isFinite(port.offset??0)||Math.abs(port.offset??0)>1)throw new Error(`Invalid port ${spec.id}.${port.id}`);}
            nodes.set(spec.id,{spec,parent,size,position:[0,0,0]});collect(spec.blocks??[],spec.id);collectWires(spec.connections??[],spec.id);
        }
    }
    function collectWires(list:SystemConnection[],owner?:string){for(const spec of list){if(edgeIds.has(spec.id))throw new Error(`Duplicate connection: ${spec.id}`);edgeIds.add(spec.id);wires.push({spec,owner});}}
    collect(blocks);collectWires(connections);
    if(nodes.size>64||wires.length>128)throw new Error('System diagrams support up to 64 blocks and 128 connections.');
    const visiting=new Set<string>(),done=new Set<string>();
    function place(id:string):SystemNode {
        const node=nodes.get(id);if(!node)throw new Error(`Unknown system block: ${id}`);
        if(done.has(id))return node;if(visiting.has(id))throw new Error(`Cyclic system placement involving ${id}`);visiting.add(id);
        const s=node.spec;
        if(s.placement){
            const anchor=place(s.placement.relativeTo),normal=NORMALS[s.placement.side??'right']!;
            const gap=s.placement.gap??.7;if(!Number.isFinite(gap)||gap<0)throw new Error(`Invalid placement gap for ${id}`);
            node.position=add(anchor.position,normal.map((v,i)=>v*((anchor.size[i]!+node.size[i]!)/2+gap)) as Vec3);
            node.position=add(node.position,vector(s.placement.offset,[0,0,0]));
        }else {
            const parent=node.parent?place(node.parent):undefined;
            node.position=add(s.space==='world'?[0,0,0]:parent?parent.position:origin,vector(s.position,[0,0,0]));
            if(parent&&s.space!=='world'&&parent.spec.childElevation!==undefined){
                const gap=parent.spec.childElevation;
                if(!Number.isFinite(gap)||gap<0)throw new Error('System platform elevation must be finite and non-negative.');
                node.position[2]+=parent.size[2]/2+node.size[2]/2+gap;
            }
        }
        visiting.delete(id);done.add(id);return node;
    }
    for(const id of nodes.keys())place(id);
    for(const node of nodes.values())if(node.parent){const parent=nodes.get(node.parent)!;for(const i of [0,1])if(Math.abs(node.position[i]!-parent.position[i]!)+node.size[i]!/2>parent.size[i]!/2+1e-7)throw new Error(`Block ${node.spec.id} lies outside container ${node.parent}`);}
    function descendant(id:string,parent:string):boolean{let node=nodes.get(id);while(node?.parent){if(node.parent===parent)return true;node=nodes.get(node.parent);}return false;}
    function endpoint(e:SystemEndpoint,other:SystemEndpoint):{point:Vec3;normal:Vec3}{
        const node=nodes.get(e.block),target=nodes.get(other.block);if(!node||!target)throw new Error(`Unknown connection endpoint: ${!node?e.block:other.block}`);
        const port=e.port?node.spec.ports?.find(p=>p.id===e.port):undefined;if(e.port&&!port)throw new Error(`Unknown port ${e.block}.${e.port}`);
        const delta=target.position.map((v,i)=>v-node.position[i]!);
        const side=port?.side??e.side??(Math.abs(delta[0]!)>Math.abs(delta[1]!)?(delta[0]!>=0?'right':'left'):(delta[1]!>=0?'top':'bottom'));
        const normal=[...NORMALS[side]!] as Vec3;
        const point=add(node.position,normal.map((v,i)=>v*node.size[i]!/2) as Vec3);
        const along=normal[0]!==0?1:0;point[along]+=(port?.offset??0)*node.size[along]/2;
        if(normal[2]===0)point[2]=node.position[2]+node.size[2]/2+.06;
        if(e.inside??descendant(other.block,e.block))for(let i=0;i<3;i++)normal[i]=-normal[i]!;
        return {point,normal};
    }
    const resolved: SystemWire[]=wires.map(({spec,owner})=>{
        const a=endpoint(spec.from,spec.to),b=endpoint(spec.to,spec.from),radius=spec.radius??defaultRadius;
        if(!Number.isFinite(radius)||radius<=0||radius>.5)throw new Error(`Invalid pipe radius for ${spec.id}`);
        const lead=Math.max(.25,radius*5),start=add(a.point,a.normal.map(v=>v*lead) as Vec3),end=add(b.point,b.normal.map(v=>v*lead) as Vec3);
        let middle:Vec3[];
        if(spec.via?.length)middle=spec.via.map(v=>add(v.space==='world'?[0,0,0]:v.relativeTo?place(v.relativeTo).position:owner?place(owner).position:origin,vector(v.position,[0,0,0])));
        else if(spec.route==='straight')middle=[];
        else middle=routeOrthogonal(start,end,a.normal,b.normal,[...nodes.values()].filter(n=>!n.spec.blocks?.length&&n.spec.id!==spec.from.block&&n.spec.id!==spec.to.block),radius);
        const points=simplifyPipe(spec.route==='straight'&&!spec.via?.length?[a.point,b.point]:[a.point,start,...middle,end,b.point]);
        if(points.length<2)throw new Error(`Connection ${spec.id} has coincident endpoints.`);
        return {spec,owner,points};
    });
    return {nodes,wires:resolved};
}

/** Find an orthogonal route outside unrelated leaf blocks. Containers are boundaries, not obstacles. */
function routeOrthogonal(a:Vec3,b:Vec3,an:Vec3,bn:Vec3,nodes:SystemNode[],radius:number):Vec3[]{
    // Separate depth planes with a vertical riser, keeping every segment cylindrical.
    const z=Math.max(a[2],b[2]);
    const clearance=radius*3+.08;
    const boxes=nodes.map(n=>({x0:n.position[0]-n.size[0]/2-clearance,x1:n.position[0]+n.size[0]/2+clearance,y0:n.position[1]-n.size[1]/2-clearance,y1:n.position[1]+n.size[1]/2+clearance}));
    const blocked=(p:Vec3,q:Vec3)=>boxes.some(r=>p[0]===q[0]?p[0]>r.x0+1e-7&&p[0]<r.x1-1e-7&&Math.max(p[1],q[1])>r.y0+1e-7&&Math.min(p[1],q[1])<r.y1-1e-7:p[1]>r.y0+1e-7&&p[1]<r.y1-1e-7&&Math.max(p[0],q[0])>r.x0+1e-7&&Math.min(p[0],q[0])<r.x1-1e-7);
    const xs=[...new Set([a[0],b[0],...boxes.flatMap(r=>[r.x0,r.x1])])].sort((x,y)=>x-y),ys=[...new Set([a[1],b[1],...boxes.flatMap(r=>[r.y0,r.y1])])].sort((x,y)=>x-y);
    const start=[xs.indexOf(a[0]),ys.indexOf(a[1])],goal=[xs.indexOf(b[0]),ys.indexOf(b[1])];
    type Item={x:number;y:number;dir:number;cost:number;score:number;key:string};
    const queue:Item[]=[],cost=new Map<string,number>(),prev=new Map<string,string>();
    const point=(x:number,y:number):Vec3=>[xs[x]!,ys[y]!,z];
    const push=(v:Item)=>{queue.push(v);let i=queue.length-1;while(i>0){const p=(i-1)>>1;if(queue[p]!.score<=v.score)break;queue[i]=queue[p]!;i=p;}queue[i]=v;};
    const pop=()=>{const first=queue[0]!,last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1]!.score<queue[child]!.score)child++;if(queue[child]!.score>=last.score)break;queue[i]=queue[child]!;i=child;}queue[i]=last;}return first;};
    const initial:Item={x:start[0]!,y:start[1]!,dir:an[0]!==0?0:1,cost:0,score:0,key:`${start[0]},${start[1]},${an[0]!==0?0:1}`};push(initial);cost.set(initial.key,0);
    let last:string|undefined;
    while(queue.length){const item=pop();if(item.cost!==cost.get(item.key))continue;if(item.x===goal[0]&&item.y===goal[1]){last=item.key;break;}
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const x=item.x+dx!,y=item.y+dy!;if(x<0||x>=xs.length||y<0||y>=ys.length)continue;const p=point(item.x,item.y),q=point(x,y);if(blocked(p,q))continue;const dir=dx!==0?0:1,next=item.cost+Math.abs(q[0]-p[0])+Math.abs(q[1]-p[1])+(dir===item.dir?0:.2),key=`${x},${y},${dir}`;if(next>=(cost.get(key)??Infinity))continue;cost.set(key,next);prev.set(key,item.key);push({x,y,dir,cost:next,score:next+Math.abs(q[0]-b[0])+Math.abs(q[1]-b[1]),key});}
    }
    if(!last)throw new Error('No unobstructed pipe route; move blocks or supply via waypoints.');
    const path:Vec3[]=[];while(last){const [x,y]=last.split(',').map(Number);path.push(point(x!,y!));last=prev.get(last);}path.reverse();
    // The terminal normal is fixed by the final port lead, not the grid search.
    void bn;
    return simplifyPipe([[a[0],a[1],z],...path,[b[0],b[1],z]]);
}
