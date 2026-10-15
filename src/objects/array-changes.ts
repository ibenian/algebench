/** Brightness of the changed-cell rim at a moment: a subtle swell between `low` and 1 on a 1 s
 *  ease-in-out cycle (close to the chat speaker button's rhythm), so a highlight reads as alive without flashing. */
export function glowBreath(nowMs: number, periodMs = 1000, low = 0.65): number {
    const phase = (((nowMs % periodMs) + periodMs) % periodMs) / periodMs;
    return low + (1 - low) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase));
}

/** Compare visible slot values, preserving the last successful state across resizes. */
export interface ArrayChanges { changed: number[]; added: number[]; removed: number[]; }
export class ArrayChangeTracker {
    private previous: string[] | null = null;
    private transition = '';
    update(keys: string[], transition: string): ArrayChanges | null {
        if (this.previous === null) {
            this.previous = keys.slice(); this.transition = transition;
            return {changed:[],added:[],removed:[]};
        }
        const before = this.previous;
        if (this.transition === transition && before.length === keys.length && before.every((key,i)=>key===keys[i])) return null;
        const changes: ArrayChanges = {changed:[],added:[],removed:[]};
        for (let i=0;i<keys.length;i++) {
            if(i>=before.length)changes.added.push(i);
            else if(before[i]!==keys[i])changes.changed.push(i);
        }
        for(let i=keys.length;i<before.length;i++)changes.removed.push(i);
        this.previous=keys.slice(); this.transition=transition;
        return changes;
    }
}
