/** State-bound annotations. Projection/grouping belongs to the common label layer. */
import { addLabel3D, colorToCSS } from '/labels.js';
import { labelDragHandler } from '/objects/label-drag.js';
import { announceLabelChange } from '/label-tooltip.js';
import { annotationText } from '/annotation-layout.js';
import { compileExpr, evalExpr } from '/expr.js';
import { registerAnimExpr } from '/sliders.js';
import type { AnimExprEntry } from '/sliders.js';
import type { Element } from '/types/lesson.js';

/** An owning renderer supplies layout and owns registration/teardown. */
export interface MarkerOwner {
    group: string;
    animState: {stopped: boolean};
    position(index: number): number[] | null;
    corners(index: number): number[][];
}
export function renderStepMarker(el: Element, _view: MathBoxNode, owner?: MarkerOwner) {
    const marker = el.type === 'step_marker';
    const targetPosition = !marker && el.connectTo && 'positionExpr' in el.connectTo ? el.connectTo.positionExpr : [];
    const targetFns = targetPosition.length ? targetPosition.map(source=>compileExpr(source)) : null;
    const targetIndex = !marker && el.connectTo && 'object' in el.connectTo && el.connectTo.indexExpr ? compileExpr(el.connectTo.indexExpr) : null;
    const position = owner ? [] : el.positionExpr ?? (el.position ?? [0,0,0]).map(String);
    const sources = [...position, ...(el.textExpr ? [el.textExpr] : []), ...(el.visibleExpr ? [el.visibleExpr] : []), ...(el.indexExpr ? [el.indexExpr] : []), ...(!marker && el.highlightExpr ? [el.highlightExpr] : []), ...(!marker && el.tooltipExpr ? [el.tooltipExpr] : []), ...targetPosition, ...(!marker && el.connectTo && 'object' in el.connectTo && el.connectTo.indexExpr ? [el.connectTo.indexExpr] : [])];
    const positionFns = position.map(source => compileExpr(source));
    const textFn = el.textExpr ? compileExpr(el.textExpr) : null;
    const visibleFn = el.visibleExpr ? compileExpr(el.visibleExpr) : null;
    const indexFn = el.indexExpr ? compileExpr(el.indexExpr) : null;
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
    if (marker) {
        const stem = document.createElement('span'); stem.className='step-marker-stem'; stem.setAttribute('aria-hidden','true');
        const pointer = document.createElement('span'); pointer.className='step-marker-pointer'; pointer.setAttribute('aria-hidden','true'); cursor.append(stem, pointer);
    }
    label.el.replaceChildren(cursor, measure);
    label.el.style.setProperty('--marker-color', colorToCSS(el.color ?? (marker ? '#f1c65b' : '#172e50')));
    label.annotation = {kind: marker ? 'marker' : 'label', text: '', badge, measure, width: 0, height: 0, scale: null, rendered: ''};
    if (!marker) label.annotation.startDrag = labelDragHandler(label, animState);
    if (!marker) label.annotation.prompt = el.prompt ?? null;
    if(!marker && el.connectTo && 'object' in el.connectTo)label.wireTarget={object:el.connectTo.object};
    if(!marker && el.connectTo?.pinned)label.wirePinned=true;
    const entry: AnimExprEntry = {animState, exprStrings:sources, _rebuildFn:()=>{
        if (animState.stopped) return;
        try {
            if(targetIndex)label.wireTarget!.index=Number(evalExpr(targetIndex,0));
            if(targetFns){
                const target=targetFns.map(fn=>Number(evalExpr(fn,0)));
                label.wireTarget = target.every(Number.isFinite) ? {position:target as [number,number,number]} : {};
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
            if (owner) label.cellAttachment = {corners:owner.corners(indexValue!), edge:'top', gap:8};
            label.forceHidden = visibleFn ? !evalExpr(visibleFn,0) : false;
            const text = textFn ? annotationText(evalExpr(textFn,0)) : el.text ?? '';
            const annotation = label.annotation!; // Created above for the lifetime of this renderer.
            annotation.index = undefined;
            if (indexFn && el.indexName && (owner || el.indexGroup)) {
                const value = indexValue!; // Evaluated above when indexFn is present.
                if (!Number.isInteger(value) || value < 0) throw new Error('Invalid index');
                annotation.index = {group:owner?.group ?? el.indexGroup!, name:el.indexName, value};
            }
            const previous = annotation.text;
            annotation.text = annotation.index ? `${annotation.index.name} = ${annotation.index.value}` : text;
            if (highlightFn) annotation.highlighted = !!evalExpr(highlightFn,0);
            if (tooltipFn) { try { annotation.tooltip = String(evalExpr(tooltipFn,0)); } catch { annotation.tooltip = ''; } }
            // A recalculated value briefly shows how it was computed; first display does not.
            if (tooltipFn && previous && previous !== annotation.text && annotation.tooltip) announceLabelChange(label);
            if (measure.textContent !== annotation.text) {
                measure.textContent = annotation.text; annotation.scale = null;
            }
        } catch { label.forceHidden = true; }
    }};
    if (!owner) { registerAnimExpr(entry); entry._rebuildFn?.(); }
    return {_animState:animState, _animExprEntry:entry, type:el.type};
}
