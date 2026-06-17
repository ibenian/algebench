// ============================================================
// view-state-bridge.js — Connect the pure ViewState serializer to the live app.
//
//   captureViewState({includeCamera}) -> ViewState   (read current app state)
//   applyViewState(vs, opts)          -> drive the app to that state
//   setupViewSync()                   -> install outbound listeners that keep
//                                        the URL in sync as the user navigates
//
// Stable ids use a HYBRID resolver: explicit `id` -> slug(title) -> array index.
// Id maps are built deterministically per lesson (collision-suffixed) and
// memoized by lesson reference. Camera lives in DATA space in the URL (like
// scene JSON) and is converted via coords.js on the way in/out.
//
// This module is browser-only (imports /state.js etc.); the pure serializer in
// view-state.js stays import-free for unit testing.
// ============================================================

import { state } from '/state.js';
import { serializeViewState, parseViewState, slugify, fmtNum } from '/view-state.js';
import { pushView, replaceView, isApplyingFromHistory } from '/nav-history.js';
import { navigateTo } from '/scene-loader.js';
import { loadBuiltinScene, loadSceneFromPath } from '/ui.js';
import { setActiveProof, navigateProof, setProofPanelOpen } from '/proof.js';
import { setSliderValue } from '/sliders.js';
import { animateCamera, switchProjection } from '/camera.js';
import { dataCameraToWorld, worldCameraToData } from '/coords.js';

let _applying = false;
const _sceneMapCache = new WeakMap();

/** True while applyViewState is driving the app (suppresses outbound sync). */
export function isApplyingViewState() {
    return _applying || isApplyingFromHistory();
}

// ----- Id resolution (hybrid: id -> slug(title) -> index) -----

// Build a deterministic, collision-free id list for an array of {id?, title?}.
function buildIds(items, titleKey) {
    const used = new Set();
    return (items || []).map((it, i) => {
        let base = (it && it.id) ? String(it.id) : slugify(it && it[titleKey]);
        if (!base) base = String(i);
        let id = base, n = 2;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        return id;
    });
}

function sceneMaps(lesson) {
    if (!lesson || !Array.isArray(lesson.scenes)) return { sceneIds: [], stepIds: [] };
    let cached = _sceneMapCache.get(lesson);
    if (cached) return cached;
    const sceneIds = buildIds(lesson.scenes, 'title');
    const stepIds = lesson.scenes.map((sc) => buildIds(sc.steps || [], 'title'));
    cached = { sceneIds, stepIds };
    _sceneMapCache.set(lesson, cached);
    return cached;
}

// Resolve a token against an id list using id/slug match, then integer index.
function resolveIndex(token, ids) {
    if (token == null) return -1;
    const direct = ids.indexOf(token);
    if (direct >= 0) return direct;
    if (/^\d+$/.test(token)) {
        const n = Number(token);
        if (n >= 0 && n < ids.length) return n;
    }
    return -1;
}

function proofId(entry, index) {
    return (entry && entry.proof && entry.proof.id)
        || slugify(entry && entry.proof && entry.proof.title)
        || `_idx_${index}`;
}

function proofStepIds(proof) {
    return buildIds((proof && proof.steps) || [], 'label');
}

function currentBuiltin() {
    const p = state.currentSceneSourcePath || '';
    const m = /^\/scenes\/(.+)$/.exec(p);
    return m ? decodeURIComponent(m[1]) : null;
}

// ----- Capture: live app state -> ViewState -----

export function captureViewState({ includeCamera = false } = {}) {
    const vs = {};

    // Source: preserve whatever the URL already carries (set on scene load).
    const cur = parseViewState(window.location.search);
    if (cur.builtin) vs.builtin = cur.builtin;
    else if (cur.scene) vs.scene = cur.scene;

    // Scene / step ids.
    const lesson = state.lessonSpec;
    if (lesson && Array.isArray(lesson.scenes) && state.currentSceneIndex >= 0) {
        const maps = sceneMaps(lesson);
        vs.sc = maps.sceneIds[state.currentSceneIndex];
        if (state.currentStepIndex >= 0) {
            const stepIds = maps.stepIds[state.currentSceneIndex] || [];
            if (stepIds[state.currentStepIndex] != null) vs.st = stepIds[state.currentStepIndex];
        }
    }

    // Proof / proof step ids.
    if (Array.isArray(state.proofSpec) && state.proofSpec.length && state.proofActiveIndex >= 0) {
        const entry = state.proofSpec[state.proofActiveIndex];
        if (entry && entry.proof) {
            vs.pf = proofId(entry, state.proofActiveIndex);
            if (state.proofStepIndex >= 0) {
                const sIds = proofStepIds(entry.proof);
                if (sIds[state.proofStepIndex] != null) vs.ps = sIds[state.proofStepIndex];
            }
        }
    }

    // Active view (Scenes vs Math) — 'scene' is the default and stays implicit.
    const view = (window.__algebenchGraph && window.__algebenchGraph.getCurrentView)
        ? window.__algebenchGraph.getCurrentView() : 'scene';
    if (view === 'math') vs.view = 'math';

    // Right panel tab (Doc/Chat) and proof-panel open state.
    const tab = document.querySelector('.panel-tab.active');
    if (tab && tab.dataset.tab === 'chat') vs.panel = 'chat';
    if (state.proofExpanded) vs.pp = true;

    // Ordered graph selection (last = active).
    const sel = (window.__algebenchGraph && window.__algebenchGraph.getSelection)
        ? window.__algebenchGraph.getSelection() : [];
    if (sel && sel.length) vs.nodes = sel;

    // Slider overrides = diff from default.
    const sliders = {};
    for (const [id, s] of Object.entries(state.sceneSliders || {})) {
        if (!s || !Number.isFinite(s.value)) continue;
        const def = Number.isFinite(s.default) ? s.default : null;
        if (def == null || Math.abs(s.value - def) > 1e-6) {
            sliders[id] = Number(fmtNum(s.value));
        }
    }
    if (Object.keys(sliders).length) vs.sliders = sliders;

    // 3D viewport (camera + selected view preset) — only when explicitly
    // captured (Share button). Like the camera, the selected view is NOT in the
    // live URL or nav history, so the 3D viewport never jumps on back/forward.
    if (includeCamera) {
        const activeBtn = document.querySelector('.cam-btn.active');
        if (activeBtn && activeBtn.dataset.view) vs.cv = activeBtn.dataset.view;
        if (state.currentProjection === 'orthographic') vs.proj = 'orthographic';
        if (state.camera && state.controls) {
            const p = worldCameraToData([state.camera.position.x, state.camera.position.y, state.camera.position.z]);
            const t = worldCameraToData([state.controls.target.x, state.controls.target.y, state.controls.target.z]);
            const up = [state.camera.up.x, state.camera.up.y, state.camera.up.z];
            vs.cam = { position: p, target: t, up };
        }
    }

    return vs;
}

// ----- Apply: ViewState -> drive the app -----

export async function applyViewState(vs, opts = {}) {
    if (!vs) return;
    _applying = true;
    try {
        // 1. Ensure the right lesson source is loaded.
        if (vs.builtin && vs.builtin !== currentBuiltin()) {
            await loadBuiltinScene(vs.builtin);
        } else if (vs.scene && vs.scene !== state.currentSceneSourcePath) {
            await loadSceneFromPath(vs.scene);
        }

        // 2. Scene / step.
        const lesson = state.lessonSpec;
        if (lesson && Array.isArray(lesson.scenes)) {
            const maps = sceneMaps(lesson);
            let sceneIdx = vs.sc != null ? resolveIndex(vs.sc, maps.sceneIds) : -1;
            if (sceneIdx < 0 && (vs.sc != null || vs.st != null)) sceneIdx = state.currentSceneIndex >= 0 ? state.currentSceneIndex : 0;
            if (sceneIdx >= 0) {
                const stepIds = maps.stepIds[sceneIdx] || [];
                const stepIdx = vs.st != null ? resolveIndex(vs.st, stepIds) : -1;
                navigateTo(sceneIdx, stepIdx);
            }
        }

        // 3. Proof + proof step (proofs reload inside navigateTo).
        if (vs.pf != null && Array.isArray(state.proofSpec) && state.proofSpec.length) {
            const ids = state.proofSpec.map((e, i) => proofId(e, i));
            const pIdx = resolveIndex(vs.pf, ids);
            if (pIdx >= 0) {
                setActiveProof(pIdx);
                const proof = state.proofSpec[pIdx] && state.proofSpec[pIdx].proof;
                const sIds = proofStepIds(proof);
                const sIdx = vs.ps != null ? resolveIndex(vs.ps, sIds) : -1;
                navigateProof(sIdx);
            }
        }

        // 4. Slider overrides (apply instantly — no rAF dependency).
        if (vs.sliders) {
            for (const [id, val] of Object.entries(vs.sliders)) {
                if (state.sceneSliders && state.sceneSliders[id]) {
                    setSliderValue(id, Number(val));
                }
            }
        }

        // 5. Graph selection — stash as pending; graph-view applies it once the
        //    target step's renderer has finished rendering.
        if (window.__algebenchGraph && window.__algebenchGraph.applyDeeplinkSelection) {
            window.__algebenchGraph.applyDeeplinkSelection(vs.nodes || []);
        }

        // 5b. View: open the Math (graph) tab when the link targets it — either
        //     explicitly (view=math) or implicitly because nodes are selected.
        //     This renders the graph and flushes the pending selection above.
        const wantGraph = vs.view === 'math' || (Array.isArray(vs.nodes) && vs.nodes.length);
        const g = window.__algebenchGraph;
        if (g) {
            try {
                if (wantGraph && g.showGraphView) await g.showGraphView();
                else if (g.showSceneView) await g.showSceneView();  // restore Scenes on back-nav
            } catch (_) { /* ignore */ }
        }

        // 5c. Right panel tab (Doc/Chat) and proof panel open/closed.
        if (typeof window.switchPanelTab === 'function') {
            window.switchPanelTab(vs.panel === 'chat' ? 'chat' : 'doc');
        }
        setProofPanelOpen(!!vs.pp);

        // 6. 3D viewport: projection, selected view preset, then exact camera.
        //    Projection is applied ONLY when the link carries viewport info
        //    (proj or cam) — never on plain scene/step back/forward, so the
        //    viewport doesn't flip. switchProjection recreates state.camera, so
        //    it must run before the cv/camera steps below.
        if (vs.proj || vs.cam) {
            switchProjection(vs.proj === 'orthographic' ? 'orthographic' : 'perspective');
        }

        //    - Dynamic views (follow-cam / expression-cam, marked .cam-btn-follow)
        //      are activated by clicking; a static camera must NOT override them.
        //    - Static presets: apply the exact camera FIRST (animateCamera clears
        //      all .cam-btn active states), THEN mark the preset button active so
        //      it isn't wiped. The exact camera matters because the user may have
        //      orbited off the preset before sharing.
        const cvBtn = vs.cv ? document.querySelector(`.cam-btn[data-view="${vs.cv}"]`) : null;
        const cvDynamic = !!(cvBtn && cvBtn.classList.contains('cam-btn-follow'));

        // Dynamic views (follow-cam / expression-cam): just activate them, exactly
        // like clicking the button. Their framing is computed live (angle-lock,
        // moving target), so a frozen camera snapshot can't be re-imposed — we
        // reproduce the view, not an exact angle.
        if (cvBtn && cvDynamic && !cvBtn.classList.contains('active')) cvBtn.click();

        const dynamicCam = state.followCamState || state.cameraExprState;
        const camOk = vs.cam && Array.isArray(vs.cam.position) && Array.isArray(vs.cam.target);

        // Exact camera applies only to static / free views (not live follow cams).
        if (camOk && !dynamicCam) {
            const wPos = dataCameraToWorld(vs.cam.position);
            const wTgt = dataCameraToWorld(vs.cam.target);
            const up = Array.isArray(vs.cam.up) ? vs.cam.up.slice(0, 3) : [0, 1, 0];
            state.CAMERA_VIEWS = state.CAMERA_VIEWS || {};
            state.CAMERA_VIEWS['__deeplink'] = { position: wPos, target: wTgt, up };
            animateCamera('__deeplink', 600);
        }

        if (cvBtn && !cvDynamic) {
            if (camOk) {
                // Exact camera already applied above — just reflect the preset.
                document.querySelectorAll('.cam-btn').forEach((b) => b.classList.remove('active'));
                cvBtn.classList.add('active');
            } else {
                // No exact camera in the link — animate to the preset itself.
                cvBtn.click();
            }
        }
    } finally {
        _applying = false;
        // Cancel any push scheduled just before this apply (e.g. the initial
        // navigateTo(0,-1) during source load). If it fired now it would
        // recapture the default state and clobber the share-only cv/cam/proj we
        // just restored.
        if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
        // Write the resolved state back to the URL once (skip on browser
        // back/forward — the browser already owns the URL there).
        if (!opts.fromHistory) {
            try { replaceView(vs); } catch (_) { /* ignore */ }
        }
    }
}

// ----- Outbound sync: app navigation -> URL -----

let _sliderTimer = null;
let _pushTimer = null;

export function setupViewSync() {
    // Coalesce push events fired within the same tick into ONE history entry.
    // A single user action (e.g. stepping scenes) can cascade into several
    // events — navchange + an auto proof-panel toggle + a view change — and we
    // don't want one click to cost three Back presses.
    const schedulePush = () => {
        if (isApplyingViewState()) return;
        if (_pushTimer) return;
        _pushTimer = setTimeout(() => {
            _pushTimer = null;
            if (!isApplyingViewState()) pushView(captureViewState());
        }, 0);
    };
    const replace = () => { if (!isApplyingViewState()) replaceView(captureViewState()); };

    // These all create a Back/Forward history entry (coalesced per tick):
    //   scene/step, proof step, node selection, Scenes↔Math view,
    //   Doc↔Chat panel, and proof-panel open/close.
    window.addEventListener('algebench:navchange', schedulePush);
    window.addEventListener('algebench:proofchange', schedulePush);
    window.addEventListener('algebench:selectionchange', schedulePush);
    window.addEventListener('algebench:viewchange', schedulePush);
    window.addEventListener('algebench:panelchange', schedulePush);

    // Slider changes never enter history (continuous drag/animation would flood
    // it) — debounced in-place URL update so the link stays shareable.
    window.addEventListener('algebench:sliderchange', () => {
        if (isApplyingViewState()) return;
        if (_sliderTimer) clearTimeout(_sliderTimer);
        _sliderTimer = setTimeout(replace, 300);
    });
}

/**
 * Wire the "Copy link" button. This is the ONLY path that pins the camera into
 * the URL — capturing the exact viewport so a recipient lands on the same view.
 */
export function setupShareButton() {
    const btn = document.getElementById('nav-share');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const vs = captureViewState({ includeCamera: true });
        replaceView(vs);  // pin camera into the live URL
        const url = window.location.href;
        try {
            await navigator.clipboard.writeText(url);
            btn.classList.add('copied');
            const prevTitle = btn.title;
            btn.title = 'Link copied!';
            setTimeout(() => { btn.classList.remove('copied'); btn.title = prevTitle; }, 1200);
        } catch (_) { /* clipboard blocked — URL is still updated */ }
    });
}
