/** A typed one-dimensional array. One merged box mesh; expressions run on state changes. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D, parseColor } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import { renderStepMarker } from '/objects/step-marker.js';
import { arrayCell, arrayLength, dynamicArrayLength, arrayIndexPosition, arrayCellCorners } from '/objects/array-data.js';
import { ArrayChangeTracker } from '/objects/array-changes.js';

let arrayMarkerGroup = 0;
/** Shared presentation lookup for a cell, without references to other controls. */
export interface ArrayCellTarget { at(index:number):{position:[number,number,number];corners:number[][]}|null; }
const PALETTE={number:'#75bfe9',character:'#74d0c2',string:'#b69bea',boolean:'#efa768',empty:'#8793a6'};
export function renderArray(el:Element,_view:MathBoxNode) {
    if(!state.three)return null;
    const lengthFn=el.lengthExpr?compileExpr(el.lengthExpr):null;
    let n=lengthFn?dynamicArrayLength(evalExpr(lengthFn,0)):arrayLength(el.shape,el.valueExpr?undefined:el.values);
    const raw=el.origin??[0,0,0],origin=raw.map(Number);
    if(origin.length!==3||origin.some(v=>!Number.isFinite(v)))throw new Error('Array origin must contain three finite coordinates.');
    const pitch=Number(el.cellSize??2);
    if(!Number.isFinite(pitch)||pitch<=0)throw new Error('Array cellSize must be positive.');
    // Cell centres are origin + idx * cellSize; index labels belong to slots.
    const centre=(i:number):[number,number,number]=>[origin[0]!+i*pitch,origin[1]!,origin[2]!];
    const unit=new THREE.BoxGeometry(1,1,1).toNonIndexed();
    const source=unit.getAttribute('position'),normal=unit.getAttribute('normal'),vertices=source.count;
    let positions=new Float32Array(n*vertices*3),colors=new Float32Array(n*vertices*3);
    for(let i=0;i<n;i++)for(let v=0;v<vertices;v++){
        const c=centre(i);
        const p=dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*.68,c[2]+source.getZ(v)*.22]);
        positions.set(p,(i*vertices+v)*3);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    let colorAttribute=new THREE.BufferAttribute(colors,3);geometry.setAttribute('color',colorAttribute);
    const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:1});
    const mesh=new THREE.Mesh(geometry,material);mesh.userData.ignorePlaneOpacity=true;mesh.userData.targetOpacity=1;
    const cellTarget:ArrayCellTarget={at(index){
        const position=arrayIndexPosition(index,n,origin,pitch);
        return position?{position,corners:arrayCellCorners(position,pitch)}:null;
    }};
    mesh.userData.arrayCellTarget=cellTarget;
    state.three.scene.add(mesh);state.planeMeshes.push(mesh);
    // A world-space soft rim follows the cells without screen overlays or frame evaluation.
    const glowMaterial=new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,side:THREE.DoubleSide,
        uniforms:{opacity:{value:1}},
        vertexShader:`attribute float removed; varying vec2 rimUV; varying float removedCell;
            void main(){rimUV=uv*2.0-1.0;removedCell=removed;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`uniform float opacity; varying vec2 rimUV; varying float removedCell;
            void main(){float edge=max(abs(rimUV.x),abs(rimUV.y));
                float rim=exp(-pow((edge-0.86)/0.09,2.0));
                vec3 light=mix(vec3(1.0,0.88,0.55),vec3(0.65,0.80,0.92),removedCell);
                float alpha=rim*mix(0.85,0.35,removedCell)*opacity;
                if(alpha<0.01)discard; gl_FragColor=vec4(light,alpha);}`,
    });
    const glowMesh=new THREE.Mesh(new THREE.BufferGeometry(),glowMaterial);
    glowMesh.onBeforeRender=()=>{glowMaterial.uniforms.opacity!.value=glowMaterial.opacity;};
    glowMesh.visible=false;glowMesh.userData.ignorePlaneOpacity=true;glowMesh.userData.targetOpacity=1;
    // Decorative rims must not alter wire anchors or capture object picking.
    glowMesh.userData.annotationTextPlane=true;glowMesh.raycast=()=>{};
    state.three.scene.add(glowMesh);state.planeMeshes.push(glowMesh);
    const changes=new ArrayChangeTracker();
    let illuminated=new Set<number>();
    function illuminate(changed:number[],removed:number[]){
        const positions:number[]=[],uv:number[]=[],removedFlags:number[]=[];
        const corners=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]];
        for(const [indices,isRemoved] of [[changed,0],[removed,1]] as const)for(const i of indices){
            const c=centre(i);
            for(const [x,y] of corners){
                positions.push(...dataToWorld([c[0]+x!*pitch*.455,c[1]+y!*.397,c[2]+.125]));
                uv.push((x!+1)/2,(y!+1)/2);removedFlags.push(isRemoved);
            }
        }
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
        geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
        geometry.setAttribute('removed',new THREE.Float32BufferAttribute(removedFlags,1));
        glowMesh.geometry.dispose();glowMesh.geometry=geometry;
        glowMesh.visible=positions.length>0;
    }
    const indexLabels: ReturnType<typeof addLabel3D>[]=[];
    const makeCellLabel=(i:number)=>{
        const c=centre(i),label=addLabel3D('',[c[0],c[1],c[2]+.14],'#12212b',{cssClass:'label-3d array-cell-label'});
        if(el.fontSize!=null)label.el.style.setProperty('--array-font-size',`${el.fontSize}px`);
        label.ownerMesh=mesh;
        label.snapToProjection = true;
        if(el.showIndices!==false){
            const indexLabel = addLabel3D(String(i),c,'#e1ecf7',{cssClass:'label-3d array-index-tag'});
            if(el.indexFontSize!=null)indexLabel.el.style.setProperty('--array-index-font-size',`${el.indexFontSize}px`);
            indexLabel.ownerMesh=mesh;
            indexLabel.el.setAttribute('aria-label',`Index ${i}`);
            indexLabels.push(indexLabel);
            indexLabel.cellAttachment = {corners:arrayCellCorners(c,pitch),edge:'bottom',gap:0};
        }
        return label;
    };
    const labels=Array.from({length:n},(_,i)=>makeCellLabel(i));
    let titleLabel: ReturnType<typeof addLabel3D>|undefined;
    if(el.label){
        const offset=el.labelOffset??[0,.88,0];
        titleLabel = addLabel3D('',[origin[0]!+Math.max(0,n-1)*pitch/2+offset[0]!,origin[1]!+offset[1]!,origin[2]!+offset[2]!],'#b5c1cf');
        titleLabel.el.textContent=el.label; titleLabel.snapToProjection=true;
    }
    const animState:{stopped:boolean;hiddenByRemove?:boolean}={stopped:false};
    // Children share the owner's lifetime and never register independent updaters.
    const owner = {group: 'array-markers:' + arrayMarkerGroup++, animState,
        position: (index: number) => arrayIndexPosition(index, n, origin, pitch),
        corners: (index: number) => arrayCellCorners(centre(index),pitch)};
    const markers = (el.markers ?? []).map(marker => renderStepMarker({...marker, type:'step_marker'}, _view, owner));
    const valueFn=el.valueExpr?compileExpr(el.valueExpr):null;
    const highlightFn=el.highlightExpr?compileExpr(el.highlightExpr):null;
    const previous: string[]=[];
    function resize(next:number) {
        if(next===n)return;
        while(labels.length>next) {
            for(const label of [labels.pop()!,indexLabels.pop()]) {
                if(!label)continue;
                label.el.remove();
                const index=state.labels.indexOf(label);
                if(index>=0)state.labels.splice(index,1);
            }
        }
        while(labels.length<next)labels.push(makeCellLabel(labels.length));
        n=next;
        positions=new Float32Array(n*vertices*3); colors=new Float32Array(n*vertices*3);
        for(let i=0;i<n;i++)for(let v=0;v<vertices;v++){
            const c=centre(i);
            positions.set(dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*.68,c[2]+source.getZ(v)*.22]),(i*vertices+v)*3);
        }
        const replacement=new THREE.BufferGeometry();
        replacement.setAttribute('position',new THREE.BufferAttribute(positions,3));
        colorAttribute=new THREE.BufferAttribute(colors,3);replacement.setAttribute('color',colorAttribute);
        mesh.geometry.dispose();mesh.geometry=replacement;
        previous.length=0;
        if(titleLabel)titleLabel.dataPos[0]=origin[0]!+Math.max(0,n-1)*pitch/2+(el.labelOffset?.[0]??0);
    }
    const entry:AnimExprEntry={animState,exprStrings:[el.lengthExpr,el.valueExpr,el.highlightExpr,...markers.flatMap(marker=>marker._animExprEntry.exprStrings ?? [])].filter((v):v is string=>!!v),_rebuildFn:()=>{
        // Hidden lesson steps must not advance the last-visible comparison baseline.
        if(animState.stopped||animState.hiddenByRemove)return;
        const next=lengthFn?dynamicArrayLength(evalExpr(lengthFn,0)):n;
        // Evaluate the whole next state before advancing the comparison baseline.
        const cells=Array.from({length:next},(_,i)=>{
            const cell=arrayCell(valueFn?evalExpr(valueFn,0,{overrideScope:{idx:i}}):el.values?.[i],el.itemType);
            const highlighted=highlightFn?!!evalExpr(highlightFn,0,{overrideScope:{idx:i,value:cell.value}}):false;
            return {cell,highlighted};
        });
        const transition=JSON.stringify(Object.entries(state.sceneSliders).map(([id,s])=>[id,s.value,s.values]));
        const delta=changes.update(cells.map(({cell})=>JSON.stringify([cell.kind,cell.value])),transition);
        if(delta){
            illuminated=new Set([...delta.changed,...delta.added]);
            illuminate([...illuminated],delta.removed);
        }
        resize(next);
        for (const marker of markers) marker._animExprEntry._rebuildFn?.();
        let dirty=false;
        for(let i=0;i<n;i++){
            const {cell,highlighted}=cells[i]!; // one successfully evaluated cell per slot
            const lit=illuminated.has(i);
            const key=JSON.stringify([cell.kind,cell.value,highlighted,lit]);
            if(previous[i]===key)continue;previous[i]=key;dirty=true;
            const label=labels[i]!; // one label allocated per cell
            label.el.textContent=cell.text;label.el.title=`[${i}] ${cell.kind}: ${cell.text}`;
            label.el.setAttribute('aria-label',label.el.title);label.boxW=null;label.boxH=null;
            const rgb=parseColor(highlighted?'#f1cc59':el.color??PALETTE[cell.kind]);
            if(lit)for(let j=0;j<3;j++)rgb[j]=rgb[j]!+(1-rgb[j]!)*.35;
            for(let v=0;v<vertices;v++){
                const shade=normal.getZ(v)>0?1:normal.getY(v)>0?.78:.56;
                const k=(i*vertices+v)*3;colors[k]=rgb[0]!*shade;colors[k+1]=rgb[1]!*shade;colors[k+2]=rgb[2]!*shade;
            }
        }
        if(dirty)colorAttribute.needsUpdate=true;
    }};
    try{entry._rebuildFn?.();}catch(error){console.warn('array:',error);}
    // Shader/lifecycle resources follow the same registry as tensor boxes.
    material.addEventListener('dispose',()=>unit.dispose());
    if(entry.exprStrings?.length)registerAnimExpr(entry);
    return {_animState:animState,_animExprEntry:entry,type:'array'};
}
