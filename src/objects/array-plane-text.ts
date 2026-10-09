/** Text attached to an array's XY face, using the tensor's plain-text fitter. */
import { dataToWorld } from '/coords.js';
import { fitPlainCellPx } from '/objects/tensor.js';
import { parseColor } from '/labels.js';
import type { Element } from '/types/lesson.js';
import type { BufferGeometry, Mesh, MeshBasicMaterial, WebGLRenderer, Camera } from 'three';

/** Keep the accessibility mirror out of every visual pass, including step fades. */
export function clipArrayPlaneMirror(element: HTMLElement): void {
    // Fades write opacity directly; clipping cannot be undone by that animation.
    // Keep the text in the accessibility tree without relying on stylesheet freshness.
    element.style.clipPath = 'inset(50%)';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.overflow = 'hidden';
}

export interface ArrayPlaneText {
    mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
    set(text: string, position: [number, number, number]): void;
    prepare(renderer: WebGLRenderer, camera: Camera): void;
    dispose(): void;
}

/** Uniform texel density preserves font proportions while bounding GPU memory. */
export function planeTextTextureSize(width:number,height:number,density=128):[number,number] {
    const scale=Math.min(Math.max(128,density),2048/width,2048/height,Math.sqrt(1048576/(width*height)));
    return [Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale))];
}

export function createArrayPlaneText(width: number, height: number, color: NonNullable<Element['color']>): ArrayPlaneText {
    const canvas=document.createElement('canvas');
    [canvas.width,canvas.height]=planeTextTextureSize(width,height);
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Array plane text needs a 2D canvas.');
    const rgb=parseColor(color);
    const cssColor=`rgb(${rgb.map(v=>Math.round(v*255)).join(',')})`;
    const texture=new THREE.CanvasTexture(canvas);
    texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(18),3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1],2));
    const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);
    mesh.userData.annotationTextPlane=true;mesh.userData.ignorePlaneOpacity=true;mesh.userData.targetOpacity=1;
    // The owner's array mesh handles picking; transparent glyph margins are decorative.
    mesh.raycast=()=>{};
    let previousText: string|undefined;
    let previousPosition: string|undefined;
    let disposed=false;
    let resolutionDensity=128;
    const projected=new THREE.Vector3(),bufferSize=new THREE.Vector2();
    function repaint(){
        ctx!.clearRect(0,0,canvas.width,canvas.height);
        const text=previousText??'';
        const px=fitPlainCellPx(canvas.width,canvas.height*1.25,size=>{ctx!.font=`600 ${size}px ui-monospace, monospace`;return ctx!.measureText(text).width;});
        ctx!.font=`600 ${px}px ui-monospace, monospace`;ctx!.fillStyle=cssColor;ctx!.textAlign='center';ctx!.textBaseline='middle';
        ctx!.fillText(text,canvas.width/2,canvas.height/2);texture.needsUpdate=true;
    }
    function prepare(renderer:WebGLRenderer,camera:Camera){
        if(disposed||previousText===undefined)return;
        renderer.getDrawingBufferSize(bufferSize);
        const attribute=geometry.getAttribute('position');
        const corners:[number,number,number][]=[];
        for(const index of [0,1,2,5]){
            projected.set(attribute.getX(index),attribute.getY(index),attribute.getZ(index)).applyMatrix4(mesh.matrixWorld).project(camera);
            if(!Number.isFinite(projected.x)||!Number.isFinite(projected.y)||projected.z < -1||projected.z > 1)return;
            corners.push([(projected.x+1)*bufferSize.x/2,(1-projected.y)*bufferSize.y/2,projected.z]);
        }
        if(Math.max(...corners.map(p=>p[0]))<0||Math.min(...corners.map(p=>p[0]))>bufferSize.x||Math.max(...corners.map(p=>p[1]))<0||Math.min(...corners.map(p=>p[1]))>bufferSize.y)return;
        const distance=(a:number,b:number)=>Math.hypot(corners[a]![0]-corners[b]![0],corners[a]![1]-corners[b]![1]);
        const required=Math.max(distance(0,1)/width,distance(3,2)/width,distance(0,3)/height,distance(1,2)/height)*1.5;
        const density=Math.max(128,2**Math.ceil(Math.log2(required)));
        // Resolution tiers avoid repainting on every tiny camera movement.
        if(density===resolutionDensity)return;
        const [w,h]=planeTextTextureSize(width,height,density);
        resolutionDensity=density;
        if(w===canvas.width&&h===canvas.height)return;
        canvas.width=w;canvas.height=h;repaint();
    }
    mesh.onBeforeRender=(renderer,_scene,camera)=>prepare(renderer,camera);
    material.addEventListener('dispose',()=>texture.dispose());
    return {mesh,prepare,set(text,position){
        if(text!==previousText){
            previousText=text;repaint();
        }
        const key=position.join(':');
        if(key!==previousPosition){
            previousPosition=key;
            const attribute=geometry.getAttribute('position');
            const corners=[[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]];
            corners.forEach(([x,y],i)=>{const p=dataToWorld([position[0]+x!*width/2,position[1]+y!*height/2,position[2]]);attribute.setXYZ(i,...p);});
            attribute.needsUpdate=true;geometry.computeBoundingSphere();
        }
    },dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();geometry.dispose();material.dispose();}};
}
