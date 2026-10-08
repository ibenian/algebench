/** One state-bound stack owner; its cells reuse the array renderer. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import { addLabel3D } from '/labels.js';
import { renderArray } from '/objects/array.js';
import { stackBounds } from '/objects/stack-layout.js';
import type { Element } from '/types/lesson.js';
import type { Mesh } from 'three';

export function renderStack(el:Element,view:MathBoxNode) {
    if(el.shape && el.shape.length!==1)throw new Error('A stack needs a one-dimensional shape.');
    const lengthExpr=el.lengthExpr??String(el.shape?.[0]??el.values?.length??0);
    const cells:Element={...el,arrayLayout:'vertical',lengthExpr,showIndices:el.showIndices??false,label:undefined,
        markers:[...(el.markers??[]),...(el.showTop===false?[]:[{
            type:'step_marker' as const,indexName:'top slot',indexExpr:`(${lengthExpr}) - 1`,color:'#f1c65b',
        }])]};
    return renderArray(cells,view,(initial,origin,pitch,owner)=>{
        // Meshes and labels are created within this element's registry scope,
        // so hide/remove/dispose applies to the complete stack as one object.
        const color=el.containerColor??'#77bfae';
        const makeMesh=(opacity:number)=>{
            const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:false});
            const mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);
            mesh.userData.ignorePlaneOpacity=true;mesh.userData.targetOpacity=opacity;
            state.three!.scene.add(mesh);state.planeMeshes.push(mesh);
            return mesh;
        };
        const back=makeMesh(.12),base=makeMesh(.4),outline=makeMesh(.7);
        const title=addLabel3D(el.label??'stack',[origin[0]!,origin[1]!-1.5,origin[2]!],'#b5c1cf');
        title.ownerMesh=owner;title.snapToProjection=true;
        const empty=addLabel3D(el.emptyText??'empty',origin,'#8ca9a0',{cssClass:'label-3d array-cell-label'});
        empty.ownerMesh=owner;empty.snapToProjection=true;empty.el.setAttribute('aria-label','Empty stack');
        let previous=-1;
        const replace=(mesh:Mesh,quads:number[][][])=>{
            const positions:number[]=[];
            for(const q of quads)for(const i of [0,1,2,0,2,3])positions.push(...dataToWorld(q[i]! as [number,number,number]));
            const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
            mesh.geometry.dispose();mesh.geometry=geometry;
        };
        const resize=(length:number)=>{
            if(length===previous)return;previous=length;
            const b=stackBounds(length,origin,pitch),t=.035,z=b.back;
            replace(back,[[[b.left,b.bottom,z],[b.right,b.bottom,z],[b.right,b.top,z],[b.left,b.top,z]]]);
            replace(base,[[[b.left,b.bottom,z],[b.right,b.bottom,z],[b.right,b.bottom,b.front],[b.left,b.bottom,b.front]]]);
            // Thin planar strips make a U; the top remains open for push/pop.
            const rect=(left:number,bottom:number,right:number,top:number)=>[[left,bottom,z+.005],[right,bottom,z+.005],[right,top,z+.005],[left,top,z+.005]];
            replace(outline,[rect(b.left,b.bottom,b.left+t,b.top),rect(b.right-t,b.bottom,b.right,b.top),rect(b.left,b.bottom,b.right,b.bottom+t)]);
            empty.forceHidden=length!==0;
            // Scene fades also write opacity; remove the empty caption from
            // layout until the next empty state so a fade cannot reveal it.
            empty.el.style.display=length===0?'':'none';
        };
        resize(initial);return {resize};
    });
}
