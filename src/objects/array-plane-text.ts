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
    /** A faint rounded tint behind the text (code-symbol hover), leaving the text colour as is. */
    setHighlight(on: boolean): void;
    /** Repaint now: the text to fit (opts.fitTo) may have changed though this plane's own text did not. */
    refit(): void;
    prepare(renderer: WebGLRenderer, camera: Camera): void;
    dispose(): void;
}

/** Uniform texel density preserves font proportions while bounding GPU memory. */
export function planeTextTextureSize(width:number,height:number,density=128):[number,number] {
    const scale=Math.min(Math.max(128,density),2048/width,2048/height,Math.sqrt(1048576/(width*height)));
    return [Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale))];
}

/**
 * `tag` paints the index-tag badge the screen mode draws in CSS (.array-index-tag): a dark plate with a
 * light outline, open on the edge that meets its cell and rounded on the far side, so world and screen tags
 * match. `true` or 'top' hangs it from the cell above (rounded lower corners); 'right' sets it left of its cell
 * (a dict's key in a column: open on the right, rounded on the left).
 */
export function createArrayPlaneText(width: number, height: number, color: NonNullable<Element['color']>, opts: {tag?: boolean | 'top' | 'right'; fitTo?: () => string} = {}): ArrayPlaneText {
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
    let highlighted=false;
    const projected=new THREE.Vector3(),bufferSize=new THREE.Vector2();
    function repaint(){
        ctx!.clearRect(0,0,canvas.width,canvas.height);
        const text=previousText??'';
        if(opts.tag==='right'){
            const w=canvas.width,h=canvas.height,line=Math.max(1,h*.06),r=Math.min(h*.35,w*.3),x1=w,y0=line/2,y1=h-line/2,x0=line/2;
            ctx!.beginPath();
            ctx!.moveTo(x1,y0);ctx!.lineTo(r,y0);ctx!.quadraticCurveTo(x0,y0,x0,r);ctx!.lineTo(x0,h-r);ctx!.quadraticCurveTo(x0,y1,r,y1);ctx!.lineTo(x1,y1);ctx!.closePath();
            ctx!.fillStyle='rgba(24, 48, 75, .9)';ctx!.fill();
            // The right edge meets the cell, so it has no border there.
            ctx!.beginPath();ctx!.moveTo(x1,y0);ctx!.lineTo(r,y0);ctx!.quadraticCurveTo(x0,y0,x0,r);ctx!.lineTo(x0,h-r);ctx!.quadraticCurveTo(x0,y1,r,y1);ctx!.lineTo(x1,y1);
            ctx!.strokeStyle='rgba(157, 189, 227, .45)';ctx!.lineWidth=line;ctx!.stroke();
        } else if(opts.tag){
            const w=canvas.width,h=canvas.height,line=Math.max(1,h*.06),r=Math.min(h*.35,w*.3);
            ctx!.beginPath();
            ctx!.moveTo(line/2,0);ctx!.lineTo(w-line/2,0);ctx!.lineTo(w-line/2,h-r);ctx!.quadraticCurveTo(w-line/2,h-line/2,w-r,h-line/2);
            ctx!.lineTo(r,h-line/2);ctx!.quadraticCurveTo(line/2,h-line/2,line/2,h-r);ctx!.closePath();
            ctx!.fillStyle='rgba(24, 48, 75, .9)';ctx!.fill();
            // The top edge meets the cell, so like the CSS badge it has no border there.
            ctx!.beginPath();ctx!.moveTo(line/2,0);ctx!.lineTo(line/2,h-r);ctx!.quadraticCurveTo(line/2,h-line/2,r,h-line/2);
            ctx!.lineTo(w-r,h-line/2);ctx!.quadraticCurveTo(w-line/2,h-line/2,w-line/2,h-r);ctx!.lineTo(w-line/2,0);
            ctx!.strokeStyle='rgba(157, 189, 227, .45)';ctx!.lineWidth=line;ctx!.stroke();
        }
        // fitTo: size the font for another text (a set's longest), so planes that share it share one font size.
        const sizing=opts.fitTo?.()||text;
        const px=fitPlainCellPx(canvas.width*(opts.tag?.72:1),canvas.height*(opts.tag?.95:1.25),size=>{ctx!.font=`600 ${size}px ui-monospace, monospace`;return ctx!.measureText(sizing).width;});
        ctx!.font=`600 ${px}px ui-monospace, monospace`;
        if(highlighted&&text){
            const w=Math.min(canvas.width,ctx!.measureText(text).width+px*.8),h=Math.min(canvas.height,px*1.35),r=px*.2;
            const x=(canvas.width-w)/2,y=(canvas.height-h)/2;
            ctx!.beginPath();ctx!.moveTo(x+r,y);ctx!.arcTo(x+w,y,x+w,y+h,r);ctx!.arcTo(x+w,y+h,x,y+h,r);ctx!.arcTo(x,y+h,x,y,r);ctx!.arcTo(x,y,x+w,y,r);ctx!.closePath();
            // The theme accent, like the Code panel's tint, so the highlight reads in light and dark themes.
            const accent=getComputedStyle(document.body).getPropertyValue('--accent-color').trim()||'#f1cc59';
            ctx!.fillStyle=accent;ctx!.globalAlpha=.28;ctx!.fill();ctx!.globalAlpha=1;
        }
        ctx!.fillStyle=cssColor;ctx!.textAlign='center';ctx!.textBaseline='middle';
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
    return {mesh,prepare,refit(){if(previousText!==undefined)repaint();},setHighlight(on){if(on!==highlighted){highlighted=on;repaint();}},set(text,position){
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
