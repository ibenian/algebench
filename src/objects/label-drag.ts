/** Independent screen placement for expression labels, including merged rows. */
import { state } from '/state.js';
import type { Label3D } from '/labels.js';
import { placeExpressionLabel, setExpressionLabelPosition } from '/labels.js';
import { annotationDragPosition } from '/annotation-layout.js';

export function labelDragHandler(label: Label3D, animState: {stopped: boolean}) {
    return (event: PointerEvent, members?: Label3D[]): void => {
        if (event.button !== 0 || animState.stopped || !state.renderer) return;
        const controls = state.controls;
        const canvas = state.renderer.domElement;
        const viewport = canvas.getBoundingClientRect();
        const row = (event.currentTarget as HTMLElement).getBoundingClientRect();
        // A merged row starts at its visible position, not its hidden data anchor.
        const start = {x: (row.left + row.right) / 2 - viewport.left, y: (row.top + row.bottom) / 2 - viewport.top};
        const moving = members ?? [label];
        const box=(event.currentTarget as HTMLElement).closest('.annotation-badge')?.getBoundingClientRect()??row;
        const groupStart={x:(box.left+box.right)/2-viewport.left,y:(box.top+box.bottom)/2-viewport.top};
        event.preventDefault();
        event.stopPropagation();
        const controller = new AbortController();
        const wasEnabled = controls?.enabled;
        if (controls) controls.enabled = false;
        document.body.classList.add('dragging-expression-label');
        moving.forEach(member => { member.annotationDragging = true; member.annotationDocked = true; });
        const end = () => {
            moving.forEach(member => { member.annotationDragging = false; });
            controller.abort();
            if (controls && wasEnabled !== undefined) controls.enabled = wasEnabled;
            document.body.classList.remove('dragging-expression-label');
        };
        const move = (e: PointerEvent) => {
            if (e.pointerId !== event.pointerId) return;
            if (animState.stopped) { end(); return; }
            e.preventDefault();
            e.stopPropagation();
            if (members) {
                const position=annotationDragPosition(groupStart.x+e.clientX-event.clientX,groupStart.y+e.clientY-event.clientY,box.width,box.height,canvas.clientWidth,canvas.clientHeight);
                moving.forEach(member => {
                    setExpressionLabelPosition(member, position.x, position.y);
                });
            } else {
                placeExpressionLabel(label, start.x + e.clientX - event.clientX, start.y + e.clientY - event.clientY, e.clientX, e.clientY);
            }
        };
        // Window listeners survive merging, which replaces the row DOM mid-drag.
        window.addEventListener('pointermove', move, {capture: true, signal: controller.signal});
        window.addEventListener('pointerup', e => { if (e.pointerId === event.pointerId) end(); }, {capture: true, signal: controller.signal});
        window.addEventListener('pointercancel', end, {signal: controller.signal});
        window.addEventListener('blur', end, {signal: controller.signal});
        window.addEventListener('algebench:navchange', end, {signal: controller.signal});
    };
}
