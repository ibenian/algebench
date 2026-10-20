/**
 * An element's `connectTo`, compiled once and evaluated on state changes into cell-link groups. Shared by the
 * owners of cells (arrays, stacks) and nodes (graphs), so links mean the same everywhere: each entry's indexExpr
 * runs per cell with `idx` and `value` bound and may name one index or a list; colorExpr / highlightExpr style
 * each link, with `to` bound as well. A graph entry may omit `object`: the link stays in the same graph.
 */
import { compileExpr, evalExpr } from '/expr.js';
import { colorToCSS } from '/labels.js';
import type { CellLinkGroup } from '/cell-links.js';
import type { Element } from '/types/lesson.js';

type Target = Exclude<NonNullable<Element['connectTo']>, unknown[]>;
type Fn = ReturnType<typeof compileExpr>;
interface Compiled { object: string; index: Fn; color?: Fn; lit?: Fn; bend?: Fn; arc?: Fn[]; port?: Fn; base: string; arrow: boolean; pinned: boolean; sources: string[] }

/** Compile the entries that link cells; `self` is the owner's id, used where an entry names no object. */
export function compileLinkTargets(connectTo: Element['connectTo'], self: string | undefined, allowSelf: boolean): Compiled[] {
    if (!self || !connectTo) return [];
    return (Array.isArray(connectTo) ? connectTo : [connectTo]).flatMap((c: Target) => {
        if (!('indexExpr' in c) || !c.indexExpr || 'positionExpr' in c) return [];
        const object = 'object' in c ? c.object : allowSelf ? self : null;
        if (!object) return [];
        const color = 'colorExpr' in c ? c.colorExpr : undefined, lit = 'highlightExpr' in c ? c.highlightExpr : undefined;
        const bend = 'bendExpr' in c ? c.bendExpr : undefined, arc = 'arcCenterExpr' in c ? c.arcCenterExpr : undefined, port = 'fromPortExpr' in c ? c.fromPortExpr : undefined;
        return [{
            object, index: compileExpr(c.indexExpr), base: c.color ? colorToCSS(c.color) : '#9dbde3',
            color: color ? compileExpr(color) : undefined, lit: lit ? compileExpr(lit) : undefined,
            bend: bend ? compileExpr(bend) : undefined, arc: arc?.length === 3 ? arc.map(e => compileExpr(e)) : undefined, port: port ? compileExpr(port) : undefined,
            arrow: !!c.arrow, pinned: !!c.pinned, sources: [c.indexExpr, color, lit, bend, port, ...(arc ?? [])].filter((s): s is string => !!s),
        }];
    });
}

// Entries that are not valid indices are dropped, but slots keep their places: [-1, 4] puts node 4 in slot 1.
const indices = (result: unknown): number[] => {
    const plain = result !== null && typeof result === 'object' && 'valueOf' in result ? (result as {valueOf(): unknown}).valueOf() : result;
    return (Array.isArray(plain) ? plain.flat(Infinity) : [plain]).map(Number).map(j => Number.isInteger(j) && j >= 0 ? j : -1);
};

/** Evaluate every entry for these cell values: one link group per entry, styled per link when it asks. */
export function evaluateLinkTargets(targets: Compiled[], values: unknown[], extra: Partial<CellLinkGroup> = {}): CellLinkGroup[] {
    return targets.map(t => {
        const pairs: [number, number][] = [], styles: ({color?: string; lit?: boolean; bend?: number; arcCentre?: number[]; port?: number} | null)[] = [];
        values.forEach((value, i) => {
            let targetsOf: number[] = [];
            try { targetsOf = indices(evalExpr(t.index, 0, {overrideScope: {idx: i, value}})); } catch { /* no link for this cell */ }
            // `slot`: the target's place in the list indexExpr returned (a B-tree node's child i leaves port i).
            targetsOf.forEach((j, slot) => {
                if (j < 0) return;
                pairs.push([i, j]);
                if (!t.color && !t.lit && !t.bend && !t.arc && !t.port) { styles.push(null); return; }
                const scope = {overrideScope: {idx: i, value, to: j, slot}};
                const style: {color?: string; lit?: boolean; bend?: number; arcCentre?: number[]; port?: number} = {};
                try { const c = t.color ? evalExpr(t.color, 0, scope) : ''; if (typeof c === 'string' && c) style.color = c; } catch { /* keep the entry's colour */ }
                try { style.lit = t.lit ? !!evalExpr(t.lit, 0, scope) : false; } catch { /* not lit */ }
                // Route: an arc round a finite centre, else this edge's own bow; NaN anywhere means "not this edge".
                try { const b = t.bend ? Number(evalExpr(t.bend, 0, scope)) : NaN; if (Number.isFinite(b)) style.bend = b; } catch { /* the graph's bend */ }
                try { const c = t.arc?.map(fn => Number(evalExpr(fn, 0, scope))); if (c?.every(Number.isFinite)) style.arcCentre = c; } catch { /* not an arc */ }
                try { const q = t.port ? Number(evalExpr(t.port, 0, scope)) : NaN; if (Number.isInteger(q) && q >= 0) style.port = q; } catch { /* no port */ }
                styles.push(style);
            });
        });
        return {to: t.object, pairs, color: t.base, ...(t.arrow ? {arrow: true} : {}), ...(styles.some(Boolean) ? {styles} : {}), ...extra};
    });
}
