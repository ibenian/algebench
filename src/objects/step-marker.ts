/** State-bound annotations. Projection/grouping belongs to the common label layer. */
import { addLabel3D, colorToCSS } from '/labels.js';
import { labelDragHandler } from '/objects/label-drag.js';
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
    const position = owner ? [] : el.positionExpr ?? (el.position ?? [0,0,0]).map(String);
    const sources = [...position, ...(el.textExpr ? [el.textExpr] : []), ...(el.visibleExpr ? [el.visibleExpr] : []), ...(el.indexExpr ? [el.indexExpr] : [])];
    const positionFns = position.map(source => compileExpr(source));
    const textFn = el.textExpr ? compileExpr(el.textExpr) : null;
    const visibleFn = el.visibleExpr ? compileExpr(el.visibleExpr) : null;
    const indexFn = el.indexExpr ? compileExpr(el.indexExpr) : null;
    const animState = owner?.animState ?? {stopped:false};
    const label = addLabel3D('', [0,0,0], undefined, {cssClass: marker ? 'label-3d step-marker' : 'label-3d expression-label'});
    if (!marker) label.snapToProjection = true;
    const cursor = document.createElement('span'); cursor.className = marker ? 'step-marker-cursor' : 'expression-label-cursor';
    const badge = document.createElement('span'); badge.className = 'annotation-badge';
    const measure = document.createElement('span'); measure.className = 'annotation-badge annotation-measure'; measure.setAttribute('aria-hidden','true');
    cursor.append(badge);
    if (owner) cursor.classList.add('array-marker-cursor');
    if (marker) {
        const pointer = document.createElement('span'); pointer.className='step-marker-pointer'; pointer.setAttribute('aria-hidden','true'); cursor.append(pointer);
    }
    label.el.replaceChildren(cursor, measure);
    label.el.style.setProperty('--marker-color', colorToCSS(el.color ?? (marker ? '#f1c65b' : '#172e50')));
    label.annotation = {kind: marker ? 'marker' : 'label', text: '', badge, measure, width: 0, height: 0, scale: null, rendered: ''};
    if (!marker) label.annotation.startDrag = labelDragHandler(label, animState);
    const entry: AnimExprEntry = {animState, exprStrings:sources, _rebuildFn:()=>{
        if (animState.stopped) return;
        try {
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
            annotation.text = annotation.index ? `${annotation.index.name} = ${annotation.index.value}` : text;
            if (measure.textContent !== annotation.text) {
                measure.textContent = annotation.text; annotation.scale = null;
            }
        } catch { label.forceHidden = true; }
    }};
    if (!owner) { registerAnimExpr(entry); entry._rebuildFn?.(); }
    return {_animState:animState, _animExprEntry:entry, type:el.type};
}
