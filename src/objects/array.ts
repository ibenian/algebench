/** A typed one-dimensional array. One merged box mesh; expressions run on state changes. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D, parseColor } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import type { Mesh, Object3D } from 'three';
import { renderStepMarker } from '/objects/step-marker.js';
import { arrayCell, arrayLength, cellColor, dynamicArrayLength, arrayIndexPosition, arrayCellPosition, arrayCellCorners, wrappedArrayCell } from '/objects/array-data.js';
import { registerStackHover, stackCellOpacities } from '/objects/array-stack-hover.js';
import { ArrayChangeTracker } from '/objects/array-changes.js';
import { createArrayPlaneText, clipArrayPlaneMirror } from '/objects/array-plane-text.js';
import type { ArrayPlaneText } from '/objects/array-plane-text.js';

let arrayMarkerGroup = 0;
/** Shared presentation lookup for a cell, without references to other controls. */
export interface ArrayCellTarget { at(index:number):{position:[number,number,number];corners:number[][]}|null; }
const PALETTE={number:'#75bfe9',character:'#74d0c2',string:'#b69bea',boolean:'#efa768',empty:'#8793a6'};
export interface ArrayDecoration { resize(length:number):void; }
export function renderArray(el:Element,_view:MathBoxNode,decorate?:(length:number,origin:number[],pitch:number,owner:Mesh)=>ArrayDecoration) {
    if(!state.three)return null;
    const lengthFn=el.lengthExpr?compileExpr(el.lengthExpr):null;
    let n=lengthFn?dynamicArrayLength(evalExpr(lengthFn,0)):arrayLength(el.shape,el.valueExpr?undefined:el.values);
    const raw=el.origin??[0,0,0],origin=raw.map(Number);
    if(origin.length!==3||origin.some(v=>!Number.isFinite(v)))throw new Error('Array origin must contain three finite coordinates.');
    const pitch=Number(el.cellSize??2);
    if(!Number.isFinite(pitch)||pitch<=0)throw new Error('Array cellSize must be positive.');
    if(el.direction&&el.arrayColumns)throw new Error('Array direction and wrapped columns are alternative layouts.');
    // Direction controls center positions independently of cell geometry.
    const centre=(i:number):[number,number,number]=>el.arrayColumns?wrappedArrayCell(i,n,origin,pitch,el.arrayColumns,el.arrayHeight).position:arrayCellPosition(i,origin,pitch,el.arrayLayout,el.direction,el.arraySpacing);
    const cellHeight=()=>el.arrayColumns?wrappedArrayCell(0,n,origin,pitch,el.arrayColumns,el.arrayHeight).height:.68;
    const unit=new THREE.BoxGeometry(1,1,1).toNonIndexed();
    const source=unit.getAttribute('position'),normal=unit.getAttribute('normal'),vertices=source.count;
    let positions=new Float32Array(n*vertices*3),colors=new Float32Array(n*vertices*3);
    for(let i=0;i<n;i++)for(let v=0;v<vertices;v++){
        const c=centre(i);
        const p=dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*cellHeight(),c[2]+source.getZ(v)*.22]);
        positions.set(p,(i*vertices+v)*3);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    let colorAttribute=new THREE.BufferAttribute(colors,3);geometry.setAttribute('color',colorAttribute);
    let cellOpacity = new Float32Array(n * vertices).fill(1);
    let opacityAttribute = new THREE.BufferAttribute(cellOpacity, 1);
    geometry.setAttribute('cellOpacity', opacityAttribute);
    let hovered: number | null = null;
    let hoverOpacity: number[] = Array(n).fill(1);
    const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:1});
    if (el.hoverReveal) {
        material.onBeforeCompile = shader => {
            shader.vertexShader = 'attribute float cellOpacity; varying float stackOpacity;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nstackOpacity = cellOpacity;');
            shader.fragmentShader = 'varying float stackOpacity;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (stackOpacity < 0.99) discard;');
        };
        material.customProgramCacheKey = () => 'array-stack-hover';
    }
    const mesh=new THREE.Mesh(geometry,material);mesh.userData.ignorePlaneOpacity=true;mesh.userData.targetOpacity=1;
    // Render faded cells separately so solid cells still occlude records behind them.
    const ghostMaterial = el.hoverReveal ? new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false}) : null;
    const ghostMesh = ghostMaterial ? new THREE.Mesh(geometry,ghostMaterial) : null;
    if (ghostMaterial && ghostMesh) {
        ghostMaterial.onBeforeCompile = shader => {
            shader.vertexShader = 'attribute float cellOpacity; varying float stackOpacity;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nstackOpacity = cellOpacity;');
            shader.fragmentShader = 'varying float stackOpacity;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (stackOpacity > 0.99) discard; diffuseColor.a *= stackOpacity;');
        };
        ghostMaterial.customProgramCacheKey = () => 'array-stack-ghost';
        ghostMesh.visible=false;
        ghostMesh.userData.annotationTextPlane=true;
        ghostMesh.raycast=()=>{};
        ghostMesh.onBeforeRender=()=>{ghostMaterial.opacity=material.opacity;};
        mesh.add(ghostMesh);
    }
    const cellTarget:ArrayCellTarget={at(index){
        const position=el.arrayColumns?(Number.isInteger(index)&&index>=0&&index<n?centre(index):null):arrayIndexPosition(index,n,origin,pitch,el.arrayLayout,el.direction,el.arraySpacing);
        return position?{position,corners:arrayCellCorners(position,pitch).map(c=>[c[0]!,position[1]+(c[1]!-position[1])*cellHeight()/.68,c[2]!])}:null;
    }};
    mesh.userData.arrayCellTarget=cellTarget;
    state.three.scene.add(mesh);state.planeMeshes.push(mesh);
    const decoration=decorate?.(n,origin,pitch,mesh);
    // A world-space soft rim follows the cells without screen overlays or frame evaluation.
    const glowMaterial=new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,side:THREE.DoubleSide,
        uniforms:{opacity:{value:1}},
        vertexShader:`attribute float removed; attribute float cellOpacity; varying float stackOpacity; varying vec2 rimUV; varying float removedCell;
            void main(){rimUV=uv*2.0-1.0;removedCell=removed;stackOpacity=cellOpacity;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`uniform float opacity; varying float stackOpacity; varying vec2 rimUV; varying float removedCell;
            void main(){float edge=max(abs(rimUV.x),abs(rimUV.y));
                float rim=exp(-pow((edge-0.86)/0.09,2.0));
                vec3 light=mix(vec3(1.0,0.88,0.55),vec3(0.65,0.80,0.92),removedCell);
                float alpha=rim*mix(0.85,0.35,removedCell)*opacity*stackOpacity;
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
    let rimCells: number[] = [];
    function illuminate(changed:number[],removed:number[]){
        const positions:number[]=[],uv:number[]=[],removedFlags:number[]=[],rimOpacity:number[]=[];
        rimCells = [];
        const corners=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]];
        for(const [indices,isRemoved] of [[changed,0],[removed,1]] as const)for(const i of indices){
            const c=centre(i);
            for(const [x,y] of corners){
                positions.push(...dataToWorld([c[0]+x!*pitch*.455,c[1]+y!*cellHeight()*.584,c[2]+.125]));
                uv.push((x!+1)/2,(y!+1)/2);removedFlags.push(isRemoved);rimCells.push(i);rimOpacity.push(hoverOpacity[i] ?? 1);
            }
        }
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
        geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
        geometry.setAttribute('removed',new THREE.Float32BufferAttribute(removedFlags,1));
        geometry.setAttribute('cellOpacity',new THREE.Float32BufferAttribute(rimOpacity,1));
        glowMesh.geometry.dispose();glowMesh.geometry=geometry;
        glowMesh.visible=positions.length>0;
    }
    const planeText=el.axisLabels==='plane';
    const cellTextPlanes:ArrayPlaneText[]=[];
    const indexTextPlanes:ArrayPlaneText[]=[];
    const addTextPlane=(width:number,height:number,color:NonNullable<Element['color']>,cell?:number)=>{
        const layer=createArrayPlaneText(width,height,color);
        // Parent ownership handles hide/show and dynamically added cell lifetimes.
        mesh.add(layer.mesh);
        layer.mesh.onBeforeRender=(renderer,_scene,camera)=>{layer.prepare(renderer,camera);layer.mesh.material.opacity=material.opacity*(cell == null ? 1 : hoverOpacity[cell] ?? 1);};
        return layer;
    };
    const removeTextPlane=(layer:ArrayPlaneText|undefined)=>{
        if(!layer)return;
        layer.dispose();
    };
    const indexLabels: ReturnType<typeof addLabel3D>[]=[];
    const makeCellLabel=(i:number)=>{
        const c=centre(i),label=addLabel3D('',[c[0],c[1],c[2]+.14],'#12212b',{cssClass:'label-3d array-cell-label'});
        if(el.fontSize!=null)label.el.style.setProperty('--array-font-size',`${el.fontSize}px`);
        label.ownerMesh=mesh;
        label.snapToProjection = true;
        if(planeText){label.forceHidden=true;label.el.classList.add('array-plane-accessible');clipArrayPlaneMirror(label.el);cellTextPlanes.push(addTextPlane(pitch*.78,cellHeight(),'#12212b',i));}
        if(el.showIndices!==false){
            const indexLabel = addLabel3D(String(i),c,'#e1ecf7',{cssClass:'label-3d array-index-tag'});
            if(el.indexFontSize!=null)indexLabel.el.style.setProperty('--array-index-font-size',`${el.indexFontSize}px`);
            indexLabel.ownerMesh=mesh;
            if(planeText){indexLabel.forceHidden=true;indexLabel.el.classList.add('array-plane-accessible');clipArrayPlaneMirror(indexLabel.el);indexTextPlanes.push(addTextPlane(.7,.35,'#e1ecf7',i));}
            indexLabel.el.setAttribute('aria-label',`Index ${i}`);
            indexLabels.push(indexLabel);
            indexLabel.cellAttachment = {corners:arrayCellCorners(c,pitch),edge:'bottom',gap:0};
        }
        return label;
    };
    const labels=Array.from({length:n},(_,i)=>makeCellLabel(i));
    let titleLabel: ReturnType<typeof addLabel3D>|undefined;
    const titleCentre=()=>el.arrayColumns?centre(Math.min(el.arrayColumns,n)-1):centre(Math.max(0,n-1)/(el.arrayLayout==='vertical'?1:2));
    const titleWidth=Math.max(1,(el.label?.length??0)*.38);
    const titlePosition=():[number,number,number]=>{
        const at=el.labelPosition??titleCentre().map((value,i)=>value+(el.labelOffset??[0,.88,0])[i]!);
        return [Number(at[0])+(planeText&&el.align==='left'?titleWidth/2:planeText&&el.align==='right'?-titleWidth/2:0),Number(at[1]),Number(at[2])+.14];
    };
    const titlePlane=planeText&&el.label?addTextPlane(titleWidth,.95,el.color??'#b5c1cf'):null;
    const emptyPlane=planeText?addTextPlane(.7,.68,'#8793a6'):null;
    if(el.label){
        titleLabel = addLabel3D('',titlePosition(),'#b5c1cf',{align:el.align,cssClass:`label-3d ${el.cssClass??''}`});
        if(planeText){titleLabel.forceHidden=true;titleLabel.el.classList.add('array-plane-accessible');clipArrayPlaneMirror(titleLabel.el);}
        titleLabel.el.textContent=el.label; titleLabel.snapToProjection=true;titleLabel.ownerMesh=mesh;
    }
    const updateTitle=()=>{
        if(titleLabel)titleLabel.dataPos=titlePosition();
        if(titlePlane)titlePlane.set(el.label!,titlePosition()); // allocated only for a non-empty array label.
        if(emptyPlane){emptyPlane.mesh.visible=n===0;emptyPlane.set('∅',[origin[0]!,origin[1]!,origin[2]!+.14]);}
    };
    updateTitle();
    const animState:{stopped:boolean;hiddenByRemove?:boolean}={stopped:false};
    // Children share the owner's lifetime and never register independent updaters.
    const owner = {group: 'array-markers:' + arrayMarkerGroup++, animState,
        position: (index: number) => cellTarget.at(index)?.position??null,
        corners: (index: number) => cellTarget.at(index)?.corners??[]};
    const markers = (el.markers ?? []).map(marker => renderStepMarker({...marker, type:'step_marker'}, _view, owner));
    const valueFn=el.valueExpr?compileExpr(el.valueExpr):null;
    const highlightFn=el.highlightExpr?compileExpr(el.highlightExpr):null;
    const colorFn=el.colorExpr?compileExpr(el.colorExpr):null;
    const previous: string[]=[];
    function resize(next:number) {
        if(next===n)return;
        selectCell(null);
        // A fitted grid changes existing cell geometry and text size when its row count changes.
        if(el.arrayColumns){
            while(labels.length){
                removeTextPlane(cellTextPlanes.pop());removeTextPlane(indexTextPlanes.pop());
                for(const label of [labels.pop()!,indexLabels.pop()]){
                    if(!label)continue;
                    label.el.remove();const index=state.labels.indexOf(label);if(index>=0)state.labels.splice(index,1);
                }
            }
        }
        n=next;
        while(labels.length>next) {
            removeTextPlane(cellTextPlanes.pop());removeTextPlane(indexTextPlanes.pop());
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
            positions.set(dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*cellHeight(),c[2]+source.getZ(v)*.22]),(i*vertices+v)*3);
        }
        const replacement=new THREE.BufferGeometry();
        replacement.setAttribute('position',new THREE.BufferAttribute(positions,3));
        hoverOpacity = Array(n).fill(1);
        cellOpacity = new Float32Array(n * vertices).fill(1);
        opacityAttribute = new THREE.BufferAttribute(cellOpacity, 1);
        replacement.setAttribute('cellOpacity', opacityAttribute);
        colorAttribute=new THREE.BufferAttribute(colors,3);replacement.setAttribute('color',colorAttribute);
        mesh.geometry.dispose();mesh.geometry=replacement;
        if (ghostMesh) ghostMesh.geometry=replacement;
        previous.length=0;
        updateTitle();
    }
    const entry:AnimExprEntry={animState,exprStrings:[el.lengthExpr,el.valueExpr,el.highlightExpr,el.colorExpr,...markers.flatMap(marker=>marker._animExprEntry.exprStrings ?? [])].filter((v):v is string=>!!v),_rebuildFn:()=>{
        // Hidden lesson steps must not advance the last-visible comparison baseline.
        if(animState.stopped||animState.hiddenByRemove)return;
        const next=lengthFn?dynamicArrayLength(evalExpr(lengthFn,0)):n;
        // Evaluate the whole next state before advancing the comparison baseline.
        const cells=Array.from({length:next},(_,i)=>{
            const cell=arrayCell(valueFn?evalExpr(valueFn,0,{overrideScope:{idx:i}}):el.values?.[i],el.itemType);
            const highlighted=highlightFn?!!evalExpr(highlightFn,0,{overrideScope:{idx:i,value:cell.value}}):false;
            const color=colorFn?cellColor(evalExpr(colorFn,0,{overrideScope:{idx:i,value:cell.value}})):null;
            return {cell,highlighted,color};
        });
        const transition=JSON.stringify(Object.entries(state.sceneSliders).map(([id,s])=>[id,s.value,s.values]));
        const delta=changes.update(cells.map(({cell})=>JSON.stringify([cell.kind,cell.value])),transition);
        resize(next);
        if(delta){
            illuminated=new Set([...delta.changed,...delta.added]);
            illuminate([...illuminated],delta.removed);
        }
        updateTitle();
        decoration?.resize(next);
        for (const marker of markers) marker._animExprEntry._rebuildFn?.();
        let dirty=false;
        for(let i=0;i<n;i++){
            const {cell,highlighted,color}=cells[i]!; // one successfully evaluated cell per slot
            const lit=illuminated.has(i);
            const key=JSON.stringify([cell.kind,cell.value,highlighted,color,lit]);
            if(previous[i]===key)continue;previous[i]=key;dirty=true;
            const label=labels[i]!; // one label allocated per cell
            label.el.textContent=cell.text;label.el.title=`[${i}] ${cell.kind}: ${cell.text}`;
            label.el.setAttribute('aria-label',label.el.title);label.boxW=null;label.boxH=null;
            if(planeText){
                const c=centre(i);
                cellTextPlanes[i]!.set(cell.text,[c[0],c[1],c[2]+.14]); // makeCellLabel allocates one text plane per slot.
                indexTextPlanes[i]?.set(String(i),[c[0],c[1]-.58,c[2]+.14]);
            }
            const rgb=parseColor(color??(highlighted?'#f1cc59':el.color??PALETTE[cell.kind]));
            if(lit)for(let j=0;j<3;j++)rgb[j]=rgb[j]!+(1-rgb[j]!)*.35;
            for(let v=0;v<vertices;v++){
                const shade=normal.getZ(v)>0?1:normal.getY(v)>0?.78:.56;
                const k=(i*vertices+v)*3;colors[k]=rgb[0]!*shade;colors[k+1]=rgb[1]!*shade;colors[k+2]=rgb[2]!*shade;
            }
        }
        if(dirty)colorAttribute.needsUpdate=true;
    }};
    function selectCell(index: number | null) {
        if (index !== null && (index < 0 || index >= n)) index = null;
        if (index === null && hovered === null) return;
        hovered = index;
        const view = state.camera;
        const forward = new THREE.Vector3();
        view?.getWorldDirection(forward);
        mesh.updateWorldMatrix(true, false);
        const point = new THREE.Vector3();
        const positions = mesh.geometry.getAttribute('position');
        const depths = Array.from({length:n}, (_,i) => {
            point.set(positions.getX(i*vertices),positions.getY(i*vertices),positions.getZ(i*vertices)).applyMatrix4(mesh.matrixWorld);
            return point.dot(forward);
        });
        hoverOpacity = stackCellOpacities(depths, index);
        // Ghost faces use a separate pass without depth writes.
        if (ghostMesh) ghostMesh.visible=index !== null;
        for (let i=0;i<n;i++) {
            cellOpacity.fill(hoverOpacity[i]!, i*vertices, (i+1)*vertices);
            for (const layer of [cellTextPlanes[i], indexTextPlanes[i]]) if (layer) {
                layer.mesh.material.depthTest = i !== index;
                layer.mesh.renderOrder = i === index ? 10 : 0;
            }
            if (labels[i] && !planeText) labels[i]!.el.style.opacity = String(hoverOpacity[i]);
            if (indexLabels[i] && !planeText) indexLabels[i]!.el.style.opacity = String(hoverOpacity[i]);
        }
        opacityAttribute.needsUpdate = true;
        const rims = glowMesh.geometry.getAttribute('cellOpacity');
        if (rims) { for(let v=0;v<rimCells.length;v++) rims.setX(v, hoverOpacity[rimCells[v]!] ?? 1); rims.needsUpdate = true; }
    }
    try{entry._rebuildFn?.();}catch(error){console.warn('array:',error);}
    const canvas = state.renderer?.domElement;
    const disposeHover = el.hoverReveal && canvas ? registerStackHover(canvas, () => state.camera, {
        mesh, select: selectCell, visible() {
            if (animState.stopped || animState.hiddenByRemove || material.opacity <= 0) return false;
            for (let part: Object3D | null = mesh; part; part=part.parent) if (!part.visible) return false;
            return true;
        },
    }) : null;
    // Shader/lifecycle resources follow the same registry as tensor boxes.
    material.addEventListener('dispose',()=>{
        disposeHover?.();
        ghostMaterial?.dispose();
        unit.dispose();
        for(const layer of [...cellTextPlanes,...indexTextPlanes,titlePlane,emptyPlane])layer?.dispose();
    });
    if(entry.exprStrings?.length)registerAnimExpr(entry);
    return {_animState:animState,_animExprEntry:entry,type:el.type};
}
