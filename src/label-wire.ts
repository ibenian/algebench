/** Hover wires are presentation only. Target expressions are evaluated by bindings. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { objectWorldAnchor, objectCellAnchor, objectWorldCorners, objectLabelElement, objectTargetExists } from '/object-anchor.js';
import { routedLabelWire, projectedCellEdge, wholeObjectWireAttachment } from '/label-wire-path.js';
import type { WireObstacle } from '/label-wire-path.js';
import type { Label3D } from '/labels.js';

interface WireRecord {
    label:Label3D;row:HTMLElement;hovered:boolean;
    button?:HTMLButtonElement;available?:boolean;
    svg:SVGSVGElement|null;path:SVGPathElement|null;dot:SVGCircleElement|null;
    previous:string;routeKey:string;routePath:string;
}
const wires=new Map<Label3D,WireRecord>();
export function wireRowHover(row:HTMLElement,label:Label3D):void {
    if(!label.wireTarget)return;
    let record=wires.get(label);
    if(record){record.row=row;record.hovered=false;}
    else {record={label,row,hovered:false,svg:null,path:null,dot:null,previous:'',routeKey:'',routePath:''};wires.set(label,record);}
    const wire=record;
    row.addEventListener('pointerenter',()=>{wire.hovered=true;});
    row.addEventListener('pointerleave',()=>{if(wire.row===row)wire.hovered=false;});
    const button=document.createElement('button');
    button.type='button';button.className='expression-wire-toggle';
    const paint=()=>{
        button.setAttribute('aria-pressed',String(!!label.wirePinned));
        button.setAttribute('aria-label',label.wirePinned?'Unpin connection':'Pin connection');
    };
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.stopPropagation();label.wirePinned=!label.wirePinned;paint();});
    paint();row.append(button);wire.button=button;wire.available=undefined;
}
export function updateLabelWire():void {
    for(const [label,wire] of wires){
        if(!label.el.isConnected){wire.svg?.remove();wires.delete(label);continue;}
        paintWire(wire);
    }
}
function paintWire(record:WireRecord):void {
    const hovered=record;
    let {svg,path,dot,previous,routeKey,routePath}=record;
    const camera=state.camera, canvas=state.renderer?.domElement;
    const target=record.label.wireTarget;
    const available=!!target&&(target.object?objectTargetExists(target.object,target.index):!!target.position);
    if(record.available!==available){
        record.available=available;
        if(record.button)record.button.style.display=available?'':'none';
    }
    if(!available){if(svg)svg.style.display='none';return;}
    if((!record.hovered&&!record.label.wirePinned)||!hovered.row.isConnected || hovered.label.forceHidden || hovered.label.visible===false || hovered.label.el.style.display==='none' || !camera || !canvas) {
        if(svg)svg.style.display='none';
        return;
    }
    if(hovered.label.annotationDragging){if(svg)svg.style.display='none';return;}
    const cell=target?.object&&target.index!==undefined?objectCellAnchor(target.object,target.index):null;
    const world=target?.index!==undefined ? cell?new THREE.Vector3(...dataToWorld(cell.position)):null : target?.position ? new THREE.Vector3(...dataToWorld(target.position)) : target?.object ? objectWorldAnchor(target.object) : null;
    if(!world){if(svg)svg.style.display='none';return;}
    const projected=world.project(camera);
    if(projected.z < -1 || projected.z>=1){if(svg)svg.style.display='none';return;}
    const container=document.getElementById('labels-container');
    if(!container)return;
    if(!svg?.isConnected){
        svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.classList.add('label-hover-wire');svg.setAttribute('aria-hidden','true');
        Object.assign(svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',overflow:'visible',pointerEvents:'none',zIndex:'2147483647'});
        path=document.createElementNS(svg.namespaceURI,'path') as SVGPathElement;
        path.setAttribute('fill','none');path.setAttribute('stroke','#a6d5ec');path.setAttribute('stroke-opacity','.65');path.setAttribute('stroke-width','1.5');path.setAttribute('stroke-linecap','round');
        dot=document.createElementNS(svg.namespaceURI,'circle') as SVGCircleElement;
        dot.setAttribute('r','2');dot.setAttribute('fill','#bce8ff');
        svg.append(path,dot);container.append(svg);previous='';routeKey='';
        record.svg=svg;record.path=path;record.dot=dot;
    }
    const rect=container.getBoundingClientRect(),viewport=canvas.getBoundingClientRect(),row=hovered.row.getBoundingClientRect();
    const screen=(p:{x:number;y:number})=>({x:viewport.left-rect.left+(p.x*.5+.5)*viewport.width,y:viewport.top-rect.top+(-p.y*.5+.5)*viewport.height});
    const centre=screen(projected);
    const box=hovered.row.closest('.annotation-badge')?.getBoundingClientRect()??row;
    let left=centre.x<(box.left+box.right)/2-rect.left;
    const start={x:(left?box.left:box.right)-rect.left,y:(row.top+row.bottom)/2-rect.top};
    let corners=cell?.corners.map(p=>screen(new THREE.Vector3(...dataToWorld(p as [number,number,number])).project(camera)));
    if(!cell && target?.object && target.index===undefined) {
        corners=objectWorldCorners(target.object).map(p=>screen(p.project(camera)));
        if(!corners.length){
            const labelBox=objectLabelElement(target.object)?.getBoundingClientRect();
            if(labelBox)corners=[labelBox.left,labelBox.right].flatMap(x=>[labelBox.top,labelBox.bottom].map(y=>({x:x-rect.left,y:y-rect.top})));
        }
    }
    const hasOutline=!!corners?.length;
    const belowCell=hasOutline&&start.y>Math.max(...corners!.map(p=>p.y));
    const departure={x:left?-1:1,y:0};
    // Whole-object connections meet an outer side, rather than the gap between cells.
    const attachment=!cell&&hasOutline?wholeObjectWireAttachment({x:(box.left+box.right)/2-rect.left,y:start.y},centre,corners!):null;
    const end=attachment?.end??(hasOutline?projectedCellEdge(start,centre,corners!,5,!!cell):centre);
    if(attachment){
        left=end.x<(box.left+box.right)/2-rect.left;
        departure.x=left?-1:1;
        start.x=(left?box.left:box.right)-rect.left;
    }
    const approach=attachment?.approach??(belowCell?{x:0,y:1}:{x:start.x-centre.x,y:start.y-centre.y});
    const obstacles:WireObstacle[]=state.labels.filter(label=>label.visible&&!label.annotationHidden&&label.el.style.display!=='none'&&label.el.isConnected&&!label.el.contains(hovered!.row)).map(label=>{
        const b=label.el.getBoundingClientRect();return {left:b.left-rect.left,top:b.top-rect.top,right:b.right-rect.left,bottom:b.bottom-rect.top};
    });
    // The source container is also an obstacle: the wire must never curl through its rows.
    obstacles.push({left:box.left-rect.left,top:box.top-rect.top,right:box.right-rect.left,bottom:box.bottom-rect.top,padding:0});
    // Target geometry is an obstacle too: text-only avoidance allowed a long
    // fallback curve to cut through the cells between their value labels.
    if(hasOutline)obstacles.push({left:Math.min(...corners!.map(p=>p.x)),right:Math.max(...corners!.map(p=>p.x)),top:Math.min(...corners!.map(p=>p.y)),bottom:Math.max(...corners!.map(p=>p.y)),padding:0});
    const key=JSON.stringify([start,end,departure,approach,obstacles]);
    if(key!==routeKey){routeKey=key;routePath=routedLabelWire(start,end,departure,approach,obstacles);record.routeKey=routeKey;record.routePath=routePath;}
    const d=routePath;
    svg.style.display='';
    if(d!==previous){path!.setAttribute('d',d);dot!.setAttribute('cx',String(end.x));dot!.setAttribute('cy',String(end.y));record.previous=d;}
}
