/** A fixed base and an open container that grows with its bottom-to-top cells. */
export function stackBounds(length:number,origin:number[],pitch:number) {
    const [x,y,z]=origin as [number,number,number];
    return {left:x-pitch*.39-.12,right:x+pitch*.39+.12,
        bottom:y-.5,top:y+Math.max(0,length-1)*.78+.55,back:z-.2,front:z+.7};
}
