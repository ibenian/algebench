/** A fixed base and an open container that grows with its bottom-to-top cells; horizontal: closed on the left,
 *  growing to the right (cells at the array's horizontal pitch). The horizontal wall hugs cell 0, so the row
 *  title the array draws left of cell 0 (labelSide 'left') clears it and lines up with sibling rows. */
export function stackBounds(length:number,origin:number[],pitch:number,horizontal=false) {
    const [x,y,z]=origin as [number,number,number];
    if(horizontal)return {left:x-pitch*.39-.12,right:x+Math.max(0,length-1)*pitch+pitch*.39+.5,
        bottom:y-.46,top:y+.46,back:z-.2,front:z+.7};
    return {left:x-pitch*.39-.12,right:x+pitch*.39+.12,
        bottom:y-.5,top:y+Math.max(0,length-1)*.78+.55,back:z-.2,front:z+.7};
}
