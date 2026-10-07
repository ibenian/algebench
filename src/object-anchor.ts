/** Presentation anchors resolved through the scene registry, without control coupling. */
import { state } from '/state.js';
import { dataToWorld } from '/coords.js';
import type { Vec3 } from '/coords.js';
import type { Object3D,Vector3,Mesh,BufferGeometry } from 'three';
import type { ArrayCellTarget } from '/objects/array.js';
interface AnchorNode {anchorDataPos?:number[];anchorDataPosFn?:()=>number[];pivotPoints?:number[][]}
interface AnchorTracker {
    planeMeshes?:Object3D[];
    arrowMeshes?:{mesh?:Object3D;tipWorld?:Vector3}[];
    labels?:{dataPos:number[]}[];
    lineNodes?:AnchorNode[];pointNodes?:AnchorNode[];axisLineNodes?:AnchorNode[];vectorLineNodes?:AnchorNode[];
}
const boundsVersions=new WeakMap<BufferGeometry,number>();
function worldBounds(tracker:AnchorTracker) {
    const bounds=new THREE.Box3();
    for(const mesh of [...tracker.planeMeshes??[],...(tracker.arrowMeshes??[]).flatMap(arrow=>arrow.mesh?[arrow.mesh]:[])]) {
        if(!mesh.visible||mesh.userData?.annotationTextPlane)continue;
        const geometry=(mesh as Mesh).geometry;
        const position=geometry?.getAttribute('position');
        const version=position?('version' in position?position.version:position.data.version):undefined;
        if(geometry&&version!==undefined&&boundsVersions.get(geometry)!==version){geometry.computeBoundingBox();boundsVersions.set(geometry,version);}
        bounds.expandByObject(mesh);
    }
    return bounds;
}
function namedObject(name:string) {
    const entries=Object.entries(state.elementRegistry);
    const named=entries.filter(([,reg])=>reg.label===name);
    const match=entries.find(([id])=>id===name)??(named.length===1?named[0]:undefined);
    if(!match||match[1].hidden||state.legendToggledOff.has(match[0]))return null;
    const meshes=(match[1].tracker as AnchorTracker).planeMeshes??[];
    // An empty array still has a title, but has no object to connect to.
    const array=meshes.find(mesh=>mesh.userData?.arrayCellTarget);
    if(array&&(!array.visible||!(array.userData.arrayCellTarget as ArrayCellTarget).at(0)))return null;
    return match;
}
export function objectTargetExists(name:string,index?:number):boolean {
    return index===undefined?!!namedObject(name):!!objectCellAnchor(name,index);
}
export function objectCellAnchor(name:string,index:number):{position:Vec3;corners:number[][]}|null {
    const match=namedObject(name);
    if(!match)return null;
    const tracker=match[1].tracker as AnchorTracker;
    for(const mesh of tracker.planeMeshes??[]) {
        const cells=mesh.userData.arrayCellTarget as ArrayCellTarget|undefined;
        if(mesh.visible&&cells)return cells.at(index);
    }
    return null;
}
/** World-space bounds for boundary attachment; never place a wire on centre text. */
export function objectWorldCorners(name:string):Vector3[] {
    const match=namedObject(name);
    if(!match)return [];
    const tracker=match[1].tracker as AnchorTracker;
    const bounds=worldBounds(tracker);
    if(bounds.isEmpty())return [];
    return [bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.y,bounds.max.y].flatMap(y=>
        [bounds.min.z,bounds.max.z].map(z=>new THREE.Vector3(x,y,z))));
}

/** Text-only objects use their visible label boundary when they have no mesh. */
export function objectLabelElement(name:string):HTMLElement|null {
    const match=namedObject(name);
    if(!match)return null;
    const tracker=match[1].tracker as {labels?:{el:HTMLElement;forceHidden?:boolean;annotationHidden?:boolean}[]};
    return tracker.labels?.find(label=>!label.forceHidden&&!label.annotationHidden&&label.el.isConnected)?.el??null;
}
/** Stable id first; display names must be unambiguous. Hidden targets have no anchor. */
export function objectWorldAnchor(name:string):Vector3|null {
    const match=namedObject(name);
    if(!match)return null;
    const animated=state.animatedElementPos[match[0]];
    if(animated)return new THREE.Vector3(...dataToWorld(animated.pos as Vec3));
    const tracker=match[1].tracker as AnchorTracker;
    const bounds=worldBounds(tracker);
    if(!bounds.isEmpty())return bounds.getCenter(new THREE.Vector3());
    for(const node of [...tracker.lineNodes??[],...tracker.pointNodes??[],...tracker.axisLineNodes??[],...tracker.vectorLineNodes??[]]) {
        const data=node.anchorDataPosFn?.()??node.anchorDataPos??node.pivotPoints?.[0];
        if(data)return new THREE.Vector3(...dataToWorld(data as Vec3));
    }
    const label=tracker.labels?.[0];
    return label?new THREE.Vector3(...dataToWorld(label.dataPos as Vec3)):null;
}
