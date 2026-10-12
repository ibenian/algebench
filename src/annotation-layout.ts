/** Presentation-only grouping. No renderer reads another renderer's state. */
/** Keep a dragged badge reachable, even when the pointer leaves the viewport. */
export function annotationDragPosition(x:number,y:number,width:number,height:number,viewportWidth:number,viewportHeight:number):{x:number;y:number} {
    const insetX=Math.min(viewportWidth/2,width/2+8);
    const insetY=Math.min(viewportHeight/2,height/2+8);
    return {x:Math.max(insetX,Math.min(viewportWidth-insetX,x)),y:Math.max(insetY,Math.min(viewportHeight-insetY,y))};
}
export interface AnnotationValue {
    text: string;
    index?: { group: string; name: string; value: number };
}
export interface AnnotationBox extends AnnotationValue {
    x: number; y: number; width: number; height: number;
    kind: 'marker' | 'label';
    detached?: boolean;
    coordinateMode?: 'world' | 'screen';
}
export function annotationText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
    // math.js matrices expose a JSON-friendly array through valueOf.
    const plain = typeof value === 'object' && value !== null ? value.valueOf() : value;
    return JSON.stringify(plain) ?? String(value);
}
export function annotationRows(items: AnnotationValue[]): string[] {
    const rows: string[] = [];
    const indexes = new Map<string, { row: number; names: string[]; value: number }>();
    for (const item of items) {
        if (!item.index) { rows.push(item.text); continue; }
        const {group, name, value} = item.index;
        const key = JSON.stringify([group, value]);
        const existing = indexes.get(key);
        if (existing) {
            if (!existing.names.includes(name)) existing.names.push(name);
            rows[existing.row] = [...existing.names, String(value)].join(' = ');
        } else {
            indexes.set(key, {row: rows.length, names: [name], value});
            rows.push(`${name} = ${value}`);
        }
    }
    return rows;
}
export function annotationGroups(items: AnnotationBox[]): number[][] {
    const parent = items.map((_, i) => i);
    const root = (i: number): number => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
        return i;
    };
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!, b = items[j]!;
        if (a.kind !== b.kind || a.detached || b.detached || a.coordinateMode !== b.coordinateMode) continue;
        const sameIndex = a.index && b.index && a.index.group === b.index.group && a.index.value === b.index.value;
        const overlaps = Math.abs(a.x-b.x) < (a.width+b.width)/2 && Math.abs(a.y-b.y) < (a.height+b.height)/2;
        // Markers merge only when they name the same index; markers on different
        // indexes never share a badge, however close (markerLifts separates them).
        if (sameIndex || (overlaps && a.kind === 'label')) parent[root(j)] = root(i);
    }
    const groups = new Map<number, number[]>();
    items.forEach((_, i) => { const r=root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(i); });
    return [...groups.values()];
}

/**
 * Upward lift, in px, for each marker badge so badges on different indexes never
 * overlap. Badges are placed left to right; one that would collide with a placed
 * badge climbs one badge height (plus a gap) at a time until it is clear. Its
 * pointer stretches into a stem, so it still points at its own cell.
 */
export function markerLifts(boxes: Pick<AnnotationBox,'x'|'y'|'width'|'height'>[], gap = 4): number[] {
    const lifts = boxes.map(() => 0);
    const placed: {x:number; y:number; width:number; height:number}[] = [];
    for (const i of boxes.map((_, i) => i).sort((a, b) => boxes[a]!.x - boxes[b]!.x || a - b)) {
        const b = boxes[i]!;
        let lift = 0;
        const hits = () => placed.some(p => Math.abs(p.x - b.x) < (p.width + b.width) / 2 + gap && Math.abs(p.y - (b.y - lift)) < (p.height + b.height) / 2 + gap);
        while (hits()) lift += b.height + gap;
        lifts[i] = lift;
        placed.push({x:b.x, y:b.y - lift, width:b.width, height:b.height});
    }
    return lifts;
}

/** Shared expression-label boxes track their members without changing their anchors. */
export function annotationGroupAnchor(items: Pick<AnnotationBox,'x'|'y'>[]): {x:number; y:number} {
    if (!items.length) throw new Error('A label group must have a member');
    return {x:items.reduce((sum,item)=>sum+item.x,0)/items.length,
        y:items.reduce((sum,item)=>sum+item.y,0)/items.length};
}

/** Insert a dragged row before the first row whose midpoint is below it. */
export function annotationInsertionIndex(midpoints: number[], y: number): number {
    const index = midpoints.findIndex(midpoint => y < midpoint);
    return index < 0 ? midpoints.length : index;
}

export function annotationContainerTitle(rows: string[]): 'Vars' | 'Labels' {
    return rows.length > 0 && rows.every(row => {
        const parts = row.split(/(?<![<>=!])=(?!=)/);
        return parts.length > 1 && parts.every(part => part.trim().length > 0);
    }) ? 'Vars' : 'Labels';
}

/** The tutor question behind a label row's Ask-AI button: the value as shown, how it was computed, and where the lesson is. */
export function labelAskMessage(o: {text: string; tooltip?: string; prompt?: string | null; scene?: string; step?: number; sliders?: Record<string, number>}): string {
    const lines = [`Explain this value shown in the scene: ${o.text}`];
    if (o.tooltip) lines.push(`How it is computed: $${o.tooltip}$`);
    if (o.prompt) lines.push(`About this label: ${o.prompt}`);
    if (o.scene) lines.push(`Current scene: ${o.scene}`);
    if (o.step !== undefined) lines.push(`Current lesson step: ${o.step + 1}`);
    if (o.sliders && Object.keys(o.sliders).length) lines.push(`Scalar variables: ${JSON.stringify(o.sliders)}`);
    return lines.join('\n');
}
