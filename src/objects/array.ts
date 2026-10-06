/** A typed one-dimensional array. One merged box mesh; expressions run on state changes. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D, parseColor } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import { renderStepMarker } from '/objects/step-marker.js';
import { arrayCell, arrayLength, arrayIndexPosition, arrayCellCorners } from '/objects/array-data.js';

let arrayMarkerGroup = 0;
const PALETTE={number:'#75bfe9',character:'#74d0c2',string:'#b69bea',boolean:'#efa768',empty:'#8793a6'};
export function renderArray(el:Element,_view:MathBoxNode) {
    if(!state.three)return null;
    const n=arrayLength(el.shape,el.valueExpr?undefined:el.values);
    const raw=el.origin??[0,0,0],origin=raw.map(Number);
    if(origin.length!==3||origin.some(v=>!Number.isFinite(v)))throw new Error('Array origin must contain three finite coordinates.');
    const pitch=Number(el.cellSize??2);
    if(!Number.isFinite(pitch)||pitch<=0)throw new Error('Array cellSize must be positive.');
    // Cell centres are origin + idx * cellSize; index labels belong to slots.
    const centre=(i:number):[number,number,number]=>[origin[0]!+i*pitch,origin[1]!,origin[2]!];
    const unit=new THREE.BoxGeometry(1,1,1).toNonIndexed();
    const source=unit.getAttribute('position'),normal=unit.getAttribute('normal'),vertices=source.count;
    const positions=new Float32Array(n*vertices*3),colors=new Float32Array(n*vertices*3);
    for(let i=0;i<n;i++)for(let v=0;v<vertices;v++){
        const c=centre(i);
        const p=dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*.68,c[2]+source.getZ(v)*.22]);
        positions.set(p,(i*vertices+v)*3);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const colorAttribute=new THREE.BufferAttribute(colors,3);geometry.setAttribute('color',colorAttribute);
    const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:1});
    const mesh=new THREE.Mesh(geometry,material);mesh.userData.ignorePlaneOpacity=true;mesh.userData.targetOpacity=1;
    state.three.scene.add(mesh);state.planeMeshes.push(mesh);
    const labels=Array.from({length:n},(_,i)=>{
        const c=centre(i),label=addLabel3D('',[c[0],c[1],c[2]+.14],'#12212b',{cssClass:'label-3d array-cell-label'});
        label.snapToProjection = true;
        const indexLabel = addLabel3D(String(i),c,'#93a1b3');
        indexLabel.cellAttachment = {corners:arrayCellCorners(c,pitch),edge:'bottom',gap:8};
        return label;
    });
    if(el.label){
        const offset=el.labelOffset??[0,.88,0];
        const titleLabel = addLabel3D('',[origin[0]!+(n-1)*pitch/2+offset[0]!,origin[1]!+offset[1]!,origin[2]!+offset[2]!],'#b5c1cf');
        titleLabel.el.textContent=el.label; titleLabel.snapToProjection=true;
    }
    const animState={stopped:false};
    // Children share the owner's lifetime and never register independent updaters.
    const owner = {group: 'array-markers:' + arrayMarkerGroup++, animState,
        position: (index: number) => arrayIndexPosition(index, n, origin, pitch),
        corners: (index: number) => arrayCellCorners(centre(index),pitch)};
    const markers = (el.markers ?? []).map(marker => renderStepMarker({...marker, type:'step_marker'}, _view, owner));
    const valueFn=el.valueExpr?compileExpr(el.valueExpr):null;
    const highlightFn=el.highlightExpr?compileExpr(el.highlightExpr):null;
    const previous: string[]=[];
    const entry:AnimExprEntry={animState,exprStrings:[el.valueExpr,el.highlightExpr,...markers.flatMap(marker=>marker._animExprEntry.exprStrings ?? [])].filter((v):v is string=>!!v),_rebuildFn:()=>{
        if(animState.stopped)return;
        for (const marker of markers) marker._animExprEntry._rebuildFn?.();
        let dirty=false;
        for(let i=0;i<n;i++){
            const rawValue=valueFn?evalExpr(valueFn,0,{overrideScope:{idx:i}}):el.values?.[i];
            const cell=arrayCell(rawValue,el.itemType);
            const highlighted=highlightFn?!!evalExpr(highlightFn,0,{overrideScope:{idx:i,value:cell.value}}):false;
            const key=JSON.stringify([cell.kind,cell.value,highlighted]);
            if(previous[i]===key)continue;previous[i]=key;dirty=true;
            const label=labels[i]!; // one label allocated per cell
            label.el.textContent=cell.text;label.el.title=`[${i}] ${cell.kind}: ${cell.text}`;
            label.el.setAttribute('aria-label',label.el.title);label.boxW=null;label.boxH=null;
            const rgb=parseColor(highlighted?'#f1cc59':el.color??PALETTE[cell.kind]);
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
