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
import { SHARE_VIEW_ICON } from '/icons.js';
import { serializeViewState, parseViewState, slugify, fmtNum } from '/view-state.js';
import { pushView, replaceView, isApplyingFromHistory } from '/nav-history.js';
import { navigateTo, loadProofAsLesson } from '/scene-loader.js';
import { loadBuiltinScene, loadSceneFromPath } from '/ui.js';
import { setActiveProof, navigateProof, setProofPanelOpen } from '/proof.js';
import { setSliderValue } from '/sliders.js';
import { animateCamera, switchProjection } from '/camera.js';
import { dataCameraToWorld, worldCameraToData } from '/coords.js';
import { openChatPanel } from '/labels.js';

let _applying = false;
const _sceneMapCache = new WeakMap();
// Auto-ask (?aa=) fires AT MOST once per session — a deeplink from an embedded
// proof's "Ask AI". Latched so back/forward/reload can't re-ask (belt-and-braces
// with the fromHistory skip + `aa` not being serialized back into the URL).
let _autoAskFired = false;

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

    // Dock (split) layout — serialize only when the dock is actually SHOWING:
    // docked AND on the Math view. The dock preference (`_docked`) persists even
    // while the user is on the Scenes tab, but the split layout only renders in
    // graph mode — so gating on `view === 'math'` (mirrors graph-view's
    // `_docked && dockActive`) keeps a scene-view capture from emitting `dock=1`,
    // which would otherwise force the recipient into graph view via `wantGraph`.
    if (view === 'math' && window.__algebenchGraph
        && typeof window.__algebenchGraph.isDocked === 'function'
        && window.__algebenchGraph.isDocked()) {
        vs.dock = true;
    }

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
        if (state.currentProjection === 'orthographic') {
            vs.proj = 'orthographic';
            // Ortho scale is the frustum/zoom, independent of camera distance, so
            // it must be captured explicitly to reconstruct the exact view.
            const c = state.camera;
            if (c && c.isOrthographicCamera) {
                const halfH = Math.abs((c.top - c.bottom) / (2 * (c.zoom || 1)));
                if (halfH > 0) vs.oz = halfH;
            }
        }
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
        let paLesson = false;
        if (vs.builtin && vs.builtin !== currentBuiltin()) {
            await loadBuiltinScene(vs.builtin);
        } else if (vs.scene && vs.scene !== state.currentSceneSourcePath) {
            await loadSceneFromPath(vs.scene);
        } else if (vs.pa && !vs.builtin && !vs.scene && !opts.fromHistory) {
            // A scene-less pre-baked proof (the /prove "Continue in main app" hand-off):
            // reconstruct an in-memory lesson from the proof and load it, so it opens
            // with the real proof panel + graph step-sync rather than a bare dock. On
            // success we DON'T also dock it (step 5b′) — it's now a lesson scene proof.
            paLesson = await loadProofAsLesson(vs.pa);
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
        //    Restored under the proof-sync latch: `st` and `ps` are captured
        //    independently, so restoring the proof position must not let
        //    proof→scene sync yank the scene to the proof step's `sceneStep`
        //    binding, overriding the explicit `st` applied in step 2.
        if (vs.pf != null && Array.isArray(state.proofSpec) && state.proofSpec.length) {
            const ids = state.proofSpec.map((e, i) => proofId(e, i));
            const pIdx = resolveIndex(vs.pf, ids);
            if (pIdx >= 0) {
                // Save/restore rather than clear: keeps the latch composable
                // if this ever runs inside another latched sync path.
                const prevLatch = state._proofSyncInProgress;
                state._proofSyncInProgress = true;
                try {
                    setActiveProof(pIdx);
                    const proof = state.proofSpec[pIdx] && state.proofSpec[pIdx].proof;
                    const sIds = proofStepIds(proof);
                    const sIdx = vs.ps != null ? resolveIndex(vs.ps, sIds) : -1;
                    navigateProof(sIdx);
                } finally {
                    state._proofSyncInProgress = prevLatch;
                }
            }
        }

        // 3′. Reconstructed proof lesson (?pa= with no scene, step 1): open its
        //     proof panel and jump to the step the learner was viewing (?pas=). The
        //     lesson has exactly one scene proof — select it and navigate. Force the
        //     proof panel open via vs.pp so step 5c (setProofPanelOpen(!!vs.pp))
        //     keeps it open instead of closing it (the hand-off URL has no pp).
        if (paLesson && Array.isArray(state.proofSpec) && state.proofSpec.length) {
            vs.pp = true;
            const prevLatch = state._proofSyncInProgress;
            state._proofSyncInProgress = true;
            try {
                setActiveProof(0);
                navigateProof(Number.isFinite(vs.pas) ? vs.pas : 0);
            } finally {
                state._proofSyncInProgress = prevLatch;
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
        //     explicitly (view=math), implicitly because nodes are selected, or
        //     because the link asks for the docked split (dock=1 shows the graph
        //     alongside the 3D viewport). This renders the graph and flushes the
        //     pending selection above.
        const wantGraph = vs.view === 'math' || vs.dock === true
            || (Array.isArray(vs.nodes) && vs.nodes.length) || !!vs.pa;
        const g = window.__algebenchGraph;
        if (g) {
            // Dock (split) layout — set BEFORE showing the graph so it renders
            // docked in one pass. Explicit-only: absent vs.dock leaves the user's
            // persisted preference alone (parseViewState omits it when absent).
            if (vs.dock !== undefined && typeof g.setDocked === 'function') {
                try { g.setDocked(vs.dock); } catch (_) { /* ignore */ }
            }
            try {
                if (wantGraph && g.showGraphView) await g.showGraphView();
                else if (g.showSceneView) await g.showSceneView();  // restore Scenes on back-nav
            } catch (_) { /* ignore */ }
        }

        // 5b′. Pre-baked proof animation (?pa=): fetch + dock it on the selected
        //      node, so a deeplink SHOWS the morphing proof animation without an LM
        //      re-derive. Runs after the graph rendered (5b); load-once (not
        //      serialized), so it doesn't re-fire on back/forward. This also embeds
        //      the animation over a reconstructed proof-lesson (3′) — its graph now
        //      exists, so the manager docks it there. Best-effort — never blocks.
        if (vs.pa && !opts.fromHistory && g && typeof g.dockProofAnimation === 'function') {
            const anchorNode = (Array.isArray(vs.nodes) && vs.nodes.length)
                ? vs.nodes[vs.nodes.length - 1] : null;
            try { await g.dockProofAnimation(vs.pa, anchorNode, vs.pas); } catch (_) { /* ignore */ }
        }

        // 5c. Right panel tab (Doc/Chat) and proof panel open/closed.
        if (typeof window.switchPanelTab === 'function') {
            window.switchPanelTab(vs.panel === 'chat' ? 'chat' : 'doc');
        }
        setProofPanelOpen(!!vs.pp);

        // 5d. Auto-ask: a deeplinked AI question (?aa=), e.g. from an embedded
        //     proof's "Ask AI". Fire ONCE, after navigation + proof open so the
        //     agent grounds on the now-current scene/proof. Skipped on back/forward
        //     (the user didn't click an ask). `aa` is sent verbatim as a chat
        //     message — same trust level as the user typing it (not eval'd / not
        //     inserted as HTML); the linking deeplink is origin-locked upstream.
        if (vs.aa && !opts.fromHistory && !_autoAskFired) {
            _autoAskFired = true;
            try { if (typeof window.switchPanelTab === 'function') window.switchPanelTab('chat'); } catch (_e) { /* no panel */ }
            try { openChatPanel(); } catch (_e) { /* panel optional */ }
            // Defer a tick so the proof/graph render settles before the agent reads context.
            const _ask = String(vs.aa);
            setTimeout(() => {
                try { if (typeof window.sendChatMessage === 'function') window.sendChatMessage(_ask); } catch (_e) { /* chat optional */ }
            }, 0);
        }

        // 6. 3D viewport: projection, selected view preset, then exact camera.
        //    Projection is applied ONLY when the link carries viewport info
        //    (proj or cam) — never on plain scene/step back/forward, so the
        //    viewport doesn't flip. switchProjection recreates state.camera, so
        //    it must run before the cv/camera steps below.
        if (vs.proj || vs.cam) {
            switchProjection(vs.proj === 'orthographic' ? 'orthographic' : 'perspective');
            // Restore the exact orthographic scale (frustum is otherwise derived
            // from the wrong distance and ignores the user's zoom). Vertical
            // extent is fixed; horizontal adapts to the recipient's aspect.
            if (vs.proj === 'orthographic' && Number.isFinite(vs.oz)
                && state.camera && state.camera.isOrthographicCamera) {
                const cont = document.getElementById('mathbox-container');
                const aspect = cont ? cont.clientWidth / Math.max(cont.clientHeight, 1) : 1;
                const c = state.camera;
                c.top = vs.oz; c.bottom = -vs.oz;
                c.left = -vs.oz * aspect; c.right = vs.oz * aspect;
                c.zoom = 1;
                c.updateProjectionMatrix();
            }
        }

        //    - Dynamic views (follow-cam / expression-cam, marked .cam-btn-follow)
        //      are activated by clicking; a static camera must NOT override them.
        //    - Static presets: apply the exact camera FIRST (animateCamera clears
        //      all .cam-btn active states), THEN mark the preset button active so
        //      it isn't wiped. The exact camera matters because the user may have
        //      orbited off the preset before sharing.
        const cvBtn = vs.cv ? document.querySelector(`.cam-btn[data-view="${vs.cv}"]`) : null;
        const cvDynamic = !!(cvBtn && cvBtn.classList.contains('cam-btn-follow'));

        // Dynamic views (follow-cam / expression-cam): activate them like a click.
        if (cvBtn && cvDynamic && !cvBtn.classList.contains('active')) cvBtn.click();

        const dynamicCam = state.followCamState || state.cameraExprState;
        const camOk = vs.cam && Array.isArray(vs.cam.position) && Array.isArray(vs.cam.target);

        if (camOk && dynamicCam && state.camera && state.controls) {
            // Live follow/expr cam: reproduce the EXACT shared angle. The shared
            // camera is target + offset, where offset already encodes the
            // angle-lock framing at the shared moment. We maintain that offset
            // relative to the follow-controlled target until the followed element
            // settles at the restored time (the slider repositions it over later
            // frames), then release — the follow loop holds it from there.
            const wPos = dataCameraToWorld(vs.cam.position);
            const wTgt = dataCameraToWorld(vs.cam.target);
            const up = Array.isArray(vs.cam.up) ? vs.cam.up.slice(0, 3) : [0, 1, 0];
            const offset = [wPos[0] - wTgt[0], wPos[1] - wTgt[1], wPos[2] - wTgt[2]];
            // Maintain the shared offset relative to the live follow target EVERY
            // frame, starting immediately — so the exact angle shows from frame 1
            // and stays correct while the element settles at the restored time (no
            // latency, no fragile "settled" heuristic). Release once the target has
            // been stable for a stretch (element settled → the follow loop holds
            // the offset on its own), or when the user interacts (so they can
            // orbit), or when the view changes. Backstop frame cap too.
            const dom = state.renderer && state.renderer.domElement;
            let stop = false, frames = 0, stable = 0, lastKey = null;
            const release = () => {
                stop = true;
                if (dom) {
                    dom.removeEventListener('pointerdown', release);
                    dom.removeEventListener('wheel', release);
                }
            };
            if (dom) {
                dom.addEventListener('pointerdown', release, { once: true });
                dom.addEventListener('wheel', release, { once: true, passive: true });
            }
            const pin = () => {
                const fc = state.followCamState;
                if (stop || (!fc && !state.cameraExprState)) { release(); return; }
                const t = state.controls.target;
                state.camera.position.set(t.x + offset[0], t.y + offset[1], t.z + offset[2]);
                state.camera.up.set(up[0], up[1], up[2]);
                state.camera.lookAt(t);
                if (fc) fc.lastTargetWorld = t.clone();
                const key = `${t.x.toFixed(4)},${t.y.toFixed(4)},${t.z.toFixed(4)}`;
                stable = key === lastKey ? stable + 1 : 0;
                lastKey = key;
                if ((frames >= 30 && stable >= 45) || ++frames > 1800) { release(); return; }
                requestAnimationFrame(pin);
            };
            requestAnimationFrame(pin);
        } else if (camOk && !dynamicCam) {
            // Static view or free camera: animate to the exact captured camera.
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
    btn.innerHTML = SHARE_VIEW_ICON;
    // Lazily-created floating confirmation pill, anchored next to the button.
    let toast = null;
    let toastTimer = null;
    function flashToast(message) {
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'share-copied-toast';
            (btn.parentElement || document.body).appendChild(toast);
        }
        toast.textContent = message;
        // Force reflow so re-triggering the animation works on rapid clicks.
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Copy with a legacy fallback for contexts where the async Clipboard API
    // is unavailable (insecure origins, sandboxed frames).
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (_) {
                return false;
            }
        }
    }

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const vs = captureViewState({ includeCamera: true });
        replaceView(vs);  // pin camera into the live URL
        const copied = await copyText(window.location.href);
        if (copied) {
            btn.classList.add('copied');
            const prevTitle = btn.title;
            btn.title = 'Shareable link copied';
            flashToast('Shareable link to this camera view copied — you can now share it with others');
            setTimeout(() => { btn.classList.remove('copied'); btn.title = prevTitle; }, 3000);
        } else {
            // Couldn't reach the clipboard — the pinned view is still in the address bar.
            flashToast('Couldn’t copy automatically — the shareable link is in your address bar');
        }
    });
}
