/** Two spatial projections of one semantic state. No execution rules live here. */
import { state } from '/state.js';
import { addLabel3D } from '/labels.js';
import type { Label3D } from '/labels.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import { compareStates, heapInsertionSnapshots, interpolate, snapshotIndex, validateSnapshot } from '/algorithm/state.js';
import type { AlgorithmSnapshot, AlgorithmChanges } from '/algorithm/state.js';
import type { Element } from '/types/lesson.js';
import type { Mesh, BufferGeometry, MeshBasicMaterial } from 'three';

type ToyMesh = Mesh<BufferGeometry, MeshBasicMaterial>;
interface Block { mesh: ToyMesh; label: Label3D; position: Vec3; from: Vec3; to: Vec3; id: string; view: 'array' | 'tree' }
const COLORS = [0x57b8e8,0xba8bea,0x58c9a3,0xef9e65,0xe67db0,0x94bf68,0xf1cf58];
export function renderAlgorithmStructure(el: Element, _view: MathBoxNode) {
    const scene = state.three?.scene, canvas = state.renderer?.domElement;
    if (!scene || !canvas) return null;
    const array = el.arrayId ?? 'heap', slider = el.stateSlider ?? '';
    const animState = { stopped: false };
    const meshes: ToyMesh[] = [], labels: Label3D[] = [], blocks: Block[] = [];
    const identityColors = new Map<string, number>();
    let snapshots: AlgorithmSnapshot[] = [], current: AlgorithmSnapshot | null = null;
    let changes: AlgorithmChanges | null = null, selected = '', hovered = '', inputSignature = '', index = -1, started = 0;
    const scalar = (name: string | undefined, fallback: number) => name ? Number(state.sceneSliders[name]?.value ?? fallback) : fallback;
    const label = (text: string, pos: Vec3, fontSize = 15) => {
        const l = addLabel3D('',pos,'#e8edf6');
        l.el.textContent = text; l.el.style.fontSize = `${fontSize}px`; l.el.style.whiteSpace = 'nowrap';
        labels.push(l); return l;
    };
    const caption = label('',[0,4.3,0],17);
    caption.el.style.whiteSpace = 'normal'; caption.el.style.maxWidth = '380px';
    const setText = (l: Label3D, text: string) => {
        if (l.el.textContent !== text) { l.el.textContent = text; l.boxW = null; l.boxH = null; }
    };
    label('BINARY TREE · parent → child',[0,3.65,0],13);
    label('ARRAY A · zero-based slots',[-2.7,-1.3,0],13);
    const feedback = label('Hover to link · click to pin',[0,-4.6,0],13);
    const makeMesh = (geometry: BufferGeometry, color: number): ToyMesh => {
        const material = new THREE.MeshBasicMaterial({color,transparent:true,opacity:1});
        const mesh = new THREE.Mesh(geometry,material);
        mesh.userData.ignorePlaneOpacity = true; mesh.userData.targetOpacity = 1;
        scene.add(mesh); state.planeMeshes.push(mesh); meshes.push(mesh); return mesh;
    };
    const place = (mesh: ToyMesh, pos: Vec3) => mesh.position.set(...dataToWorld(pos));
    const unit = () => Math.abs(dataToWorld([1,0,0])[0] - dataToWorld([0,0,0])[0]);
    const layout = (slot: number, view: 'array' | 'tree'): Vec3 => {
        if (view === 'array') return [-3.9 + slot * 1.3,-2.05,0];
        const level = Math.floor(Math.log2(slot + 1)), first = 2 ** level - 1;
        return [((slot-first+0.5)/2**level-0.5)*8,2.7-level*1.55,0];
    };
    const listeners = new AbortController();
    function paint() {
        for (const b of blocks) {
            const active = b.id === (hovered || selected);
            const comparing = current?.execution.operands.includes(b.id);
            const moved = !!changes?.moves[b.id] && performance.now() - started < 900;
            b.mesh.material.color.setHex(active ? 0xffffff : comparing ? 0xffdb54 : moved ? 0xffb969 : (identityColors.get(b.id) ?? COLORS[0]!));
            b.label.el.style.color = active ? '#ffffff' : '#111827';
            b.label.el.style.background = active ? '#385c80' : '#ffffffdd';
            b.label.el.style.borderRadius = '5px'; b.label.el.style.padding = '1px 5px';
        }
        const id = hovered || selected;
        setText(feedback, id && current?.entities[id] ? `Same object: ${id} · value ${current.entities[id]!.value} · highlighted in both views` : 'Hover to link · click to pin · click empty space to clear');
    }
    const ensureBlocks = (states: AlgorithmSnapshot[]) => {
        for (const s of states) for (const id of Object.keys(s.entities)) {
            if (identityColors.has(id)) continue;
            identityColors.set(id,COLORS[identityColors.size % COLORS.length]!);
            for (const view of ['array','tree'] as const) {
                const geometry = new THREE.BoxGeometry(1,1,1);
                const normals = geometry.getAttribute('normal'), shades: number[] = [];
                for (let i=0;i<normals.count;i++) { const v = normals.getZ(i)>0 ? 1 : normals.getY(i)>0 ? 0.8 : 0.55; shades.push(v,v,v); }
                geometry.setAttribute('color',new THREE.Float32BufferAttribute(shades,3));
                const mesh = makeMesh(geometry,identityColors.get(id)!); mesh.material.vertexColors = true;
                const l = label('',[0,0,0],17); l.el.style.pointerEvents='auto'; l.el.style.cursor='pointer';
                l.el.addEventListener('pointerenter',()=>{hovered=id;paint();},{signal:listeners.signal});
                l.el.addEventListener('pointerleave',()=>{hovered='';paint();},{signal:listeners.signal});
                l.el.addEventListener('click',()=>{selected=selected===id?'':id;paint();},{signal:listeners.signal});
                blocks.push({mesh,label:l,position:[0,0,0],from:[0,0,0],to:[0,0,0],id,view});
            }
        }
    };
    // A fixed pool prevents allocating geometry while scrubbing; all resources
    // enter the normal scene-loader teardown registry.
    const edges = Array.from({length:15},()=>makeMesh(new THREE.CylinderGeometry(1,1,1,8),0x607896));
    const arrows = Array.from({length:2},()=>({shaft:makeMesh(new THREE.CylinderGeometry(1,1,1,8),0x7bdcdd),head:makeMesh(new THREE.ConeGeometry(1,1,10),0x7bdcdd),label:label('',[0,0,0])}));
    const variableLabels = [label('',[-1,-3.95,0]),label('',[1,-3.95,0])];
    const slots = Array.from({length:7},(_,i)=>label(String(i),[-3.9+i*1.3,-2.75,0],12));
    function segment(mesh: ToyMesh, a: Vec3, b: Vec3, radius: number) {
        const start=new THREE.Vector3(...dataToWorld(a)),end=new THREE.Vector3(...dataToWorld(b));
        const direction=end.clone().sub(start);
        mesh.position.copy(start.add(end).multiplyScalar(0.5));
        mesh.scale.set(radius*unit(),direction.length(),radius*unit());
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    }
    function selectSnapshot(next: number, now: number, reset: boolean) {
        const after = snapshots[next]; if (!after) return;
        const before = current ?? after;
        changes = compareStates(before,after); current=after; index=next; started=now;
        for (const b of blocks) {
            const slot=after.arrays[array]?.indexOf(b.id) ?? -1;
            b.mesh.visible=slot>=0; b.label.forceHidden=slot<0;
            if (slot<0) continue;
            b.to=layout(slot,b.view);
            b.from=reset ? b.to : before.entities[b.id] ? [...b.position] : [b.to[0],b.to[1]-0.6,b.to[2]+0.8];
            b.label.el.textContent=String(after.entities[b.id]?.value ?? '');
        }
        caption.el.textContent=`${next} / ${snapshots.length-1} · ${after.execution.phase}`;
        caption.boxW=null;
        // The renderer guard establishes canvas for this closure.
        // Consumers can use exactly the same structured change record without
        // inspecting colors, geometry, or the stored snapshot sequence.
        canvas!.dispatchEvent(new CustomEvent('algebench:algorithm-transition',{bubbles:true,detail:{elementId:el.id,before,after,changes}}));
        paint();
    }
    function update(now: number) {
        if (animState.stopped) return;
        const input=el.heapInsertion;
        const values=input ? state.sceneSliders[input.arraySlider]?.values : null;
        const key=input ? scalar(input.keySlider,5) : 5;
        const signature=JSON.stringify([values,key]);
        let reset=false;
        if (signature!==inputSignature) {
            inputSignature=signature;
            try {
                snapshots=input ? heapInsertionSnapshots(values ?? [8,12,10,20,15,18],key,array) : el.algorithmStates ?? [];
                snapshots.forEach(validateSnapshot);
                if (!snapshots.length) throw new Error('No execution snapshots.');
                if (snapshots.some(s=>(s.arrays[array]?.length ?? 0)>7)) throw new Error('This playground supports up to seven visible cells.');
                ensureBlocks(snapshots); reset=true; index=-1;
                slots.forEach(l=>{l.forceHidden=false;});
            } catch (error) {
                snapshots=[]; current=null; index=-1;
                caption.el.textContent=String(error instanceof Error ? error.message : error); caption.boxW=null;
                for (const m of meshes) m.visible=false;
                for (const l of labels) if(l!==caption) l.forceHidden=true;
                return;
            }
            labels.forEach(l=>{l.forceHidden=false;});
        }
        if (!snapshots.length) return;
        const next=snapshotIndex(scalar(slider,0),snapshots.length);
        if (next!==index) selectSnapshot(next,now,reset);
        if (!current) return;
        const seconds=scalar(el.motionSlider,0.7);
        const t=seconds>0 ? Math.min(1,(now-started)/(seconds*1000)) : 1;
        const depth=scalar(el.depthSlider,0.35), u=unit();
        for (const b of blocks) {
            if (!b.mesh.visible) continue;
            b.position=interpolate(b.from,b.to,t); place(b.mesh,b.position);
            b.mesh.scale.set(0.86*u,0.68*u,depth*u);
            b.label.dataPos=[b.position[0],b.position[1],b.position[2]+depth/2+0.04];
        }
        const tree=new Map(blocks.filter(b=>b.view==='tree' && b.mesh.visible).map(b=>[b.id,b.position]));
        edges.forEach((edge,i)=>{
            const r=current?.relations[i], a=r ? tree.get(r.from) : null,b=r ? tree.get(r.to) : null;
            edge.visible=!!a && !!b;
            if(a && b) {segment(edge,[a[0],a[1],-0.15],[b[0],b[1],-0.15],0.026);edge.material.color.setHex(r && changes?.relations[r.id] && t<1 ? 0xffbc64 : 0x607896);}
        });
        const refs=Object.entries(current.variables).filter(([,v])=>v.reference?.array===array);
        arrows.forEach((arrow,j)=>{
            const ref=refs[j]; arrow.shaft.visible=arrow.head.visible=!!ref; arrow.label.forceHidden=!ref;
            if(!ref)return;
            const [name,v]=ref, x=layout(v.value,'array')[0], y=-3.2;
            arrow.label.el.textContent=`${name} = ${v.value}`;arrow.label.dataPos=[x,y-0.15,0.25];
            segment(arrow.shaft,[x,y+0.12,0.1],[x,-2.55,0.1],0.018);
            place(arrow.head,[x,-2.48,0.1]);arrow.head.scale.set(0.08*u,0.15*u,0.08*u);
        });
        const scalars=Object.entries(current.variables).filter(([,v])=>!v.reference);
        variableLabels.forEach((l,i)=>{const item=scalars[i];l.el.textContent=item ? `${item[0]} = ${item[1].value}` : '';});
        paint();
    }
    const raycaster=new THREE.Raycaster();
    function pick(event: PointerEvent): string {
        if (!state.camera || animState.stopped) return '';
        const rect=canvas!.getBoundingClientRect(); // renderer guard above establishes canvas
        raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),state.camera);
        const hit=raycaster.intersectObjects(blocks.filter(b=>b.mesh.visible).map(b=>b.mesh),false)[0];
        return hit ? blocks.find(b=>b.mesh===hit.object)?.id ?? '' : '';
    }
    canvas.addEventListener('pointermove',e=>{hovered=e.buttons ? '' : pick(e);paint();},{signal:listeners.signal});
    canvas.addEventListener('pointerleave',()=>{hovered='';paint();},{signal:listeners.signal});
    let down: [number,number] | null=null;
    canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];},{signal:listeners.signal});
    canvas.addEventListener('pointerup',e=>{if(down && Math.hypot(e.clientX-down[0],e.clientY-down[1])<4){const id=pick(e);selected=id===selected?'':id;paint();}down=null;},{signal:listeners.signal});
    // Material disposal is the loader's established teardown hook, including
    // removal during backward navigation. Abort all DOM handlers with it.
    meshes[0]?.material.addEventListener('dispose',()=>listeners.abort());
    state.activeAnimUpdaters.push({animState,updateFrame:update});
    update(performance.now());
    return {_animState:animState,type:'algorithm_structure'};
}
