// ============================================================
// view-state.js — Pure query-string serialization for deeplinking.
//
// Converts a canonical `ViewState` object to/from a URL query string.
// This module is intentionally PURE: no DOM access, no `state.js` import,
// no app side effects — so it is unit-testable under `node --test` and
// reusable for breadcrumbs / an AI "jump to view" tool later.
//
// Canonical ViewState shape (all fields optional):
//   {
//     builtin,            // built-in lesson name           -> ?builtin=
//     scene,              // custom scene file path         -> ?scene=
//     view,               // 'math' (Math tab); scene=default  -> ?view=
//     panel,              // 'chat' (right panel); doc=default -> ?panel=
//     pp,                 // true => proof panel open           -> ?pp=1
//     sc,                 // scene id (resolved)            -> ?sc=
//     st,                 // step id; absent => base step   -> ?st=
//     pf,                 // proof id                       -> ?pf=
//     ps,                 // proof step id; absent => goal  -> ?ps=
//     nodes: [id, ...],   // ordered selection, last=active -> ?nodes=a,b,c
//     sliders: {id: num}, // parameter overrides            -> ?sl=id~val,...
//     cv,                 // selected camera-view preset    -> ?cv=iso
//     proj,               // 'orthographic'; perspective=default -> ?proj=orthographic
//     oz,                 // orthographic visible half-height (world) -> ?oz=3.2
//     cam: {              // camera (data-space)            -> ?cam=px,py,pz,tx,ty,tz[,ux,uy,uz]
//       position:[x,y,z], target:[x,y,z], up?:[x,y,z]
//     },
//   }
// ============================================================

const CAM_DECIMALS = 4;
const DEFAULT_UP = [0, 1, 0];

// ----- Number / string helpers -----

/** Round to `dp` decimals and stringify, dropping trailing zeros. */
export function fmtNum(n, dp = CAM_DECIMALS) {
    if (!Number.isFinite(n)) return '0';
    const f = Math.pow(10, dp);
    return String(Math.round(n * f) / f);
}

// Minimal percent-encoding that keeps the compact separators (`,` `~`)
// readable. URLSearchParams parsing decodes these fine on the way back.
function encMin(v) {
    return encodeURIComponent(String(v)).replace(/%2C/gi, ',').replace(/%7E/gi, '~');
}

function buildQuery(pairs) {
    return pairs
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encMin(v)}`)
        .join('&');
}

/**
 * Stable slug from a human title: lowercase, non-alphanumerics -> '-',
 * collapse/trim hyphens. Empty input yields ''.
 */
export function slugify(title) {
    return String(title == null ? '' : title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ----- Camera encode / decode -----

/** Encode camera to compact `px,py,pz,tx,ty,tz[,ux,uy,uz]` (data-space). */
export function encodeCamera(cam) {
    if (!cam || !Array.isArray(cam.position) || !Array.isArray(cam.target)) return '';
    const p = cam.position, t = cam.target;
    const nums = [p[0], p[1], p[2], t[0], t[1], t[2]];
    const up = Array.isArray(cam.up) ? cam.up : null;
    // Only include `up` when it deviates from the default [0,1,0].
    if (up && !(up[0] === DEFAULT_UP[0] && up[1] === DEFAULT_UP[1] && up[2] === DEFAULT_UP[2])) {
        nums.push(up[0], up[1], up[2]);
    }
    return nums.map((n) => fmtNum(Number(n))).join(',');
}

/** Decode `px,py,pz,tx,ty,tz[,ux,uy,uz]` back to a camera object, or null. */
export function decodeCamera(str) {
    if (!str) return null;
    const segs = String(str).split(',');
    // The format is exactly 6 (position+target) or 9 (with up) numbers.
    // Reject any other length and any empty segment (e.g. a trailing comma,
    // which would otherwise coerce to a spurious 0).
    if (segs.length !== 6 && segs.length !== 9) return null;
    if (segs.some((s) => s.trim() === '')) return null;
    const parts = segs.map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    const cam = {
        position: [parts[0], parts[1], parts[2]],
        target: [parts[3], parts[4], parts[5]],
    };
    if (parts.length === 9) cam.up = [parts[6], parts[7], parts[8]];
    return cam;
}

// ----- ViewState <-> query string -----

/** Serialize a ViewState to a query string (no leading '?'). */
export function serializeViewState(vs) {
    if (!vs) return '';
    const pairs = [];
    if (vs.builtin) pairs.push(['builtin', vs.builtin]);
    else if (vs.scene) pairs.push(['scene', vs.scene]);

    if (vs.view && vs.view !== 'scene') pairs.push(['view', vs.view]);
    if (vs.panel && vs.panel !== 'doc') pairs.push(['panel', vs.panel]);
    if (vs.pp) pairs.push(['pp', '1']);

    if (vs.sc != null && vs.sc !== '') pairs.push(['sc', vs.sc]);
    if (vs.st != null && vs.st !== '') pairs.push(['st', vs.st]);
    if (vs.pf != null && vs.pf !== '') pairs.push(['pf', vs.pf]);
    if (vs.ps != null && vs.ps !== '') pairs.push(['ps', vs.ps]);

    if (Array.isArray(vs.nodes) && vs.nodes.length) {
        pairs.push(['nodes', vs.nodes.map((id) => String(id)).join(',')]);
    }

    if (vs.sliders && typeof vs.sliders === 'object') {
        const packed = Object.entries(vs.sliders)
            .filter(([, val]) => Number.isFinite(Number(val)))
            .map(([id, val]) => `${id}~${fmtNum(Number(val))}`)
            .join(',');
        if (packed) pairs.push(['sl', packed]);
    }

    if (vs.cv) pairs.push(['cv', vs.cv]);
    if (vs.proj && vs.proj !== 'perspective') pairs.push(['proj', vs.proj]);
    if (Number.isFinite(vs.oz)) pairs.push(['oz', fmtNum(vs.oz)]);

    if (vs.cam) {
        const enc = encodeCamera(vs.cam);
        if (enc) pairs.push(['cam', enc]);
    }

    return buildQuery(pairs);
}

/** Parse a query string (or URLSearchParams) into a ViewState. */
export function parseViewState(search) {
    let params;
    if (search instanceof URLSearchParams) {
        params = search;
    } else {
        const s = String(search == null ? '' : search).replace(/^\?/, '');
        params = new URLSearchParams(s);
    }

    const vs = {};
    const builtin = params.get('builtin');
    const scene = params.get('scene');
    if (builtin) vs.builtin = builtin;
    else if (scene) vs.scene = scene;

    const view = params.get('view');
    if (view) vs.view = view;

    const panel = params.get('panel');
    if (panel) vs.panel = panel;

    const pp = params.get('pp');
    if (pp === '1' || pp === 'true') vs.pp = true;

    const sc = params.get('sc');
    const st = params.get('st');
    const pf = params.get('pf');
    const ps = params.get('ps');
    if (sc) vs.sc = sc;
    if (st) vs.st = st;
    if (pf) vs.pf = pf;
    if (ps) vs.ps = ps;

    const nodes = params.get('nodes');
    if (nodes) {
        const ids = nodes.split(',').map((s) => s.trim()).filter(Boolean);
        if (ids.length) vs.nodes = ids;
    }

    const sl = params.get('sl');
    if (sl) {
        const sliders = {};
        for (const pair of sl.split(',')) {
            const idx = pair.indexOf('~');
            if (idx <= 0) continue;
            const id = pair.slice(0, idx);
            const val = Number(pair.slice(idx + 1));
            if (id && Number.isFinite(val)) sliders[id] = val;
        }
        if (Object.keys(sliders).length) vs.sliders = sliders;
    }

    const cv = params.get('cv');
    if (cv) vs.cv = cv;

    const proj = params.get('proj');
    if (proj) vs.proj = proj;

    const oz = params.get('oz');
    if (oz != null && oz !== '') {
        const n = Number(oz);
        if (Number.isFinite(n)) vs.oz = n;
    }

    const cam = decodeCamera(params.get('cam'));
    if (cam) vs.cam = cam;

    return vs;
}

/** True when two ViewStates serialize identically (cheap structural eq). */
export function viewStatesEqual(a, b) {
    return serializeViewState(a) === serializeViewState(b);
}
