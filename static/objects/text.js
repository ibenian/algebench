import { parseColor, addLabel3D } from '/labels.js';

export function renderText(el, view) {
    const text = el.text || el.value || '';
    const position = el.position || el.at || [0, 0, 0];
    const color = parseColor(el.color || '#ffffff');

    addLabel3D(text, position, color);

    return { type: 'text', color, label: text };
}
