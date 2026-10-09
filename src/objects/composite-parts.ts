/** Register owned composite parts with the existing per-object Ask AI picker. */
import { state } from '/state.js';
import type { AppState } from '/state.js';
import type { Object3D } from 'three';
import type { Label3D } from '/labels.js';
export function registerCompositePart(id:string,parentId:string,view:MathBoxNode,meshes:Object3D[],labels:Label3D[],label:string,prompt?:string,type='system_dag') {
    let hidden=false;
    const tracker={group:view.group(),planeMeshes:meshes,labels,arrowMeshes:[] as AppState['arrowMeshes'],lineNodes:[],vectorLineNodes:[],axisLineNodes:[],pointNodes:[]};
    const entry={tracker,type,label,prompt:prompt??null,
        get hidden():boolean {return hidden||!!state.elementRegistry[parentId]?.hidden||state.legendToggledOff.has(parentId);},
        set hidden(value:boolean){hidden=value;}};
    state.elementRegistry[id]=entry;
    for(const mesh of meshes)mesh.userData.askObjectId=id;
    return entry;
}
