// ============================================================
// Dockable Panel — a reusable positioned/draggable/resizable/
// collapsible chrome around a caller-provided body element.
//
// One primitive backs BOTH the individual info overlays and the
// info drawer, so docking, drag, resize and positionally-coherent
// collapse behave identically for both. All geometry state
// (corner, drag offset, size, collapsed) is persisted here under
// `dockable-panel-{persistKey}`.
// ============================================================

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center'];

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Create a dockable panel.
 *
 * @param {object} opts
 * @param {string} opts.persistKey   localStorage suffix (e.g. 'info-foo' or 'info-drawer').
 * @param {string} [opts.corner]     initial anchor corner (one of CORNERS).
 * @param {string} [opts.title]      header title HTML (already rendered).
 * @param {HTMLElement} opts.bodyEl  caller body appended into the panel body.
 * @param {HTMLElement} opts.container  parent element to append into.
 * @param {Array<HTMLElement>} [opts.headerButtons]  buttons rendered in the header.
 * @param {boolean} [opts.resizable]  enable the resize grip (default true).
 * @param {boolean} [opts.titleAlwaysVisible]  show title even when expanded (default false).
 * @param {number} [opts.minWidth]
 * @param {number} [opts.minHeight]
 * @param {number} [opts.opacity]
 * @param {() => (object|null)} [opts.legacyMigrate]  returns a geometry blob to seed from
 *        old persistence keys when no new blob exists.
 * @param {(collapsed:boolean)=>void} [opts.onCollapseChange]
 * @returns {{el, bodyContainer, headerEl, setTitle, setCollapsed, isCollapsed, getCorner, setOpacity, destroy}}
 */
export function createDockablePanel(opts) {
    const {
        persistKey,
        corner = 'top-left',
        title = '',
        bodyEl,
        container,
        headerButtons = [],
        resizable = true,
        titleAlwaysVisible = false,
        minWidth = 120,
        minHeight = 36,
        opacity = 1,
        legacyMigrate = null,
        onCollapseChange = null,
    } = opts;

    const KEY = 'dockable-panel-' + persistKey;

    function loadGeom() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) return JSON.parse(raw);
        } catch {}
        if (legacyMigrate) {
            try {
                const migrated = legacyMigrate();
                if (migrated) { saveGeom(migrated); return migrated; }
            } catch {}
        }
        return null;
    }
    function saveGeom(g) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {} }

    const saved = loadGeom();
    const geom = {
        corner: (saved && CORNERS.includes(saved.corner)) ? saved.corner : (CORNERS.includes(corner) ? corner : 'top-left'),
        h: saved && saved.h != null ? saved.h : null,
        v: saved && saved.v != null ? saved.v : null,
        w: saved && saved.w != null ? saved.w : null,
        ht: saved && saved.ht != null ? saved.ht : null,
        collapsed: !!(saved && saved.collapsed),
    };

    // ---- DOM ----
    const el = document.createElement('div');
    el.className = 'dockable-panel';
    if (titleAlwaysVisible) el.classList.add('title-always');
    el.style.opacity = opacity;

    const header = document.createElement('div');
    header.className = 'dockable-panel-header';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'dp-collapse';
    caret.title = 'Expand / collapse';
    caret.addEventListener('mousedown', e => e.stopPropagation());
    caret.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!geom.collapsed); });
    header.appendChild(caret);

    const titleEl = document.createElement('span');
    titleEl.className = 'dp-title';
    titleEl.innerHTML = title || '';
    header.appendChild(titleEl);

    const btnWrap = document.createElement('span');
    btnWrap.className = 'dp-buttons';
    for (const b of headerButtons) {
        b.addEventListener('mousedown', e => e.stopPropagation());
        btnWrap.appendChild(b);
    }
    header.appendChild(btnWrap);
    el.appendChild(header);

    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'dockable-panel-body';
    if (bodyEl) bodyContainer.appendChild(bodyEl);
    el.appendChild(bodyContainer);

    let grip = null;
    if (resizable) {
        grip = document.createElement('div');
        grip.className = 'dp-resize';
        grip.title = 'Resize';
        grip.addEventListener('mousedown', beginResize);
        el.appendChild(grip);
    }

    (container || document.body).appendChild(el);

    // ---- geometry application ----
    function applyGeom() {
        for (const c of CORNERS) el.classList.remove('pos-' + c);
        for (const c of CORNERS) el.classList.remove('anchor-' + c);
        el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = '';
        el.classList.add('anchor-' + geom.corner);
        el.style.width = geom.w ? geom.w + 'px' : '';
        el.style.height = (geom.ht && !geom.collapsed) ? geom.ht + 'px' : '';

        if (geom.h == null && geom.v == null) {
            // Un-dragged: rely on CSS class anchoring (keeps center transform, etc.)
            el.classList.add('pos-' + geom.corner);
        } else {
            const isRight = geom.corner.includes('right');
            const isBottom = geom.corner.includes('bottom');
            if (isRight) el.style.right = geom.h + 'px';
            else el.style.left = geom.h + 'px';
            if (isBottom) el.style.bottom = geom.v + 'px';
            else el.style.top = geom.v + 'px';
        }
        el.classList.toggle('collapsed', !!geom.collapsed);
    }

    // ---- drag ----
    header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, .dp-resize')) return;
        beginDrag(e);
    });

    // Pick the anchor corner nearest to the panel's current position, so a
    // dropped panel re-docks to whichever corner it was dragged toward.
    function pickCornerByProximity() {
        const parent = container || el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const cx = (rect.left + rect.width / 2) - parentRect.left;
        const cy = (rect.top + rect.height / 2) - parentRect.top;
        const horiz = cx > parentRect.width / 2 ? 'right' : 'left';
        const vert = cy > parentRect.height / 2 ? 'bottom' : 'top';
        return vert + '-' + horiz;
    }

    function beginDrag(e) {
        e.preventDefault();
        const parent = container || el.offsetParent || document.body;
        const startX = e.clientX, startY = e.clientY;
        const DRAG_THRESHOLD = 4;
        let moved = false;
        let isRight, isBottom, startH, startV, parentRect;

        // Convert from CSS-class anchoring to explicit offsets — deferred until
        // the pointer actually moves, so a plain click stays a click.
        function initDrag() {
            if (geom.corner.includes('center')) {
                const r = el.getBoundingClientRect();
                const isB = geom.corner.includes('bottom');
                geom.corner = (isB ? 'bottom' : 'top') + '-' + ((r.left + r.width / 2) > window.innerWidth / 2 ? 'right' : 'left');
            }
            isRight = geom.corner.includes('right');
            isBottom = geom.corner.includes('bottom');
            const rect = el.getBoundingClientRect();
            parentRect = parent.getBoundingClientRect();
            startH = isRight ? parentRect.right - rect.right : rect.left - parentRect.left;
            startV = isBottom ? parentRect.bottom - rect.bottom : rect.top - parentRect.top;
            geom.h = startH; geom.v = startV;
            applyGeom();
            el.classList.add('dragging');
        }

        const onMove = (me) => {
            const dx = me.clientX - startX, dy = me.clientY - startY;
            if (!moved) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                moved = true;
                initDrag();
            }
            let newH = isRight ? startH - dx : startH + dx;
            let newV = isBottom ? startV - dy : startV + dy;
            newH = _clamp(newH, 0, Math.max(0, parentRect.width - el.offsetWidth));
            newV = _clamp(newV, 0, Math.max(0, parentRect.height - el.offsetHeight));
            geom.h = newH; geom.v = newV;
            if (isRight) el.style.right = newH + 'px'; else el.style.left = newH + 'px';
            if (isBottom) el.style.bottom = newV + 'px'; else el.style.top = newV + 'px';
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (!moved) {
                // No drag happened — treat as a click on the title bar => toggle.
                setCollapsed(!geom.collapsed);
                return;
            }
            el.classList.remove('dragging');
            // Re-anchor to the nearest corner, keeping the panel visually in place.
            const newCorner = pickCornerByProximity();
            geom.corner = newCorner;
            const nowRight = newCorner.includes('right');
            const nowBottom = newCorner.includes('bottom');
            const rect = el.getBoundingClientRect();
            const pr = parent.getBoundingClientRect();
            geom.h = Math.max(0, nowRight ? pr.right - rect.right : rect.left - pr.left);
            geom.v = Math.max(0, nowBottom ? pr.bottom - rect.bottom : rect.top - pr.top);
            applyGeom();
            saveGeom(geom);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // ---- resize (grip sits on the corner opposite the anchor) ----
    function beginResize(e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        if (geom.collapsed) return;
        const isRight = geom.corner.includes('right');
        const isBottom = geom.corner.includes('bottom');
        const rect = el.getBoundingClientRect();
        const startW = rect.width, startHt = rect.height;
        const startX = e.clientX, startY = e.clientY;
        const capW = () => Math.min(window.innerWidth * 0.9, 1000);
        const capH = () => window.innerHeight * 0.9;
        el.classList.add('resizing');

        const onMove = (me) => {
            const dx = me.clientX - startX, dy = me.clientY - startY;
            let newW = isRight ? startW - dx : startW + dx;
            let newHt = isBottom ? startHt - dy : startHt + dy;
            newW = _clamp(newW, minWidth, capW());
            newHt = _clamp(newHt, minHeight, capH());
            geom.w = Math.round(newW); geom.ht = Math.round(newHt);
            el.style.width = geom.w + 'px';
            el.style.height = geom.ht + 'px';
        };
        const onUp = () => {
            el.classList.remove('resizing');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            saveGeom(geom);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    function setCollapsed(c) {
        geom.collapsed = !!c;
        el.classList.toggle('collapsed', geom.collapsed);
        el.style.height = (!geom.collapsed && geom.ht) ? geom.ht + 'px' : '';
        saveGeom(geom);
        if (onCollapseChange) onCollapseChange(geom.collapsed);
    }

    applyGeom();

    return {
        el,
        bodyContainer,
        headerEl: header,
        setTitle(html) { titleEl.innerHTML = html || ''; },
        setCollapsed,
        isCollapsed() { return !!geom.collapsed; },
        getCorner() { return geom.corner; },
        setOpacity(o) { el.style.opacity = o; },
        destroy() { el.remove(); },
    };
}
