/**
 * An element's `connectTo`, compiled once and evaluated on state changes into cell-link groups. Shared by the
 * owners of cells (arrays, stacks) and nodes (graphs), so links mean the same everywhere: each entry's indexExpr
 * runs per cell with `idx` and `value` bound and may name one index or a list; colorExpr / highlightExpr / widthExpr /
 * labelExpr style each link, with `to` bound as well. A graph entry may omit `object`: the link stays in the same graph.
 * objectExpr names the target per cell instead (a list of references to dicts, say: concat('person', idx)); without
 * indexExpr such a link points at the whole object rather than one of its cells.
 */
import { compileExpr, evalExpr } from '/expr.js';
import { colorToCSS } from '/labels.js';
import type { CellLinkGroup } from '/cell-links.js';
import type { Element } from '/types/lesson.js';

type Target = Exclude<NonNullable<Element['connectTo']>, unknown[]>;
type Fn = ReturnType<typeof compileExpr>;
interface Compiled { object: string; objectFn?: Fn; index: Fn | null; color?: Fn; lit?: Fn; bend?: Fn; arc?: Fn[]; port?: Fn; width?: Fn; label?: Fn; base: string; arrow: boolean; pinned: boolean; sources: string[] }

/** Compile the entries that link cells; `self` is the owner's id, used where an entry names no object. */
export function compileLinkTargets(connectTo: Element['connectTo'], self: string | undefined, allowSelf: boolean): Compiled[] {
    if (!self || !connectTo) return [];
    return (Array.isArray(connectTo) ? connectTo : [connectTo]).flatMap((c: Target) => {
        if ('positionExpr' in c) return [];
        const objectExpr = 'objectExpr' in c ? c.objectExpr : undefined;
        if (!objectExpr && (!('indexExpr' in c) || !c.indexExpr)) return [];
        const object = objectExpr ? '' : 'object' in c ? c.object : allowSelf ? self : null;
        if (object === null || object === undefined) return [];
        const indexExpr = 'indexExpr' in c ? c.indexExpr : undefined;
        const color = 'colorExpr' in c ? c.colorExpr : undefined, lit = 'highlightExpr' in c ? c.highlightExpr : undefined;
        const bend = 'bendExpr' in c ? c.bendExpr : undefined, arc = 'arcCenterExpr' in c ? c.arcCenterExpr : undefined, port = 'fromPortExpr' in c ? c.fromPortExpr : undefined;
        const width = 'widthExpr' in c ? c.widthExpr : undefined, label = 'labelExpr' in c ? c.labelExpr : undefined;
        return [{
            object, objectFn: objectExpr ? compileExpr(objectExpr) : undefined, index: indexExpr ? compileExpr(indexExpr) : null, base: c.color ? colorToCSS(c.color) : '#9dbde3',
            color: color ? compileExpr(color) : undefined, lit: lit ? compileExpr(lit) : undefined,
            bend: bend ? compileExpr(bend) : undefined, arc: arc?.length === 3 ? arc.map(e => compileExpr(e)) : undefined, port: port ? compileExpr(port) : undefined,
            width: width ? compileExpr(width) : undefined, label: label ? compileExpr(label) : undefined,
            arrow: !!c.arrow, pinned: !!c.pinned, sources: [objectExpr, indexExpr, color, lit, bend, port, width, label, ...(arc ?? [])].filter((s): s is string => !!s),
        }];
    });
}

// Entries that are not valid indices are dropped, but slots keep their places: [-1, 4] puts node 4 in slot 1.
const indices = (result: unknown): number[] => {
    const plain = result !== null && typeof result === 'object' && 'valueOf' in result ? (result as {valueOf(): unknown}).valueOf() : result;
    return (Array.isArray(plain) ? plain.flat(Infinity) : [plain]).map(Number).map(j => Number.isInteger(j) && j >= 0 ? j : -1);
};

/**
 * Evaluate every entry for these cell values: one link group per entry and target object, styled per link when it
 * asks. An entry with objectExpr makes a group per object its cells name; one without indexExpr links each cell to
 * the whole object (a pair [cell, 0] in a group marked `whole`).
 */
export function evaluateLinkTargets(targets: Compiled[], values: unknown[], extra: Partial<CellLinkGroup> = {}): CellLinkGroup[] {
    return targets.flatMap(t => {
        type Style = {color?: string; lit?: boolean; bend?: number; arcCentre?: number[]; port?: number; width?: number; label?: string} | null;
        const groups = new Map<string, {pairs: [number, number][]; styles: Style[]}>();
        const group = (object: string) => { let g = groups.get(object); if (!g) groups.set(object, g = {pairs: [], styles: []}); return g; };
        if (!t.objectFn) group(t.object);
        values.forEach((value, i) => {
            let object = t.object;
            if (t.objectFn) {
                try { object = String(evalExpr(t.objectFn, 0, {overrideScope: {idx: i, value}}) ?? ''); } catch { object = ''; }
                if (!object || object === '0') return;   // no target for this cell
            }
            let targetsOf: number[] = [];
            if (!t.index) targetsOf = [0];   // the whole object
            else try { targetsOf = indices(evalExpr(t.index, 0, {overrideScope: {idx: i, value}})); } catch { /* no link for this cell */ }
            const g = group(object);
            // `slot`: the target's place in the list indexExpr returned (a B-tree node's child i leaves port i).
            targetsOf.forEach((j, slot) => {
                if (j < 0) return;
                g.pairs.push([i, j]);
                if (!t.color && !t.lit && !t.bend && !t.arc && !t.port && !t.width && !t.label) { g.styles.push(null); return; }
                const scope = {overrideScope: {idx: i, value, to: j, slot}};
                const style: NonNullable<Style> = {};
                try { const c = t.color ? evalExpr(t.color, 0, scope) : ''; if (typeof c === 'string' && c) style.color = c; } catch { /* keep the entry's colour */ }
                try { style.lit = t.lit ? !!evalExpr(t.lit, 0, scope) : false; } catch { /* not lit */ }
                // Route: an arc round a finite centre, else this edge's own bow; NaN anywhere means "not this edge".
                try { const b = t.bend ? Number(evalExpr(t.bend, 0, scope)) : NaN; if (Number.isFinite(b)) style.bend = b; } catch { /* the graph's bend */ }
                try { const c = t.arc?.map(fn => Number(evalExpr(fn, 0, scope))); if (c?.every(Number.isFinite)) style.arcCentre = c; } catch { /* not an arc */ }
                try { const q = t.port ? Number(evalExpr(t.port, 0, scope)) : NaN; if (Number.isInteger(q) && q >= 0) style.port = q; } catch { /* no port */ }
                try { const w = t.width ? Number(evalExpr(t.width, 0, scope)) : NaN; if (Number.isFinite(w) && w > 0) style.width = Math.min(w, 12); } catch { /* default width */ }
                try { const l = t.label ? evalExpr(t.label, 0, scope) : ''; if (l !== '' && l != null) style.label = String(l); } catch { /* no label */ }
                g.styles.push(style);
            });
        });
        return [...groups].map(([to, g]) => ({to, pairs: g.pairs, color: t.base, ...(t.arrow ? {arrow: true} : {}), ...(!t.index ? {whole: true} : {}),
            ...(g.styles.some(Boolean) ? {styles: g.styles} : {}), ...extra}));
    });
}
