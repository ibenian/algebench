// ============================================================
// plan-text.ts — plan text (titles, reasons) into the DOM, never as HTML.
//
// A plan can be imported from a file, so its text is untrusted. It is built
// as DOM: `$…$` / `$$…$$` math is rendered into its own element by KaTeX,
// everything else becomes text nodes. Nothing here assigns innerHTML.
// ============================================================

import { stripGlossaryMarkers } from '/glossary-core.js';

/** Fill `e` with `text`: math through KaTeX, the rest as text nodes. Returns `e`. */
export function planTextInto<E extends HTMLElement>(e: E, text: string | undefined): E {
    const src = stripGlossaryMarkers(String(text ?? ''));
    for (const part of src.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g)) {
        if (!part) continue;
        const display = part.startsWith('$$') && part.endsWith('$$') && part.length > 4;
        const inline = !display && part.length > 2 && part.startsWith('$') && part.endsWith('$');
        if (display || inline) {
            const math = document.createElement('span');
            try {
                katex.render(part.slice(display ? 2 : 1, display ? -2 : -1), math, { throwOnError: false, displayMode: display });
            } catch { math.textContent = part; }
            e.appendChild(math);
        } else {
            e.appendChild(document.createTextNode(part));
        }
    }
    return e;
}
