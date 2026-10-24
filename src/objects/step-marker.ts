/** State-bound annotations. Projection/grouping belongs to the common label layer. */
import { addLabel3D, colorToCSS } from '/labels.js';
import { labelDragHandler } from '/objects/label-drag.js';
import { announceLabelChange } from '/label-tooltip.js';
import { resolveCodeRef } from '/code-panel-model.js';
import { state } from '/state.js';
import { annotationText } from '/annotation-layout.js';
import { flashSymbols, rowSymbolKeys } from '/code-symbols.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element, LessonFormat } from '/types/lesson.js';

/** An owning renderer supplies layout and owns registration/teardown. */
export interface MarkerOwner {
    group: string;
    animState: {stopped: boolean};
    position(index: number): number[] | null;
    corners(index: number): number[][];
    /** The cell edge a marker hangs from: 'top' (default), or 'right' for a column whose keys are on the left. */
    edge?: 'top' | 'right';
    /** What a marker on this cell reads after `name =` when it has no valueExpr: a dict's key; null for the index. */
    indexText?(index: number): string | null;
}
export function renderStepMarker(el: Element, _view: MathBoxNode, owner?: MarkerOwner) {
    const marker = el.type === 'step_marker';
    const codeRef = !marker ? el.codeRef : undefined;
    const codeFns = new Map<string, ReturnType<typeof compileExpr>>();
    // connectTo is one target or a list of them; each becomes its own wire.
    // An object-less target belongs to graphs (a node of the same graph); a label always names its target.
    const connections = (marker || !el.connectTo ? [] : Array.isArray(el.connectTo) ? el.connectTo : [el.connectTo])
        .filter(c => 'positionExpr' in c || 'object' in c);
    const wires = connections.map(c => 'positionExpr' in c
        ? {kind:'position' as const, fns:c.positionExpr.map(source=>compileExpr(source))}
        : {kind:'object' as const, object:c.object, index:c.indexExpr ? compileExpr(c.indexExpr) : null});
    const targetSources = connections.flatMap(c => 'positionExpr' in c ? c.positionExpr : c.indexExpr ? [c.indexExpr] : []);
    const position = owner ? [] : el.positionExpr ?? (el.position ?? [0,0,0]).map(String);
    const sources = [...position, ...(el.textExpr ? [el.textExpr] : []), ...(el.visibleExpr ? [el.visibleExpr] : []), ...(el.indexExpr ? [el.indexExpr] : []), ...(marker && el.valueExpr ? [el.valueExpr] : []), ...(!marker && el.highlightExpr ? [el.highlightExpr] : []), ...(!marker && el.tooltipExpr ? [el.tooltipExpr] : []), ...(codeRef?.lineExpr ? [codeRef.lineExpr] : []), ...(codeRef?.fileExpr ? [codeRef.fileExpr] : []), ...targetSources];
    const positionFns = position.map(source => compileExpr(source));
    const textFn = el.textExpr ? compileExpr(el.textExpr) : null;
    const visibleFn = el.visibleExpr ? compileExpr(el.visibleExpr) : null;
    const indexFn = el.indexExpr ? compileExpr(el.indexExpr) : null;
    // An index marker's valueExpr: what the badge reads after `name =`, e.g. the value at that cell. The index still places it.
    const shownFn = marker && el.valueExpr ? compileExpr(el.valueExpr) : null;
    const highlightFn = !marker && el.highlightExpr ? compileExpr(el.highlightExpr) : null;
    const tooltipFn = !marker && el.tooltipExpr ? compileExpr(el.tooltipExpr) : null;
    const animState = owner?.animState ?? {stopped:false};
    const label = addLabel3D('', [0,0,0], undefined, {cssClass: marker ? 'label-3d step-marker' : 'label-3d expression-label'});
    if (!marker) label.snapToProjection = true;
    const cursor = document.createElement('span'); cursor.className = marker ? 'step-marker-cursor' : 'expression-label-cursor';
    const badge = document.createElement('span'); badge.className = 'annotation-badge';
    const measure = document.createElement('span'); measure.className = 'annotation-badge annotation-measure'; measure.setAttribute('aria-hidden','true');
    if(!marker&&el.connectTo)measure.classList.add('annotation-measure-wired');
    cursor.append(badge);
    if (owner) cursor.classList.add('array-marker-cursor');
    if (owner?.edge === 'right') cursor.classList.add('array-marker-right');
    const edge = owner?.edge ?? 'top';
    if (marker) {
        const stem = document.createElement('span'); stem.className='step-marker-stem'; stem.setAttribute('aria-hidden','true');
        const pointer = document.createElement('span'); pointer.className='step-marker-pointer'; pointer.setAttribute('aria-hidden','true'); cursor.append(stem, pointer);
    }
    label.el.replaceChildren(cursor, measure);
    label.el.style.setProperty('--marker-color', colorToCSS(el.color ?? (marker ? '#f1c65b' : '#172e50')));
    label.annotation = {kind: marker ? 'marker' : 'label', text: '', badge, measure, width: 0, height: 0, scale: null, rendered: ''};
    if (!marker) label.annotation.startDrag = labelDragHandler(label, animState);
    if (!marker) label.annotation.prompt = el.prompt ?? null;
    if(wires.length){
        label.wireTargets=wires.map(w=>w.kind==='object'?{object:w.object}:{});
        label.wireTarget=label.wireTargets[0];
    }
    if(connections.some(c=>c.pinned))label.wirePinned=true;
    // Experiment: an array marker glides to its new cell between execution steps instead of jumping.
    let slide = 0;
    const slideTo = (target: number[][]) => {
        const from = label.cellAttachment?.corners;
        cancelAnimationFrame(slide);
        if (!from || from.length !== target.length) {
            label.cellAttachment = {corners:target, edge, gap:8}; return;
        }
        if (from.every((p, i) => p.every((v, k) => v === target[i]![k]))) return;
        const start = performance.now(), duration = 260;
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / duration), e = 1 - (1 - t) ** 3;
            label.cellAttachment = {corners:from.map((p, i) => p.map((v, k) => v + (target[i]![k]! - v) * e)), edge, gap:8};
            if (t < 1 && !animState.stopped) slide = requestAnimationFrame(step);
        };
        slide = requestAnimationFrame(step);
    };
    const entry: AnimExprEntry = {animState, exprStrings:sources, _rebuildFn:()=>{
        if (animState.stopped) return;
        try {
            if(wires.length){
                label.wireTargets=wires.map(w=>{
                    if(w.kind==='object')return w.index?{object:w.object,index:Number(evalExpr(w.index,0))}:{object:w.object};
                    const target=w.fns.map(fn=>Number(evalExpr(fn,0)));
                    return target.every(Number.isFinite)?{position:target as [number,number,number]}:{};
                });
                label.wireTarget=label.wireTargets[0];
            }
            const indexValue = indexFn ? Number(evalExpr(indexFn,0)) : null;
            const point = owner ? owner.position(indexValue ?? NaN) : positionFns.map(fn => Number(evalExpr(fn,0)));
            if (!point) { label.forceHidden = true; return; }
            if (point.length !== 3 || point.some(n => !Number.isFinite(n))) throw new Error('Invalid annotation position');
            // Position bindings reclaim placement when their value changes.
            // Text-only updates preserve the user's dragged position and row order.
            if (!marker && point.some((value, index) => value !== label.dataPos[index])) {
                label.annotationPosition = undefined;
                label.annotationWorldPosition = undefined;
                label.annotationOrder = undefined;
            }
            label.dataPos = point;
            if (owner) slideTo(owner.corners(indexValue!));
            label.forceHidden = visibleFn ? !evalExpr(visibleFn,0) : false;
            const text = textFn ? annotationText(evalExpr(textFn,0)) : el.text ?? '';
            const annotation = label.annotation!; // Created above for the lifetime of this renderer.
            annotation.index = undefined;
            if (indexFn && el.indexName && (owner || el.indexGroup)) {
                const value = indexValue!; // Evaluated above when indexFn is present.
                if (!Number.isInteger(value) || value < 0) throw new Error('Invalid index');
                annotation.index = {group:owner?.group ?? el.indexGroup!, name:el.indexName, value};
                if (shownFn) annotation.index.shown = annotationText(evalExpr(shownFn,0));
                else { const key = owner?.indexText?.(value); if (key != null) annotation.index.shown = key; }
            }
            const previous = annotation.text;
            annotation.text = annotation.index ? `${annotation.index.name} = ${annotation.index.shown ?? annotation.index.value}` : text;
            if (highlightFn) annotation.highlighted = !!evalExpr(highlightFn,0);
            if (tooltipFn) { try { annotation.tooltip = String(evalExpr(tooltipFn,0)); } catch { annotation.tooltip = ''; } }
            if (codeRef) {
                const target = resolveCodeRef((state.lessonSpec as LessonFormat | null)?.codeFiles ?? [], codeRef, expr => {
                    if (!codeFns.has(expr)) codeFns.set(expr, compileExpr(expr));
                    return evalExpr(codeFns.get(expr)!, 0);
                });
                annotation.code = target ? {fileId: target.file.id, path: target.file.path, line: target.line} : null;
            }
            // A recalculated value briefly shows how it was computed; first display does not.
            if (tooltipFn && previous && previous !== annotation.text && annotation.tooltip) announceLabelChange(label);
            // A recalculated value lights its variable on the executing line in the Code panel.
            if (previous && previous !== annotation.text) flashSymbols(rowSymbolKeys(annotation.text));
            if (measure.textContent !== annotation.text) {
                measure.textContent = annotation.text; annotation.scale = null;
            }
        } catch { label.forceHidden = true; }
    }};
    if (!owner) { registerAnimExpr(entry); entry._rebuildFn?.(); }
    return {_animState:animState, _animExprEntry:entry, type:el.type};
}
