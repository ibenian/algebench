/** A typed one-dimensional array. One merged box mesh; expressions run on state changes. */
import { state } from '/state.js';
import { flashSymbols, setSymbolHover, hoveredSymbols, registerSymbolValue } from '/code-symbols.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D, parseColor, colorToCSS } from '/labels.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr, registerAnimUpdater } from '/sliders.js';
import { pipeFlowPhase } from '/objects/system-dag-flow.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';
import type { Mesh, Object3D } from 'three';
import { renderStepMarker } from '/objects/step-marker.js';
import { keyText } from '/objects/dict-keys.js';
import { roundedCellUnit } from '/objects/rounded-cell.js';
import { arrayCell, arrayLength, cellColor, dynamicArrayLength, arrayIndexPosition, arrayCellPosition, arrayCellCorners, wrappedArrayCell } from '/objects/array-data.js';
import { registerStackHover, stackCellOpacities } from '/objects/array-stack-hover.js';
import { ArrayChangeTracker } from '/objects/array-changes.js';
import { identityTracker } from '/objects/cell-identity.js';
import { createCellGlide } from '/objects/cell-glide.js';
import { setCellLinks } from '/cell-links.js';
import { compileLinkTargets, evaluateLinkTargets } from '/objects/link-targets.js';
import { createArrayPlaneText, clipArrayPlaneMirror } from '/objects/array-plane-text.js';
import type { ArrayPlaneText } from '/objects/array-plane-text.js';

let arrayMarkerGroup = 0;
/** Shared presentation lookup for a cell, without references to other controls. */
/** `vertical`: cells run up or down (a stack, a vertical layout), so links leave a cell's side, not its top. */
/** `graph`: the cells are free-standing nodes (a graph), so links run node to node; `round` nodes are discs. */
/** `ports`: where links may start on a cell (a graph node: under each gap of its cell row). */
function roundedUnit(w:number,h:number,r:number) {
    const {positions,normals}=roundedCellUnit(w,h,r),g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    return g;
}
export interface ArrayCellTarget { vertical:boolean; graph?:boolean; round?:boolean; at(index:number):{position:[number,number,number];corners:number[][]}|null; ports?(index:number):number[][]; }
const PALETTE={number:'#75bfe9',character:'#74d0c2',string:'#b69bea',text:'#b69bea',boolean:'#efa768',empty:'#8793a6'};
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
    const centre=(i:number):[number,number,number]=>el.arrayColumns?wrappedArrayCell(i,n,origin,pitch,el.arrayColumns,el.arrayHeight,el.arrayCellHeight).position:arrayCellPosition(i,origin,pitch,el.arrayLayout,el.direction,el.arraySpacing);
    const cellHeight=()=>el.arrayColumns?wrappedArrayCell(0,n,origin,pitch,el.arrayColumns,el.arrayHeight,el.arrayCellHeight).height:.68;
    // cellCornerRadius: rounded cells (a dict's entries), else plain boxes.
    const unit=el.cellCornerRadius?roundedUnit(pitch*.78,cellHeight(),Number(el.cellCornerRadius)):new THREE.BoxGeometry(1,1,1).toNonIndexed();
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
    const step=centre(1).map((v,i)=>v-centre(0)[i]!);
    const cellTarget:ArrayCellTarget={vertical:Math.abs(step[1]!)>Math.abs(step[0]!),at(index){
        const position=el.arrayColumns?(Number.isInteger(index)&&index>=0&&index<n?centre(index):null):arrayIndexPosition(index,n,origin,pitch,el.arrayLayout,el.direction,el.arraySpacing);
        return position?{position,corners:arrayCellCorners(position,pitch).map(c=>[c[0]!,position[1]+(c[1]!-position[1])*cellHeight()/.68,c[2]!])}:null;
    }};
    mesh.userData.arrayCellTarget=cellTarget;
    // Keys of a dict whose entries stack vertically sit left of their cells, in reading order down the column.
    const keysLeft=!!el.keyExpr&&cellTarget.vertical;
    const keyAt=(c:number[]):[number,number,number]=>keysLeft?[c[0]!-pitch*.78,c[1]!,c[2]!+.14]:[c[0]!,c[1]!-.34-.175,c[2]!+.14];
    state.three.scene.add(mesh);state.planeMeshes.push(mesh);
    const decoration=decorate?.(n,origin,pitch,mesh);
    // A world-space soft rim follows the cells without screen overlays or frame evaluation.
    const glowMaterial=new THREE.ShaderMaterial({
        transparent:true,depthWrite:false,side:THREE.DoubleSide,
        // The rim traces the cell's own edge, in data units: a rounded rectangle (radius 0 for a box). quad is the
        // glow quad's half size, cell the cell's.
        // phase: where the changed cells' rim is in its breath, one per second (as the system DAG's pipe flow).
        uniforms:{opacity:{value:1},phase:{value:0},quad:{value:new THREE.Vector2(pitch*.455,cellHeight()*.584)},cell:{value:new THREE.Vector2(pitch*.39,cellHeight()*.5)},
            radius:{value:Math.min(Number(el.cellCornerRadius??0),pitch*.39,cellHeight()*.5)}},
        vertexShader:`attribute float removed; attribute float cellOpacity; varying float stackOpacity; varying vec2 rimUV; varying float removedCell;
            void main(){rimUV=uv*2.0-1.0;removedCell=removed;stackOpacity=cellOpacity;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader:`uniform float opacity; uniform float phase; uniform vec2 quad; uniform vec2 cell; uniform float radius;
            varying float stackOpacity; varying vec2 rimUV; varying float removedCell;
            void main(){vec2 q=abs(rimUV*quad)-cell+radius;
                float d=length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;
                float rim=exp(-pow(d/0.045,2.0));
                vec3 light=mix(vec3(1.0,0.88,0.55),vec3(0.65,0.80,0.92),removedCell);
                float beat=0.6+0.4*cos(6.2831853*phase);
                float alpha=rim*mix(0.85*beat,0.35,removedCell)*opacity*stackOpacity;
                if(alpha<0.01)discard; gl_FragColor=vec4(light,alpha);}`,
    });
    const glowMesh=new THREE.Mesh(new THREE.BufferGeometry(),glowMaterial);
    glowMesh.onBeforeRender=()=>{glowMaterial.uniforms.opacity!.value=glowMaterial.opacity;};
    glowMesh.visible=false;glowMesh.userData.ignorePlaneOpacity=true;glowMesh.userData.targetOpacity=1;
    // Decorative rims must not alter wire anchors or capture object picking.
    glowMesh.userData.annotationTextPlane=true;glowMesh.raycast=()=>{};
    state.three.scene.add(glowMesh);state.planeMeshes.push(glowMesh);
    // A changed value's rim breathes softly, once a second, while it stays lit.
    registerAnimUpdater({animState:{get stopped(){return animState.stopped;}},updateFrame(nowMs){
        if(glowMesh.visible)glowMaterial.uniforms.phase!.value=pipeFlowPhase(nowMs);
    }});
    const changes=new ArrayChangeTracker();
    let illuminated=new Set<number>();
    let rimCells: number[] = [];
    function illuminate(changed:number[],removed:number[]){
        const positions:number[]=[],uv:number[]=[],removedFlags:number[]=[],rimOpacity:number[]=[];
        rimCells = [];
        // A wrapped grid's cells change height as rows are added: keep the rim on the cell's current edge.
        glowMaterial.uniforms.quad!.value.set(pitch*.455,cellHeight()*.584);glowMaterial.uniforms.cell!.value.set(pitch*.39,cellHeight()*.5);
        glowMaterial.uniforms.radius!.value=Math.min(Number(el.cellCornerRadius??0),pitch*.39,cellHeight()*.5);
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
    const addTextPlane=(width:number,height:number,color:NonNullable<Element['color']>,cell?:number,tag:boolean|'top'|'right'=false)=>{
        const layer=createArrayPlaneText(width,height,color,{tag});
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
            if(planeText){indexLabel.forceHidden=true;indexLabel.el.classList.add('array-plane-accessible');clipArrayPlaneMirror(indexLabel.el);indexTextPlanes.push(addTextPlane(el.keyExpr?pitch*.78:.7,.35,'#e1ecf7',i,keysLeft?'right':true));}
            indexLabel.el.setAttribute('aria-label',el.keyExpr?`Key of cell ${i}`:`Index ${i}`);
            if(keysLeft)indexLabel.el.classList.add('array-key-left');
            indexLabels.push(indexLabel);
            indexLabel.cellAttachment = {corners:arrayCellCorners(c,pitch),edge:keysLeft?'left':'bottom',gap:0};
        }
        return label;
    };
    const labels=Array.from({length:n},(_,i)=>makeCellLabel(i));
    let titleLabel: ReturnType<typeof addLabel3D>|undefined;
    const titleCentre=()=>{
        if(el.arrayColumns)return centre(Math.min(el.arrayColumns,n)-1);
        // A direction that runs mostly up or down: title above the top cell, not above the middle (it would sit on the cells).
        if(el.direction&&n>1){const first=centre(0),last=centre(n-1);if(Math.abs(last[1]-first[1])>Math.abs(last[0]-first[0]))return last[1]>first[1]?last:first;}
        return centre(Math.max(0,n-1)/(el.arrayLayout==='vertical'?1:2));
    };
    const titleWidth=Math.max(1,(el.label?.length??0)*.38);
    // labelSide 'left': the title belongs to the row it names, just left of cell 0 and right-aligned,
    // so it stays put as the array grows and lines up with sibling rows of any title length.
    const leftTitle=el.labelSide==='left'&&el.arrayLayout!=='vertical';
    const titlePosition=():[number,number,number]=>{
        if(leftTitle&&!el.labelPosition){
            const c=centre(0),gap=pitch*.39+.22;
            return [c[0]-gap-(planeText?titleWidth/2:0),c[1],c[2]+.14];
        }
        const at=el.labelPosition??titleCentre().map((value,i)=>value+(el.labelOffset??[0,.88,0])[i]!);
        return [Number(at[0])+(planeText&&el.align==='left'?titleWidth/2:planeText&&el.align==='right'?-titleWidth/2:0),Number(at[1]),Number(at[2])+.14];
    };
    // Row titles share one neutral ink so stacked rows read as a set; a top title keeps the array's colour.
    const titlePlane=planeText&&el.label?addTextPlane(titleWidth,.95,el.labelSide==='left'?'#b5c1cf':el.color??'#b5c1cf'):null;
    // A decorated array (a stack) says empty in its own words: no ∅ under its caption.
    const emptyPlane=planeText&&!decorate?addTextPlane(.7,.68,'#8793a6'):null;
    if(el.label){
        titleLabel = addLabel3D('',titlePosition(),'#b5c1cf',{align:leftTitle?'right':el.align,cssClass:`label-3d ${el.cssClass??''}`});
        if(planeText){titleLabel.forceHidden=true;titleLabel.el.classList.add('array-plane-accessible');clipArrayPlaneMirror(titleLabel.el);}
        titleLabel.el.textContent=el.label; titleLabel.snapToProjection=true;titleLabel.ownerMesh=mesh;
    }
    // The title's pointer target (code symbols, below); placed with the title.
    let titleHit: Mesh | null = null;
    const updateTitle=()=>{
        placeTitleHit();
        if(titleLabel)titleLabel.dataPos=titlePosition();
        if(titlePlane)titlePlane.set(el.label!,titlePosition()); // allocated only for a non-empty array label.
        if(emptyPlane){emptyPlane.mesh.visible=n===0;emptyPlane.set('∅',[origin[0]!,origin[1]!,origin[2]!+.14]);}
    };
    updateTitle();
    const animState:{stopped:boolean;hiddenByRemove?:boolean}={stopped:false};
    // Children share the owner's lifetime and never register independent updaters.
    const owner = {group: 'array-markers:' + arrayMarkerGroup++, animState,
        position: (index: number) => cellTarget.at(index)?.position??null,
        corners: (index: number) => cellTarget.at(index)?.corners??[],
        // A dict column has its keys on the left, so its markers hang off the right edge.
        edge: keysLeft ? 'right' as const : 'top' as const,
        // A dict's marker names the key it points at, not the entry's position.
        indexText: (index: number) => keyFn ? cellKeys[index] ?? null : null};
    const markers = (el.markers ?? []).map(marker => renderStepMarker({...marker, type:'step_marker'}, _view, owner));
    const valueFn=el.valueExpr?compileExpr(el.valueExpr):null;
    const highlightFn=el.highlightExpr?compileExpr(el.highlightExpr):null;
    const colorFn=el.colorExpr?compileExpr(el.colorExpr):null;
    // keyExpr (a dict): each cell's key, shown where an array shows its index.
    const keyFn=el.keyExpr?compileExpr(el.keyExpr):null;
    let cellKeys:(string|null)[]=[],valueText='[]';
    const previous: string[]=[];
    // animateMoves: a value that moves to another cell (a swap, a sift) glides there instead of being redrawn in
    // place; identity comes from idExpr, else values are matched (cell-identity). A wrapped grid re-flows its
    // cells as it resizes, so it keeps the plain redraw. Index tags, markers and links belong to cells: they stay.
    const idFn=el.idExpr?compileExpr(el.idExpr):null;
    const identities=el.animateMoves&&!el.arrayColumns?identityTracker(`${el.id ?? 'array'}:`):null;
    const glide=identities?createCellGlide({ms:Math.max(0,Number(el.animationMs??450)),stopped:()=>animState.stopped,draw:()=>placeCells()}):null;
    const cellText:string[]=[];
    const drawnAt=(i:number):[number,number,number]=>glide?glide.at(i,centre(i)):centre(i);
    function placeCells(){
        for(let i=0;i<n;i++){
            const c=drawnAt(i);
            for(let v=0;v<vertices;v++)positions.set(dataToWorld([c[0]+source.getX(v)*pitch*.78,c[1]+source.getY(v)*cellHeight(),c[2]+source.getZ(v)*.22]),(i*vertices+v)*3);
            const label=labels[i];if(label)label.dataPos=[c[0],c[1],c[2]+.14];
            if(planeText&&cellText[i]!==undefined)cellTextPlanes[i]?.set(cellText[i]!,[c[0],c[1],c[2]+.14]);
        }
        mesh.geometry.getAttribute('position').needsUpdate=true;mesh.geometry.computeBoundingSphere();
    }
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
    // connectTo: each cell links to the cell of another object it names (indexExpr with idx and value bound),
    // one link group per target. Only cell targets apply to an array; the schema rejects the others.
    const connections=compileLinkTargets(el.connectTo,el.id,false);
    const entry:AnimExprEntry={animState,exprStrings:[el.lengthExpr,el.valueExpr,el.highlightExpr,el.colorExpr,el.keyExpr,...connections.flatMap(c=>c.sources),...markers.flatMap(marker=>marker._animExprEntry.exprStrings ?? [])].filter((v):v is string=>!!v),_rebuildFn:()=>{
        // Hidden lesson steps must not advance the last-visible comparison baseline.
        if(animState.stopped||animState.hiddenByRemove)return;
        const next=lengthFn?dynamicArrayLength(evalExpr(lengthFn,0)):n;
        // Evaluate the whole next state before advancing the comparison baseline.
        const cells=Array.from({length:next},(_,i)=>{
            const cell=arrayCell(valueFn?evalExpr(valueFn,0,{overrideScope:{idx:i}}):el.values?.[i],el.itemType);
            const highlighted=highlightFn?!!evalExpr(highlightFn,0,{overrideScope:{idx:i,value:cell.value}}):false;
            const color=colorFn?cellColor(evalExpr(colorFn,0,{overrideScope:{idx:i,value:cell.value}})):null;
            let key:string|null=null;
            if(keyFn)try{key=keyText(evalExpr(keyFn,0,{overrideScope:{idx:i,value:cell.value}}));}catch{key='?';}
            return {cell,highlighted,color,key};
        });
        cellKeys=cells.map(c=>c.key);
        // What the array holds, as Python would print it: a list, or a dict when its cells have keys.
        valueText=cellKeys.some(k=>k!==null)?`{${cells.map(c=>`${c.key}: ${c.cell.text}`).join(', ')}}`:`[${cells.map(c=>c.cell.text).join(', ')}]`;
        const transition=JSON.stringify(Object.entries(state.sceneSliders).map(([id,s])=>[id,s.value,s.values]));
        const delta=changes.update(cells.map(({cell})=>JSON.stringify([cell.kind,cell.value])),transition);
        // Where each moving value was drawn, read before the resize and redraw move anything.
        const moves=identities?.next(cells.map(({cell})=>JSON.stringify([cell.kind,cell.value])),
            idFn?cells.map(({cell},i)=>String(evalExpr(idFn,0,{overrideScope:{idx:i,value:cell.value}}))):undefined);
        const before=moves?.size?new Map([...new Set(moves.values())].map(p=>[p,drawnAt(p)])):null;
        resize(next);
        if(delta){
            illuminated=new Set([...delta.changed,...delta.added]);
            illuminate([...illuminated],delta.removed);
            // Changed cells light the array's variable where it is executing (by id, or by its title).
            if(illuminated.size||delta.removed.length)flashSymbols([el.id,el.label,symbol].filter((v):v is string=>!!v));
        }
        updateTitle();
        decoration?.resize(next);
        if(connections.length){
            setCellLinks(el.id!,evaluateLinkTargets(connections,cells.map(({cell})=>cell.value)),connections.some(c=>c.pinned));
        }
        for (const marker of markers) marker._animExprEntry._rebuildFn?.();
        let dirty=false;
        for(let i=0;i<n;i++){
            const {cell,highlighted,color,key:cellKey}=cells[i]!; // one successfully evaluated cell per slot
            const lit=illuminated.has(i);
            const key=JSON.stringify([cell.kind,cell.value,highlighted,color,lit,cellKey]);
            const tag=cellKey??String(i);
            if(previous[i]===key)continue;previous[i]=key;dirty=true;
            const label=labels[i]!; // one label allocated per cell
            label.el.textContent=cell.text;label.el.title=`[${tag}] ${cell.kind}: ${cell.text}`;
            if(cellKey!==null&&indexLabels[i]){indexLabels[i]!.el.textContent=cellKey;indexLabels[i]!.el.setAttribute('aria-label',`Key ${cellKey}`);indexLabels[i]!.boxW=null;indexLabels[i]!.boxH=null;}
            label.el.setAttribute('aria-label',label.el.title);label.boxW=null;label.boxH=null;
            if(planeText){
                const c=centre(i);
                cellTextPlanes[i]!.set(cell.text,[c[0],c[1],c[2]+.14]); // makeCellLabel allocates one text plane per slot.
                indexTextPlanes[i]?.set(tag,keyAt(c));
            }
            const rgb=parseColor(color??(highlighted?'#f1cc59':el.color??PALETTE[cell.kind]));
            if(lit)for(let j=0;j<3;j++)rgb[j]=rgb[j]!+(1-rgb[j]!)*.35;
            for(let v=0;v<vertices;v++){
                const shade=normal.getZ(v)>0?1:normal.getY(v)>0?.78:.56;
                const k=(i*vertices+v)*3;colors[k]=rgb[0]!*shade;colors[k+1]=rgb[1]!*shade;colors[k+2]=rgb[2]!*shade;
            }
        }
        if(dirty)colorAttribute.needsUpdate=true;
        cells.forEach(({cell},i)=>{cellText[i]=cell.text;});
        if(glide&&moves){glide.moved(moves,p=>before?.get(p)??null);if(glide.moving)placeCells();}
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
    // Code symbols: the array is the variable named by codeSymbol (an expression such as adj[u], whitespace
    // removed), else by its id. Pointing at its cells or its title lights that variable in the Code panel;
    // pointing at the variable there (or at the array) lights the array's title.
    let symbolLit=false;
    const symbol=el.codeSymbol?el.codeSymbol.replace(/\s+/g,''):el.id;
    const pointing={cells:false,title:false};
    const point=(part:keyof typeof pointing,now:boolean)=>{
        const was=pointing.cells||pointing.title;
        pointing[part]=now;
        const is=pointing.cells||pointing.title;
        if(!symbol||is===was)return;
        // Clear only a hover this array set, never one coming from the code or another object.
        if(is)setSymbolHover([symbol]);else if(hoveredSymbols().length===1&&hoveredSymbols()[0]===symbol)setSymbolHover([]);
    };
    const shown=()=>{
        if (animState.stopped || animState.hiddenByRemove || material.opacity <= 0) return false;
        for (let part: Object3D | null = mesh; part; part=part.parent) if (!part.visible) return false;
        return true;
    };
    const disposeSymbolHover = symbol && canvas ? registerStackHover(canvas, () => state.camera, {mesh, visible:shown, select:index=>point('cells',index!==null)}) : null;
    // A plane title is drawn as text and never picked, so an invisible quad over it takes the pointer.
    // It stays out of the scene: the hover raycast reads its geometry directly, nothing else sees it.
    titleHit=symbol&&canvas&&titlePlane?new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide})):null;
    function placeTitleHit(){
        if(!titleHit)return;
        const [x,y,z]=titlePosition(),w=titleWidth/2,h=.95/2;
        const corners=[[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h]].map(([cx,cy])=>dataToWorld([cx!,cy!,z]));
        const positions=[0,1,2,0,2,3].flatMap(i=>corners[i]!);
        titleHit.geometry.dispose();titleHit.geometry=new THREE.BufferGeometry();
        titleHit.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    }
    placeTitleHit();
    // The Code panel's inline values read the array as its variable holds it, while it is shown.
    const disposeValue = symbol ? registerSymbolValue(symbol, () => shown() ? valueText : null) : null;
    const disposeTitleHover = titleHit && canvas ? registerStackHover(canvas, () => state.camera, {mesh:titleHit, visible:shown, select:index=>point('title',index!==null)}) : null;
    // A screen title is an HTML label: it takes the pointer itself.
    if(symbol&&titleLabel&&!planeText){
        titleLabel.el.style.pointerEvents='auto';
        titleLabel.el.addEventListener('pointerenter',()=>point('title',true));
        titleLabel.el.addEventListener('pointerleave',()=>point('title',false));
    }
    const onSymbolHover=()=>{
        const lit=!!symbol&&hoveredSymbols().includes(symbol);
        if(lit===symbolLit||animState.stopped)return;
        symbolLit=lit;
        titlePlane?.setHighlight(lit);
        titleLabel?.el.classList.toggle('array-title-symbol-hover',lit);
    };
    if(symbol)window.addEventListener('algebench:symbolhover',onSymbolHover);
    // Shader/lifecycle resources follow the same registry as tensor boxes.
    material.addEventListener('dispose',()=>{
        disposeHover?.();glide?.dispose();
        disposeSymbolHover?.();disposeTitleHover?.();disposeValue?.();titleHit?.geometry.dispose();
        window.removeEventListener('algebench:symbolhover',onSymbolHover);
        ghostMaterial?.dispose();
        unit.dispose();
        for(const layer of [...cellTextPlanes,...indexTextPlanes,titlePlane,emptyPlane])layer?.dispose();
    });
    if(entry.exprStrings?.length)registerAnimExpr(entry);
    return {_animState:animState,_animExprEntry:entry,type:el.type};
}
