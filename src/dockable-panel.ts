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

/** One of CORNERS. Kept as a plain string in the persisted blob — the loader
 *  validates against CORNERS rather than trusting localStorage. */
export type DockCorner = typeof CORNERS[number];

/** The persisted geometry blob, stored under `dockable-panel-{persistKey}`.
 *  `h`/`v` are null until the panel is first dragged (CSS-class anchoring
 *  handles the un-dragged case); `w`/`ht` are null until first resized. */
export interface DockGeometry {
    corner: string;
    h: number | null;
    v: number | null;
    w: number | null;
    ht: number | null;
    collapsed: boolean;
}

export interface DockablePanelOptions {
    /** localStorage suffix (e.g. 'info-foo' or 'info-drawer'). */
    persistKey: string;
    /** Initial anchor corner (one of CORNERS). */
    corner?: string;
    /** Header title HTML (already rendered). */
    title?: string;
    /** Caller body appended into the panel body. */
    bodyEl?: HTMLElement | null;
    /** Parent element to append into. */
    container?: HTMLElement | null;
    /** Buttons rendered in the header. */
    headerButtons?: HTMLElement[];
    /** Enable the resize grip (default true). */
    resizable?: boolean;
    /** Show title even when expanded (default false). */
    titleAlwaysVisible?: boolean;
    minWidth?: number;
    minHeight?: number;
    opacity?: number;
    /** Returns a geometry blob to seed from old persistence keys when no new
     *  blob exists. */
    legacyMigrate?: (() => Partial<DockGeometry> | null) | null;
    onCollapseChange?: ((collapsed: boolean) => void) | null;
}

/** The handle createDockablePanel() hands back to its caller. */
export interface DockablePanel {
    el: HTMLElement;
    bodyContainer: HTMLElement;
    headerEl: HTMLElement;
    setTitle(html: string | null | undefined): void;
    setCollapsed(c: boolean): void;
    isCollapsed(): boolean;
    getCorner(): string;
    setOpacity(o: number): void;
    destroy(): void;
}

function _clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/** Create a dockable panel. */
export function createDockablePanel(opts: DockablePanelOptions): DockablePanel {
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

    function loadGeom(): Partial<DockGeometry> | null {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) return JSON.parse(raw) as Partial<DockGeometry>;
        } catch {}
        if (legacyMigrate) {
            try {
                const migrated = legacyMigrate();
                if (migrated) { saveGeom(migrated); return migrated; }
            } catch {}
        }
        return null;
    }
    function saveGeom(g: Partial<DockGeometry>): void { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {} }

    const saved = loadGeom();
    const geom: DockGeometry = {
        // Non-null: `includes` is the validation — a saved blob without a corner
        // fails it and falls through to the `corner` option, exactly as before.
        corner: (saved && CORNERS.includes(saved.corner!)) ? saved.corner! : (CORNERS.includes(corner) ? corner : 'top-left'),
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
    // style.opacity is a string property; the JS assigned the number and let
    // the DOM coerce. String() is that same conversion, spelled out.
    el.style.opacity = String(opacity);

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

    let grip: HTMLElement | null = null;
    if (resizable) {
        grip = document.createElement('div');
        grip.className = 'dp-resize';
        grip.title = 'Resize';
        grip.addEventListener('mousedown', beginResize);
        el.appendChild(grip);
    }

    (container || document.body).appendChild(el);

    // ---- geometry application ----
    function applyGeom(): void {
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
        // Cast, not optional chaining: a null target threw in the JS.
        if ((e.target as HTMLElement).closest('button, .dp-resize')) return;
        beginDrag(e);
    });

    // Pick the anchor corner nearest to the panel's current position, so a
    // dropped panel re-docks to whichever corner it was dragged toward.
    function pickCornerByProximity(): string {
        const parent = container || el.offsetParent || document.body;
        const parentRect = parent.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const cx = (rect.left + rect.width / 2) - parentRect.left;
        const cy = (rect.top + rect.height / 2) - parentRect.top;
        const horiz = cx > parentRect.width / 2 ? 'right' : 'left';
        const vert = cy > parentRect.height / 2 ? 'bottom' : 'top';
        return vert + '-' + horiz;
    }

    function beginDrag(e: MouseEvent): void {
        e.preventDefault();
        const parent = container || el.offsetParent || document.body;
        const startX = e.clientX, startY = e.clientY;
        const DRAG_THRESHOLD = 4;
        let moved = false;
        let isRight: boolean, isBottom: boolean, startH: number, startV: number, parentRect: DOMRect;

        // Convert from CSS-class anchoring to explicit offsets — deferred until
        // the pointer actually moves, so a plain click stays a click.
        function initDrag(): void {
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

        const onMove = (me: MouseEvent) => {
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
    function beginResize(e: MouseEvent): void {
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

        const onMove = (me: MouseEvent) => {
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

    function setCollapsed(c: boolean): void {
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
        setTitle(html: string | null | undefined) { titleEl.innerHTML = html || ''; },
        setCollapsed,
        isCollapsed() { return !!geom.collapsed; },
        getCorner() { return geom.corner; },
        setOpacity(o: number) { el.style.opacity = String(o); },
        destroy() { el.remove(); },
    };
}
