/** Reusable system blocks and directed cylindrical pipes; no simulation rules. */
import { registerCompositePart } from '/objects/composite-parts.js';
import { state } from '/state.js';
import { renderElement } from '/objects/index.js';
import { dataToWorld, dataLenToWorld, withDataOffset, currentDataOffset } from '/coords.js';
import type { Vec3 } from '/coords.js';
import { parseColor, addLabel3D } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr, registerAnimUpdater, unregisterAnimExpr, unregisterAnimUpdater } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import { createArrayPlaneText, clipArrayPlaneMirror } from '/objects/array-plane-text.js';
import type { ArrayPlaneText } from '/objects/array-plane-text.js';
import { pipeFlowPath, pipeFlowPhase } from '/objects/system-dag-flow.js';
import { resolveSystemDAG, pipeArrowDimensions } from '/objects/system-dag-layout.js';
import type { Element, Color } from '/types/lesson.js';
import type { BufferGeometry, Material, Mesh, MeshBasicMaterial, MeshPhongMaterial, ShaderMaterial } from 'three';

const PALETTE={group:'#8fa8be',service:'#80b9d6',database:'#80b9d6',broker:'#80b9d6',processor:'#b9a1dd',worker:'#e7be63',gateway:'#7ac9b7',client:'#7ac9b7',store:'#b9a1dd'};
export function renderSystemDAG(el:Element,_view:MathBoxNode){
    if(!state.three)return null;
    const pipeRadius=el.pipeRadius??.055;
    const layout=resolveSystemDAG(el.blocks??[],el.connections??[],(el.origin??[0,0,0]) as Vec3,pipeRadius);
    const points=[...layout.nodes.values()].flatMap(n=>[-1,1].map(sign=>n.position.map((v,i)=>v+sign*n.size[i]!/2) as Vec3));
    points.push(...layout.wires.flatMap(w=>w.points));
    const lo=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]!))-.2) as Vec3,hi=[0,1,2].map(i=>Math.max(...points.map(p=>p[i]!))+.2) as Vec3;
    const worldLo=dataToWorld(lo),worldHi=dataToWorld(hi),centre=worldLo.map((v,i)=>(v+worldHi[i]!)/2) as Vec3;
    // Invisible geometry gives existing camera/picking code an exact diagram bound.
    const rootGeometry=new THREE.BoxGeometry(...worldLo.map((v,i)=>worldHi[i]!-v) as Vec3);rootGeometry.translate(...centre);
    const rootMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:1,colorWrite:false,depthWrite:false});
    const root=new THREE.Mesh(rootGeometry,rootMaterial);root.userData.ignorePlaneOpacity=true;root.userData.targetOpacity=1;
    const objectId=el.id??'system-dag';
    const blockId=(id:string)=>objectId+'::block:'+id;
    // Parts have their own picking geometry; the invisible aggregate bound
    // remains available to camera fitting without intercepting their ray hits.
    root.raycast=()=>{};
    const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textLayers:ArrayPlaneText[]=[];
    const cylinder=new THREE.CylinderGeometry(1,1,1,12),sphere=new THREE.SphereGeometry(1,12,8),cone=new THREE.ConeGeometry(1,1,12);
    geometries.add(cylinder);geometries.add(sphere);geometries.add(cone);
    function owned(geometry:BufferGeometry,material:MeshBasicMaterial|MeshPhongMaterial|ShaderMaterial,opacity=1){
        geometries.add(geometry);materials.add(material);
        const mesh=new THREE.Mesh(geometry,material);root.add(mesh);
        mesh.onBeforeRender=()=>{material.opacity=opacity*rootMaterial.opacity*(material.userData.activityOpacity??1);};
        return mesh;
    }
    const rgb=(color:Color)=>parseColor(color) as [number,number,number];
    const tint=new Map<string,Color>();
    for(const n of layout.nodes.values())tint.set(n.spec.id,n.spec.color??(n.parent?tint.get(n.parent):undefined)??PALETTE[n.spec.kind??'service']);
    function segment(a:Vec3,b:Vec3,radius:number,material:MeshBasicMaterial|MeshPhongMaterial|ShaderMaterial){
        const start=new THREE.Vector3(...dataToWorld(a)),end=new THREE.Vector3(...dataToWorld(b)),delta=end.clone().sub(start);
        if(delta.length()<1e-8)return;
        const mesh=owned(cylinder,material);mesh.position.copy(start.add(end).multiplyScalar(.5));
        mesh.scale.set(dataLenToWorld(radius),delta.length(),dataLenToWorld(radius));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
        return mesh;
    }
    function ball(p:Vec3,radius:number,material:MeshBasicMaterial|MeshPhongMaterial|ShaderMaterial){const mesh=owned(sphere,material);mesh.position.set(...dataToWorld(p));mesh.scale.setScalar(dataLenToWorld(radius));return mesh;}
    function text(value:string,p:Vec3,width:number,height:number,color:Color){
        const layer=createArrayPlaneText(width,height,color);root.add(layer.mesh);textLayers.push(layer);
        layer.mesh.onBeforeRender=(renderer,_scene,camera)=>{layer.prepare(renderer,camera);layer.mesh.material.opacity=rootMaterial.opacity;};layer.set(value,p);
        const mirror=addLabel3D('',p,color,{cssClass:'label-3d array-plane-accessible'});mirror.forceHidden=true;mirror.ownerMesh=root;clipArrayPlaneMirror(mirror.el);mirror.el.textContent=value;
        return {layer,mirror,p};
    }
    const values:{status:ReturnType<typeof registerCompositePart>;draw:ReturnType<typeof text>;fn:ReturnType<typeof compileExpr>|null;literal:string;label:string}[]=[];
    const expressions:string[]=[];
    const nodeLighting=new Map<string,{fill:MeshBasicMaterial;border:MeshPhongMaterial;glow:MeshBasicMaterial;ports:MeshPhongMaterial[];color:Color}>();
    function glowMaterial(color:Color) {
        const material=new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb(color)),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
        material.userData.activityOpacity=0;
        return material;
    }
    const containedStates:{stopped:boolean;hiddenByRemove?:boolean}[]=[];
    for(const node of layout.nodes.values()){
        const {spec,position:p,size}=node,color=tint.get(spec.id)!;
        const w0=dataToWorld(p.map((v,i)=>v-size[i]!/2) as Vec3),w1=dataToWorld(p.map((v,i)=>v+size[i]!/2) as Vec3);
        const geometry=new THREE.BoxGeometry(...w0.map((v,i)=>w1[i]!-v) as Vec3);geometry.translate(...dataToWorld(p));
        const fill=new THREE.MeshBasicMaterial({color:new THREE.Color(...rgb(color)),transparent:true,depthWrite:false});
        const blockMesh=owned(geometry,fill,spec.opacity??(spec.blocks?.length ? .10 : .24));
        const z=p[2]+size[2]/2+.025,corners:[Vec3,Vec3,Vec3,Vec3]=[[p[0]-size[0]/2,p[1]-size[1]/2,z],[p[0]+size[0]/2,p[1]-size[1]/2,z],[p[0]+size[0]/2,p[1]+size[1]/2,z],[p[0]-size[0]/2,p[1]+size[1]/2,z]];
        const border=new THREE.MeshPhongMaterial({color:new THREE.Color(...rgb(color)),emissive:new THREE.Color(...rgb(color)),emissiveIntensity:.25,shininess:28,transparent:true,depthWrite:false});
        const glow=glowMaterial(color),ports:MeshPhongMaterial[]=[];
        const rimRadius=spec.blocks?.length ? .018 : .014;
        for(let i=0;i<4;i++) {
            segment(corners[i]!,corners[(i+1)%4]!,rimRadius,border);
            const halo=segment(corners[i]!,corners[(i+1)%4]!,rimRadius*3,glow);
            if(halo)halo.onBeforeRender=()=>{glow.opacity=.18*rootMaterial.opacity*glow.userData.activityOpacity;};
        }
        // Slim side edges make the real block depth legible when orbiting.
        const backZ=p[2]-size[2]/2;
        for(let i=0;i<4;i++){
            const back=[corners[i]![0],corners[i]![1],backZ] as Vec3;
            const next=[corners[(i+1)%4]![0],corners[(i+1)%4]![1],backZ] as Vec3;
            segment(back,corners[i]!,rimRadius*.7,border);
            segment(back,next,rimRadius*.7,border);
        }
        if(node.parent){
            const parent=layout.nodes.get(node.parent)!;
            if(parent.spec.childElevation!==undefined){
                // A restrained footprint on the supporting platform conveys the air gap.
                const shadow=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,depthWrite:false});
                const footprint=owned(new THREE.PlaneGeometry(dataLenToWorld(size[0]*.96),dataLenToWorld(size[1]*.96)),shadow,.18);
                footprint.position.set(...dataToWorld([p[0]+.08,p[1]-.08,parent.position[2]+parent.size[2]/2+.01]));
                footprint.raycast=()=>{};
            }
        }
        nodeLighting.set(spec.id,{fill,border,glow,ports,color});
        const headerHeight=spec.blocks?.length ? .85 : Math.min(.78,size[1]*.48);
        const title=text(spec.label,[p[0],p[1]+size[1]/2-headerHeight*.62,z+.06],Math.max(.1,size[0]-.3),headerHeight,color);
        title.layer.mesh.raycast=THREE.Mesh.prototype.raycast;
        registerCompositePart(blockId(spec.id),node.parent?blockId(node.parent):objectId,_view,[blockMesh,title.layer.mesh],[title.mirror],spec.label,
            'Explain the '+(spec.kind??'service')+' block "'+spec.label+'" inside this system architecture, its responsibility, contained objects, and connected ports.','system_dag',spec.codeRef);
        const expression=spec.textExpr??spec.valueExpr;
        if(expression||spec.text){
            if(expression)expressions.push(expression);
            const draw=text('',[p[0],spec.blocks?.length?p[1]+size[1]/2-1.13:spec.elements?.length?p[1]+.02:p[1]-size[1]*.19,z+.06],Math.max(.1,size[0]-.3),spec.elements?.length?.32:Math.min(.65,size[1]*.38),'#ecf4ff');
            draw.layer.mesh.raycast=THREE.Mesh.prototype.raycast;
            const status=registerCompositePart(blockId(spec.id)+'::status',blockId(spec.id),_view,[draw.layer.mesh],[draw.mirror],spec.label+' status',
                'Explain the status displayed in "'+spec.label+'", the meaning of each value, and what it does or does not establish. Expression: '+(expression??spec.text), 'text');
            values.push({status,draw,fn:expression?compileExpr(expression):null,literal:spec.text??'',label:spec.label});
        }
        for(const port of spec.ports??[]){
            const normal=({left:[-1,0,0],right:[1,0,0],top:[0,1,0],bottom:[0,-1,0],front:[0,0,1],back:[0,0,-1]} as Record<string,Vec3>)[port.side]!;
            const at=p.map((v,i)=>v+normal[i]!*size[i]!/2) as Vec3;const along=normal[0]!==0?1:0;at[along]+=(port.offset??0)*size[along]/2;if(normal[2]===0)at[2]=z+.035;
            const portMaterial=new THREE.MeshPhongMaterial({color:new THREE.Color(...rgb(port.color??color)),emissive:new THREE.Color(...rgb(port.color??color)),emissiveIntensity:0,shininess:28,transparent:true});
            ports.push(portMaterial);
            const portMesh=ball(at,pipeRadius*2.4,portMaterial);
            registerCompositePart(blockId(spec.id)+'::port:'+port.id,blockId(spec.id),_view,[portMesh],[],spec.label+' port '+port.id,
                'Explain port "'+port.id+'" on "'+spec.label+'", its boundary and the connections using it.');
        }
    }
    const flows:{material:MeshPhongMaterial;glow:ShaderMaterial;from:string;to:string;color:Color;activeColor:Color;fn:ReturnType<typeof compileExpr>|null}[]=[];
    for(const wire of layout.wires){
        const wireStart=root.children.length;
        const spec=wire.spec,radius=spec.radius??pipeRadius,color=spec.color??'#8296a4';
        const material=new THREE.MeshPhongMaterial({color:new THREE.Color(...rgb(color)),shininess:28,transparent:true});
        const path=wire.points, flowPath=pipeFlowPath(path);
        const glow=new THREE.ShaderMaterial({
            transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
            uniforms:{opacity:{value:0},phase:{value:0},width:{value:Math.min(.22,.6/Math.max(flowPath.length,.001))},
                tint:{value:new THREE.Color(...rgb(spec.activeColor??'#f1c96b'))},
                direction:{value:spec.direction==='none'?0:spec.direction==='backward'?-1:spec.direction==='both'?2:1}},
            vertexShader: `attribute float flowDistance; varying float routePosition;
                void main(){routePosition=flowDistance;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `uniform float opacity;uniform float phase;uniform float width;uniform float direction;uniform vec3 tint;
                varying float routePosition;
                float beam(float at){float d=abs(routePosition-at);return exp(-pow(d/width,2.0));}
                void main(){float pulse=0.0;
                    if(direction>0.0)pulse=beam(phase);
                    if(direction<0.0||direction>1.0)pulse=max(pulse,beam(1.0-phase));
                    gl_FragColor=vec4(mix(tint,vec3(1.0),pulse*.8),opacity*(.12+.65*pulse));}`,
        });
        glow.userData.activityOpacity=0;
        // Low-opacity additive shells soften the active path without changing
        // its physical pipe radius, route, or proportional arrowhead geometry.
        for(let i=1;i<path.length;i++) {
            const halo=segment(path[i-1]!,path[i]!,radius*2.2,glow);
            if(halo) {
                const geometry=cylinder.clone(),vertices=geometry.getAttribute('position');
                const start=flowPath.offsets[i-1]!,length=flowPath.offsets[i]!-start;
                geometry.setAttribute('flowDistance',new THREE.Float32BufferAttribute(Array.from({length:vertices.count},(_,v)=>(start+(vertices.getY(v)+.5)*length)/Math.max(flowPath.length,.001)),1));
                geometries.add(geometry);halo.geometry=geometry;
                halo.raycast=()=>{};
                halo.onBeforeRender=()=>{glow.uniforms.opacity!.value=rootMaterial.opacity*glow.userData.activityOpacity;};
            }
        }
        for(let i=1;i<path.length;i++) {
            let a=path[i-1]!,b=path[i]!;
            const len=Math.hypot(...b.map((v,j)=>v-a[j]!));
            const trim=pipeArrowDimensions(radius,len).length;
            const start=a,end=b;
            if(i===1&&(spec.direction==='backward'||spec.direction==='both'))a=start.map((v,j)=>v+(end[j]!-v)*trim/len) as Vec3;
            if(i===path.length-1&&spec.direction!=='none'&&spec.direction!=='backward')b=end.map((v,j)=>v-(v-start[j]!)*trim/len) as Vec3;
            segment(a,b,radius,material);
        }
        for(const p of path.slice(1,-1))ball(p,radius,material);
        function head(end:Vec3,previous:Vec3){
            const delta=end.map((v,i)=>v-previous[i]!) as Vec3,len=Math.hypot(...delta),dims=pipeArrowDimensions(radius,len);if(len<1e-7)return;
            const dir=new THREE.Vector3(...dataToWorld(end)).sub(new THREE.Vector3(...dataToWorld(previous))).normalize();
            const mesh=owned(cone,material);mesh.scale.set(dataLenToWorld(dims.radius),dataLenToWorld(dims.length),dataLenToWorld(dims.radius));
            mesh.position.set(...dataToWorld(end));mesh.position.addScaledVector(dir,-dataLenToWorld(dims.length)/2);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
        }
        if(spec.direction!=='none'&&spec.direction!=='backward')head(path.at(-1)!,path.at(-2)!);
        if(spec.direction==='backward'||spec.direction==='both')head(path[0]!,path[1]!);
        if(spec.label){const middle=path[Math.floor(path.length/2)]!;text(spec.label,[middle[0],middle[1]+.28,middle[2]+.06],Math.min(5,Math.max(1,spec.label.length*.28)),.42,'#becdd8');}
        if(spec.activeExpr)expressions.push(spec.activeExpr);
        const coreMeshes=root.children.slice(wireStart).filter(child=>child instanceof THREE.Mesh&&child.material===material);
        registerCompositePart(objectId+'::connection:'+spec.id,wire.owner?blockId(wire.owner):objectId,_view,coreMeshes,[],spec.label??(layout.nodes.get(spec.from.block)!.spec.label+' → '+layout.nodes.get(spec.to.block)!.spec.label),
            'Explain this directed connection from "'+layout.nodes.get(spec.from.block)!.spec.label+'" port '+(spec.from.port??spec.from.side??'automatic')+' to "'+layout.nodes.get(spec.to.block)!.spec.label+'" port '+(spec.to.port??spec.to.side??'automatic')+'. Explain its direction and what active highlighting means.', 'animated_vector');
        flows.push({material,glow,from:spec.from.block,to:spec.to.block,color,activeColor:spec.activeColor??'#f1c96b',fn:spec.activeExpr?compileExpr(spec.activeExpr):null});
    }
    // Reuse the full element dispatcher. Geometry, labels and deferred updates
    // share the block's local frame; existing step trackers own their lifecycle.
    const enclosing=currentDataOffset();
    for(const node of layout.nodes.values()) {
        if(!node.spec.elements?.length)continue;
        const offset=node.position.map((v,i)=>v+enclosing[i]!) as Vec3;
        const contentView=_view.transform({position:node.position});
        for(const child of node.spec.elements) {
            const exprStart=state.activeAnimExprs.length, updaterStart=state.activeAnimUpdaters.length;
            const planes=state.planeMeshes.length,labels=state.labels.length,arrows=state.arrowMeshes.length;
            const childId=blockId(node.spec.id)+'::content:'+(child.id??node.spec.elements.indexOf(child));
            const result=withDataOffset(offset,()=>renderElement({...child,id:childId},contentView));
            const contentMeshes=[...state.planeMeshes.slice(planes)];
            for(const owner of [...contentMeshes])owner.traverse(part=>{
                if(part instanceof THREE.Mesh&&part!==owner&&part.userData.annotationTextPlane&&!Array.isArray(part.material)&&part.material instanceof THREE.MeshBasicMaterial&&part.material.map) {
                    part.raycast=THREE.Mesh.prototype.raycast;
                    contentMeshes.push(part);
                }
            });
            const content=registerCompositePart(childId,blockId(node.spec.id),contentView,contentMeshes,state.labels.slice(labels),child.label??node.spec.label+' '+child.type,
                child.prompt??'Explain the '+child.type+' object inside "'+node.spec.label+'", including its current contents and how it relates to the enclosing block.',child.type);
            content.tracker.arrowMeshes.push(...state.arrowMeshes.slice(arrows));
            for(const arrow of state.arrowMeshes.slice(arrows))arrow.mesh.userData.askObjectId=childId;
            void result;
            for(const entry of state.activeAnimExprs.slice(exprStart)) {
                if(entry.animState)containedStates.push(entry.animState);
                const rebuild=entry._rebuildFn;
                if(rebuild)entry._rebuildFn=()=>withDataOffset(offset,()=>rebuild());
            }
            for(const updater of state.activeAnimUpdaters.slice(updaterStart)) {
                if(updater.animState)containedStates.push(updater.animState);
                const update=updater.updateFrame.bind(updater);
                updater.updateFrame=(now:number)=>withDataOffset(offset,()=>update(now));
            }
        }
    }
    state.three.scene.add(root);state.planeMeshes.push(root);
    let stopped=false,hidden=false;
    const animState={get stopped(){return stopped;},set stopped(value:boolean){stopped=value;if(value)unregisterAnimUpdater(animState);for(const child of containedStates){child.stopped=value;if(value){unregisterAnimExpr(child);unregisterAnimUpdater(child);}}},get hiddenByRemove(){return hidden;},set hiddenByRemove(value:boolean){hidden=value;for(const child of containedStates)child.hiddenByRemove=value;}};
    const entry:AnimExprEntry={animState,exprStrings:expressions,_rebuildFn:()=>{
        if(animState.stopped||animState.hiddenByRemove)return;
        for(const v of values){const value=v.fn?evalExpr(v.fn,0):v.literal,content=String(value??'');v.draw.layer.set(content,v.draw.p);v.draw.mirror.el.textContent=`${v.label}: ${content}`;v.status.label=`${v.label} status: ${content}`;}
        const activeNodes=new Set<string>();
        function lightNode(id:string){
            while(!activeNodes.has(id)) {
                activeNodes.add(id);
                const parent=layout.nodes.get(id)?.parent;
                if(!parent)break;id=parent;
            }
        }
        for(const f of flows) {
            const active=!!(f.fn&&evalExpr(f.fn,0));
            f.material.color.setRGB(...rgb(active?f.activeColor:f.color));
            f.material.emissive.setRGB(...rgb(f.activeColor));
            f.material.emissiveIntensity=active?.65:0;
            f.glow.userData.activityOpacity=active?1:0;
            if(active){lightNode(f.from);lightNode(f.to);}
        }
        for(const [id,lighting] of nodeLighting) {
            const active=activeNodes.has(id);
            lighting.fill.color.setRGB(...rgb(lighting.color));
            if(active)lighting.fill.color.lerp(new THREE.Color('#ffffff'),.18);
            lighting.border.emissiveIntensity=active?.8:.25;
            lighting.glow.userData.activityOpacity=active?1:0;
            for(const port of lighting.ports)port.emissiveIntensity=active?.65:0;
        }
        // Transparent opacity zero still submits a draw call. Hide inactive
        // halo meshes entirely; active paths retain their illumination.
        for(const child of root.children)if(child instanceof THREE.Mesh&&!Array.isArray(child.material)&&child.material.userData.activityOpacity!==undefined){
            child.visible=child.material.userData.activityOpacity>0;
        }
    }};
    entry._rebuildFn?.();if(expressions.length)registerAnimExpr(entry);
    if(flows.some(flow=>flow.fn))registerAnimUpdater({animState,updateFrame(nowMs){
        if(animState.stopped||animState.hiddenByRemove||!root.visible)return;
        for(const flow of flows)if(flow.glow.userData.activityOpacity>0)flow.glow.uniforms.phase!.value=pipeFlowPhase(nowMs);
    }});
    rootMaterial.addEventListener('dispose',()=>{animState.stopped=true;for(const t of textLayers)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.clear();});
    return {_animState:animState,_animExprEntry:entry,type:el.type};
}
