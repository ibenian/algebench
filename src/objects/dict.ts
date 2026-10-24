/**
 * dict: a dictionary drawn as an array whose cells are its entries in insertion order, with each entry's key
 * shown where an array shows its index. A key is any string, number or tuple (keyText prints it as Python
 * would: 'a', 3, (1, 2)). It is a thin wrapper: it renders a real array under the element's id with keyExpr
 * set and rounded cells (stacked down a column with keys on the left when arrayLayout is 'vertical'), so markers, label wires, links, highlights and animateMoves all work as they do on an array; a marker or
 * link names an entry by its position, which the scene's data gives alongside the key.
 */
import type { Element } from '/types/lesson.js';
import { renderArray } from '/objects/array.js';

export function renderDict(el: Element, view: MathBoxNode) {
    // Keys are wider than indices: a roomier cell by default, and values of any type.
    // Entries are rounded rectangles, so a dict reads apart from an array at a glance. arrayLayout 'vertical'
    // stacks them down a column, first entry on top, each key to the left of its cell; the title sits above.
    const vertical = el.arrayLayout === 'vertical';
    return renderArray({...el, type: 'array', itemType: el.itemType ?? 'mixed', cellSize: el.cellSize ?? 1.6,
        labelSide: el.labelSide ?? (vertical ? 'top' : 'left'), keyExpr: el.keyExpr ?? 'idx', cellCornerRadius: el.cellCornerRadius ?? .2,
        ...(vertical ? {arrayLayout: 'horizontal', direction: el.direction ?? [0, -1, 0], arraySpacing: el.arraySpacing ?? .82} : {})}, view);
}
