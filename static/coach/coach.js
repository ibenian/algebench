// ============================================================
// coach/coach.js — Quick-intro "Coach" engine.
//
// One engine powers BOTH the guided tour and the daily-hint system.
// It reads steps from the registry (steps self-register via
// steps/*.js), tracks completion by stable step id in localStorage,
// renders a non-blocking spotlight + card, narrates via the existing
// TTS API, and hands the user off into the main chat.
//
// Boot: a single <script type="module" src="/coach/coach.js"> tag.
// This module imports the registry, then the step manifest (which
// registers all steps), then self-initializes on DOMContentLoaded.
// No edits to main.js / chat.js are required.
// ============================================================

import { coach } from './registry.js';
import './steps/index.js';            // side-effect: registers all steps
import { loadBuiltinScene } from '/ui.js';

// ---- Persistence (mirrors the graph-view.js _lsGet/_lsSet pattern) ----
const STEP_VERSION = 1;
const LS = {
    version:        'algebench.coach.version',
    completed:      'algebench.coach.completed',       // JSON array of step ids
    position:       'algebench.coach.position',        // resume step id
    dismissed:      'algebench.coach.dismissed',       // '1' | '0'
    lastHintDate:   'algebench.coach.lastHintDate',    // 'YYYY-MM-DD'
    firstVisitDone: 'algebench.coach.firstVisitDone',  // '1'
    tts:            'algebench.coach.tts',             // '1' | '0' (narration on/off; default on)
    debug:          'algebench.coach.debug',           // '1' | '0' (verbose console logging)
};
const _lsGet  = (k, f = null) => { try { return localStorage.getItem(k) ?? f; } catch { return f; } };
const _lsSet  = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const _lsJSON = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };

const today = () => new Date().toISOString().slice(0, 10);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Debug logging ----
// Enabled by any of: ?coachdebug URL param, localStorage 'algebench.coach.debug'=1,
// or the server --debug flag (body[data-debug-mode="true"]). Toggle at runtime via
// window.AlgeBenchCoach.engine.setDebug(true).
let DEBUG = false;
function log(...args) {
    if (!DEBUG) return;
    try { console.log('%c[coach]', 'color:#8c96ff;font-weight:bold', ...args); } catch {}
}
function initDebug() {
    try {
        const p = new URLSearchParams(location.search);
        if (p.has('coachdebug')) {
            DEBUG = p.get('coachdebug') !== '0';
            _lsSet(LS.debug, DEBUG ? '1' : '0');
            return;
        }
    } catch {}
    if (_lsGet(LS.debug) === '1') { DEBUG = true; return; }
    try { DEBUG = !!(document.body && document.body.dataset && document.body.dataset.debugMode === 'true'); } catch {}
}

// ---- In-memory state ----
const S = {
    completed: new Set(),
    steps: [],          // relevant steps for the current context
    idx: 0,
    active: false,
    target: null,       // currently spotlighted element
    position: 'right',  // card anchor for the current step
    ttsOn: true,        // narration on/off (persisted; default on)
    lastNarration: '',  // last text shown — so the toggle can replay it
    cardMoved: false,   // user dragged the card → don't auto-reposition until next step
    justOpened: false,  // first step after openTour → mention the Tour button once
    spotlitEl: null,    // element currently carrying the .coach-spotlit class
    userGestured: false,// has the user interacted yet? (browser autoplay gate)
    pendingNarration: '',// narration deferred until the first gesture
};

// One-shot tip appended to the first step each time the tour is opened.
const REOPEN_TIP = ' By the way — you can jump back into this tour anytime: just click the ' +
                   'Tour button at the top right.';

// ---- TTS (all optional; no-ops if unavailable or narration is off) ----
// Browsers block the AudioContext until the user interacts, so a narration
// fired on page load (first-visit welcome) can't play. We defer it until the
// first gesture, then flush — see setupAudioUnlock().
function speak(text) {
    if (!text) return;
    S.lastNarration = text;
    if (!S.ttsOn) return;
    if (!S.userGestured) { S.pendingNarration = text; return; }   // wait for a gesture
    if (typeof window.algebenchSpeakText === 'function') {
        try { window.algebenchSpeakText(text); } catch {}
    }
}
// On the first real user gesture, unlock audio and play any deferred narration.
function setupAudioUnlock() {
    const onGesture = () => {
        if (S.userGestured) return;
        S.userGestured = true;
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        const t = S.pendingNarration;
        S.pendingNarration = '';
        if (t && S.ttsOn && typeof window.algebenchSpeakText === 'function') {
            try { window.algebenchSpeakText(t); } catch {}
        }
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
}
function stopTTS() {
    if (typeof window.algebenchStopTTS === 'function') {
        try { window.algebenchStopTTS(); } catch {}
    }
}
function updateTTSIcon() {
    if (!els.ttsToggle) return;
    els.ttsToggle.textContent = S.ttsOn ? '\u{1F50A}' : '\u{1F507}';   // 🔊 / 🔇
    els.ttsToggle.title = S.ttsOn ? 'Narration on — click to mute' : 'Narration off — click to enable';
    els.ttsToggle.classList.toggle('coach-tts-off', !S.ttsOn);
}
function toggleTTS() {
    S.ttsOn = !S.ttsOn;
    _lsSet(LS.tts, S.ttsOn ? '1' : '0');
    log('toggle narration →', S.ttsOn ? 'on' : 'off');
    updateTTSIcon();
    if (!S.ttsOn) {
        stopTTS();
    } else if (S.lastNarration && typeof window.algebenchSpeakText === 'function') {
        try { window.algebenchSpeakText(S.lastNarration); } catch {}   // replay current
    }
}

// ---- Context handed to step.when / step.action ----
function hasScene() {
    return !!(window.lessonSpec && window.lessonSpec.scenes && window.lessonSpec.scenes.length);
}
function chatAvailable() {
    const msg = document.getElementById('chat-unavailable-msg');
    return !(msg && !msg.classList.contains('hidden'));
}
function openChatTab() {
    const panel = document.getElementById('explanation-panel');
    if (panel && panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        const handle = document.getElementById('panel-resize-handle');
        const toggle = document.getElementById('explain-toggle');
        if (handle) handle.style.display = 'block';
        if (toggle) { toggle.style.display = 'block'; toggle.classList.add('active'); }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    document.querySelector('.panel-tab[data-tab="chat"]')?.click();
}
function clickDockTab(name) {
    document.querySelector(`.dock-tab[data-dock-tab="${name}"]`)?.click();
}
// Open the chat tab and reveal the proof panel (if a proof is in context).
function openProofPanel() {
    openChatTab();
    const panel = document.getElementById('proof-panel');
    const toggle = document.getElementById('proof-toggle-btn');
    if (panel && panel.classList.contains('hidden') && toggle && toggle.style.display !== 'none') {
        toggle.click();
    }
    return !!(panel && !panel.classList.contains('hidden'));
}
// Navigate to a scene/step that actually has a proof in context, so the proof
// panel can open. No-op if a proof is already in context for the current step.
function gotoProofStep() {
    const toggle = document.getElementById('proof-toggle-btn');
    if (toggle && toggle.style.display !== 'none') return true;   // proof already in context
    const spec = window.lessonSpec;
    if (!spec || typeof window.navigateTo !== 'function') return false;
    if (spec.proof != null) return true;                          // lesson-level proof: always in context
    const scenes = spec.scenes || [];
    for (let si = 0; si < scenes.length; si++) {
        const sc = scenes[si] || {};
        if (sc.proof != null) { window.navigateTo(si, -1); return true; }
        const steps = sc.steps || [];
        for (let ti = 0; ti < steps.length; ti++) {
            if (steps[ti].proof != null) { window.navigateTo(si, ti); return true; }
        }
    }
    return false;
}
// Make sure the proof panel is showing an actual step — navigate to the first
// one only if nothing is selected yet (idx < 0 means the goal / no step).
function ensureProofStep() {
    if (typeof window.navigateProof !== 'function') return;
    const idx = window.proofStepIndex;
    if (typeof idx !== 'number' || idx < 0) {
        try { window.navigateProof(0); log('ensureProofStep → navigate to step 0'); } catch {}
    } else {
        log(`ensureProofStep: step ${idx} already selected`);
    }
}
// Select the first proof step that has a semantic graph so the Math-tab steps
// land on a rendered graph, not the "select a step" placeholder. Idempotent:
// if a graph is already rendered, leave it (re-clicking tears down open
// node panels / charts).
function selectFirstGraphStep() {
    if (document.querySelector('#graph-mermaid-container svg')) return true;
    const tree = document.getElementById('graph-proof-tree');
    if (!tree) return false;
    const steps = [...tree.querySelectorAll('.gp-tree-step')];
    const node = steps.find((s) => s.querySelector('.gp-tree-step-has-graph')) || steps[0];
    if (node) { node.click(); return true; }
    return false;
}
// Click the first rendered graph node so its details panel (and the derive
// button inside it) appear — used by the node-details / derive-button steps.
// Idempotent: if a node is already selected with its panel open, leave it
// (re-clicking the same node would toggle the selection off).
function selectFirstGraphNode() {
    const host = document.getElementById('graph-info-panel-host');
    const already = document.querySelector('#graph-mermaid-container .d3sg-node.selected, #graph-mermaid-container .d3sg-node.active');
    if (already && host && host.innerHTML.trim()) return true;   // panel already open
    // Prefer an UNselected node so the click opens a panel rather than toggling
    // a stale selection off.
    const node = document.querySelector('#graph-mermaid-container .d3sg-nodes .d3sg-node:not(.selected):not(.active)')
              || document.querySelector('#graph-mermaid-container .d3sg-nodes .d3sg-node');
    if (node) { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
    return false;
}
// Navigate to a scene/step that actually defines sliders, so the slider overlay
// is visible for the sliders step. No-op if sliders are already showing.
function gotoSliderStep() {
    const so = document.getElementById('slider-overlay');
    if (so && !so.classList.contains('hidden') && so.children.length) return true;
    const spec = window.lessonSpec;
    if (!spec || !Array.isArray(spec.scenes) || typeof window.navigateTo !== 'function') return false;
    for (let si = 0; si < spec.scenes.length; si++) {
        const sc = spec.scenes[si] || {};
        if (Array.isArray(sc.sliders) && sc.sliders.length) { window.navigateTo(si, -1); return true; }
        const steps = sc.steps || [];
        for (let ti = 0; ti < steps.length; ti++) {
            if (Array.isArray(steps[ti].sliders) && steps[ti].sliders.length) {
                window.navigateTo(si, ti); return true;
            }
        }
    }
    return false;
}
// Hand off to the MAIN chat via DOM only (no chat.js edit). Auto-sends.
function handToChat(text, examples) {
    openChatTab();
    if (!chatAvailable()) return false;
    const input = document.getElementById('chat-input');
    if (input && text) {
        input.value = text;
        input.dispatchEvent(new Event('input'));
    }
    document.getElementById('chat-send')?.click();
    return true;
}
function buildCtx() {
    return { hasScene: hasScene(), chatAvailable: chatAvailable(),
             openChatTab, clickDockTab, selectFirstGraphStep, selectFirstGraphNode,
             gotoSliderStep, gotoProofStep, openProofPanel, ensureProofStep, handToChat, delay, speak };
}

// ---- Step selection ----
function safeWhen(step, ctx) {
    if (typeof step.when !== 'function') return true;
    try { return !!step.when(ctx); } catch { return true; }
}
function relevantSteps() {
    const ctx = buildCtx();
    return coach.get().filter((s) => safeWhen(s, ctx));
}
// Pending is GLOBAL (across all registered steps), independent of whether a
// scene is loaded yet — so the entry decision doesn't race the async scene
// load, and new steps are detected as pending until actually completed.
// (openTour auto-loads a scene when a pending step needs one.)
function pendingSteps() {
    return coach.get().filter((s) => !S.completed.has(s.id));
}
function markComplete(id) {
    if (!id || S.completed.has(id)) return;
    S.completed.add(id);
    _lsSet(LS.completed, JSON.stringify([...S.completed]));
    log(`mark complete: "${id}" (${S.completed.size}/${coach.get().length})`);
    updateDot();
}
// The Tour button's yellow signal means "there's something to see": shown while
// any step is incomplete (incl. newly-added ones), hidden once all are done.
function updateDot() {
    const dot = btnEl && btnEl.querySelector('.coach-dot');
    if (!dot) return;
    dot.style.display = pendingSteps().length ? '' : 'none';
}

// ---- DOM scaffold (built once) ----
let layerEl, spotlightEl, cardEl, btnEl;
let els = {};   // named card sub-elements

function injectCSS() {
    if (document.getElementById('coach-css')) return;
    const link = document.createElement('link');
    link.id = 'coach-css';
    link.rel = 'stylesheet';
    link.href = '/coach/coach.css';
    document.head.appendChild(link);
}

function buildButton() {
    const toolbar = document.getElementById('toolbar');
    if (!toolbar || document.getElementById('btn-coach')) return;
    btnEl = document.createElement('button');
    btnEl.className = 'tb-btn';
    btnEl.id = 'btn-coach';
    btnEl.title = 'Quick guided tour';
    btnEl.innerHTML = '\u{1F393} Tour<span class="coach-dot"></span>';
    btnEl.addEventListener('click', () => {
        if (S.active) dismiss();
        else openTour();
    });
    // Insert before the explain-toggle so it stays the right-most item (mirroring
    // the scene-dock-toggle on the far left); fall back to append if it's absent.
    const explainToggle = document.getElementById('explain-toggle');
    if (explainToggle && explainToggle.parentElement === toolbar) {
        toolbar.insertBefore(btnEl, explainToggle);
    } else {
        toolbar.appendChild(btnEl);
    }
}

function buildLayer() {
    if (document.getElementById('coach-layer')) return;
    layerEl = document.createElement('div');
    layerEl.id = 'coach-layer';

    spotlightEl = document.createElement('div');
    spotlightEl.id = 'coach-spotlight';

    cardEl = document.createElement('div');
    cardEl.id = 'coach-card';
    cardEl.innerHTML = `
        <div class="coach-card-head">
            <div class="coach-card-title"></div>
            <span class="coach-card-counter"></span>
            <button class="coach-icon-btn coach-tts-toggle" title="Narration on — click to mute">\u{1F50A}</button>
            <button class="coach-icon-btn coach-close" title="Dismiss">✕</button>
        </div>
        <div class="coach-card-body"></div>
        <div class="coach-examples"></div>
        <div class="coach-prompt-row">
            <input id="coach-prompt-input" type="text" placeholder="Ask your own question..." />
            <button id="coach-prompt-send" title="Ask">➜</button>
        </div>
        <div class="coach-card-foot">
            <button class="coach-btn coach-prev">‹ Back</button>
            <div class="coach-foot-spacer"></div>
            <button class="coach-btn coach-secondary"></button>
            <button class="coach-btn coach-btn-primary coach-next">Next ›</button>
        </div>`;

    layerEl.appendChild(spotlightEl);
    layerEl.appendChild(cardEl);
    document.body.appendChild(layerEl);

    els = {
        head:      cardEl.querySelector('.coach-card-head'),
        title:     cardEl.querySelector('.coach-card-title'),
        counter:   cardEl.querySelector('.coach-card-counter'),
        ttsToggle: cardEl.querySelector('.coach-tts-toggle'),
        close:     cardEl.querySelector('.coach-close'),
        body:      cardEl.querySelector('.coach-card-body'),
        examples:  cardEl.querySelector('.coach-examples'),
        promptRow: cardEl.querySelector('.coach-prompt-row'),
        promptInput: cardEl.querySelector('#coach-prompt-input'),
        promptSend:  cardEl.querySelector('#coach-prompt-send'),
        foot:      cardEl.querySelector('.coach-card-foot'),
        prev:      cardEl.querySelector('.coach-prev'),
        secondary: cardEl.querySelector('.coach-secondary'),
        next:      cardEl.querySelector('.coach-next'),
    };

    // close / replay / prompt are stable handlers. Prev/Next/secondary are
    // assigned per-render via .onclick (renderStep / renderOffer) so step mode
    // and offer mode never fire each other's handler.
    els.close.addEventListener('click', () => dismiss());
    els.ttsToggle.addEventListener('click', () => toggleTTS());
    updateTTSIcon();
    const submitPrompt = () => {
        const v = els.promptInput.value.trim();
        if (v) engagePrompt(v);
    };
    els.promptSend.addEventListener('click', submitPrompt);
    els.promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitPrompt(); }
    });
    setupCardDrag();
}

// Drag the card by its header so it never traps the user behind it.
// Dimensions are cached on pointerdown and writes are batched in rAF so the
// card tracks the cursor without per-move layout reflows (no lag).
function setupCardDrag() {
    let drag = null;       // { dx, dy, w, h }
    let raf = 0;
    let pending = null;    // { left, top }
    const flush = () => {
        raf = 0;
        if (!pending) return;
        cardEl.style.left = pending.left + 'px';
        cardEl.style.top  = pending.top + 'px';
        pending = null;
    };
    els.head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.coach-icon-btn')) return;   // let close / mute clicks through
        const r = cardEl.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
        S.cardMoved = true;
        try { els.head.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
        log('card drag start');
    });
    els.head.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const m = 4;
        let left = e.clientX - drag.dx;
        let top  = e.clientY - drag.dy;
        left = Math.max(m, Math.min(left, window.innerWidth - drag.w - m));
        top  = Math.max(m, Math.min(top,  window.innerHeight - drag.h - m));
        pending = { left, top };
        if (!raf) raf = requestAnimationFrame(flush);
    });
    const endDrag = (e) => {
        if (!drag) return;
        drag = null;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        flush();
        try { els.head.releasePointerCapture(e.pointerId); } catch {}
        log('card drag end', { left: cardEl.style.left, top: cardEl.style.top });
    };
    els.head.addEventListener('pointerup', endDrag);
    els.head.addEventListener('pointercancel', endDrag);
}

// ---- Positioning (non-blocking) ----
function resolveTarget(step) {
    if (!step) return null;
    const t = step.target;
    try {
        const el = typeof t === 'function' ? t() : (t ? document.querySelector(t) : null);
        if (el && el.getBoundingClientRect().width > 0) return el;
        return el || null;
    } catch { return null; }
}
function positionSpotlight(el) {
    if (!el) { spotlightEl.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { spotlightEl.style.display = 'none'; return; }
    spotlightEl.style.display = 'block';
    spotlightEl.style.left   = (r.left - 6) + 'px';
    spotlightEl.style.top    = (r.top - 6) + 'px';
    spotlightEl.style.width  = (r.width + 12) + 'px';
    spotlightEl.style.height = (r.height + 12) + 'px';
}
// Mark the spotlighted element so CSS can keep hover-reveal targets (e.g. the
// ✦ ask buttons, which are opacity:0 until hovered) visible while highlighted.
function markSpotlit(el) {
    if (S.spotlitEl && S.spotlitEl !== el) S.spotlitEl.classList.remove('coach-spotlit');
    if (el) el.classList.add('coach-spotlit');
    S.spotlitEl = el || null;
}
function placeCard(el, position) {
    const m = 14;
    cardEl.style.visibility = 'hidden';
    cardEl.style.display = 'block';
    const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    let left, top;
    const r = el ? el.getBoundingClientRect() : null;
    if (!r || position === 'center' || (r.width === 0 && r.height === 0)) {
        left = (window.innerWidth - cw) / 2;
        top  = (window.innerHeight - ch) / 2;
    } else if (position === 'bottom' || position === 'bottom-start') {
        top = r.bottom + m;
        left = position === 'bottom-start' ? r.left : r.left + r.width / 2 - cw / 2;
    } else if (position === 'top') {
        top = r.top - ch - m; left = r.left + r.width / 2 - cw / 2;
    } else if (position === 'left') {
        left = r.left - cw - m; top = r.top + r.height / 2 - ch / 2;
    } else { // 'right' (default)
        left = r.right + m; top = r.top + r.height / 2 - ch / 2;
    }
    left = Math.max(m, Math.min(left, window.innerWidth - cw - m));
    top  = Math.max(m, Math.min(top,  window.innerHeight - ch - m));
    cardEl.style.left = left + 'px';
    cardEl.style.top  = top + 'px';
    cardEl.style.visibility = 'visible';
}
let _repositionRaf = 0;
function reposition() {
    if (_repositionRaf) return;   // coalesce bursts of scroll/resize to one rAF
    _repositionRaf = requestAnimationFrame(() => {
        _repositionRaf = 0;
        if (!S.active) return;
        positionSpotlight(S.target);
        if (S.cardMoved) return;   // honor the user's manual position
        placeCard(S.target, S.position);
    });
}
// Auto-place the card and clear any prior manual drag (called on each new step/offer).
function autoPlace(el, position) {
    S.cardMoved = false;
    placeCard(el, position);
}

// ---- Card rendering modes ----
function show(el, on) { el.classList.toggle('coach-hidden', !on); }

function renderStep(step, idx) {
    const total = S.steps.length;
    els.title.textContent = step.title || 'AlgeBench';
    els.counter.textContent = `${idx + 1} / ${total}`;
    show(els.counter, true);
    els.body.textContent = step.narration || '';

    // Example prompt chips
    els.examples.innerHTML = '';
    const examples = chatAvailable() ? (step.examplePrompts || []) : [];
    for (const ex of examples) {
        const chip = document.createElement('button');
        chip.className = 'coach-chip';
        chip.textContent = ex;
        chip.addEventListener('click', () => engagePrompt(ex));
        els.examples.appendChild(chip);
    }
    show(els.examples, examples.length > 0);

    // Prompt box — only meaningful when chat is available
    show(els.promptRow, chatAvailable());
    if (!chatAvailable() && examples.length === 0) {
        // surface why, once, in the body
    }

    // Footer nav
    show(els.foot, true);
    show(els.prev, true);
    els.prev.disabled = idx === 0;
    els.prev.onclick = () => gotoPrev();
    show(els.secondary, false);
    els.secondary.onclick = null;
    els.next.textContent = idx === total - 1 ? 'Done ✓' : 'Next ›';
    els.next.onclick = () => gotoNext();
}

function renderOffer({ title, message, primaryLabel, onPrimary, secondaryLabel, onSecondary }) {
    markSpotlit(null);   // offer cards have no spotlight target
    els.title.textContent = title;
    show(els.counter, false);
    els.body.textContent = message;
    els.examples.innerHTML = ''; show(els.examples, false);
    show(els.promptRow, false);
    show(els.foot, true);
    show(els.prev, false);
    show(els.secondary, !!secondaryLabel);
    els.secondary.textContent = secondaryLabel || '';
    els.secondary.onclick = onSecondary || null;
    els.next.textContent = primaryLabel;
    els.next.onclick = onPrimary;
}

// ---- Player flow ----
const _repoOpts = { capture: true, passive: true };
function attachReposition() {
    window.addEventListener('resize', reposition, _repoOpts);
    window.addEventListener('scroll', reposition, _repoOpts);
}
function detachReposition() {
    window.removeEventListener('resize', reposition, _repoOpts);
    window.removeEventListener('scroll', reposition, _repoOpts);
    if (_repositionRaf) { cancelAnimationFrame(_repositionRaf); _repositionRaf = 0; }
}
function openPlayer() {
    S.active = true;
    btnEl?.classList.add('active');
    cardEl.style.display = 'block';
    attachReposition();
}
function closePlayer() {
    stopTTS();
    S.active = false;
    btnEl?.classList.remove('active');
    cardEl.style.display = 'none';
    spotlightEl.style.display = 'none';
    markSpotlit(null);
    detachReposition();
}
function dismiss() {
    ensureReady();   // may be invoked via the engine before init()
    _lsSet(LS.dismissed, '1');
    log('dismiss (will switch to once-a-day hints)');
    closePlayer();
}

async function showStep(i) {
    stopTTS();
    const step = S.steps[i];
    if (!step) { finish(); return; }
    S.idx = i;
    log(`showStep ${i + 1}/${S.steps.length}: "${step.id}"`);

    // Pre-show action (switch tabs, load lesson, etc.)
    if (typeof step.action === 'function') {
        try { await step.action(buildCtx()); }
        catch (e) { log(`step "${step.id}" action error:`, e); }
        await delay(120);
    }

    const el = resolveTarget(step);
    if (!el && step.optional) {           // skip optional steps with no target
        log(`step "${step.id}" optional + no target → skip`);
        markComplete(step.id);
        if (i < S.steps.length - 1) return showStep(i + 1);
        return finish();
    }
    if (!el) log(`step "${step.id}" target not found → centered card, no spotlight`);

    S.target = el;
    S.position = step.position || 'right';

    // On the first step after the tour is (re)opened, mention the Tour button.
    let narration = step.narration || '';
    if (S.justOpened) {
        S.justOpened = false;
        narration += REOPEN_TIP;
    }

    renderStep(step, i);
    if (narration !== step.narration) els.body.textContent = narration;   // include the tip
    positionSpotlight(el);
    markSpotlit(el);
    autoPlace(el, S.position);
    _lsSet(LS.position, step.id);
    speak(narration);
}

function gotoNext() {
    const step = S.steps[S.idx];
    if (step) markComplete(step.id);
    if (S.idx >= S.steps.length - 1) { finish(); return; }
    showStep(S.idx + 1);
}
function gotoPrev() {
    if (S.idx > 0) showStep(S.idx - 1);
}
function finish() {
    // NOTE: no explicit stopTTS() here — speak() interrupts the prior narration
    // itself. Calling stopTTS() broadcasts a kill that races in and silences the
    // finish narration before it starts.
    renderOffer({
        title: 'You’re all set \u{1F389}',
        message: 'That’s the tour! Open it again anytime from the Tour button. ' +
                 'Now explore — drag the 3D view, switch steps, and ask the AI anything.',
        primaryLabel: 'Done',
        onPrimary: () => closePlayer(),
    });
    spotlightEl.style.display = 'none';
    autoPlace(null, 'center');
    speak('That’s the tour! You’re all set. Now explore on your own, and ask the AI whenever you’re curious.');
}

// Prompt engaged from the player → continue in the MAIN chat.
function engagePrompt(text) {
    stopTTS();
    const step = S.steps[S.idx];
    const ok = handToChat(text, step?.examplePrompts);
    log('engagePrompt → main chat', { text, chatAvailable: ok });
    // Mark chat-related steps complete so they don't re-nag.
    if (step) markComplete(step.id);
    markComplete('chat-window');
    markComplete('ask-math');
    renderOffer({
        title: 'This is the main chat',
        message: ok
            ? 'I’ve moved your question into the main AI chat on the right — keep the ' +
              'conversation going there. Ask about any step, symbol, or sub-expression; the AI sees ' +
              'exactly what’s on your screen.'
            : 'The AI chat lives on the right. It needs a Gemini API key to answer — once that’s ' +
              'set you can ask about any step, symbol, or sub-expression.',
        primaryLabel: 'Got it',
        onPrimary: () => closePlayer(),
    });
    spotlightEl.style.display = 'none';
    autoPlace(document.getElementById('explanation-panel'), 'left');
}

// ---- Auto-pick a simple lesson when none is loaded ----
async function autoPickLesson() {
    try {
        const resp = await fetch('/api/scenes', { cache: 'no-store' });
        const data = await resp.json();
        const names = data.scenes || [];
        if (!names.length) return false;
        // Prefer a lesson that actually has a proof / semantic graph, so the
        // Math-tab steps land on real content. Lightest graph-having scene first.
        const prefer = ['artemis-ii-mission-simulation', 'quantum-states',
                        'atmospheric-entry-physics', 'vector-operations'];
        const pick = prefer.find((p) => names.includes(p)) || names[0];
        log('autoPickLesson →', pick);
        return await loadBuiltinScene(pick);
    } catch (e) { log('autoPickLesson failed:', e); return false; }
}

// Open the full tour (button / resume / first-time start).
async function openTour(startId) {
    ensureReady();   // may be invoked via the engine before init()
    log('openTour', { startId, hasScene: hasScene() });
    _lsSet(LS.dismissed, '0');   // opening = re-engaging; leave daily-hint mode
    if (!hasScene()) {
        await autoPickLesson();
        await delay(400);   // let the scene render so targets exist
    }
    S.steps = relevantSteps();
    log('openTour relevant steps:', S.steps.map((s) => s.id));
    if (!S.steps.length) { log('openTour: no relevant steps'); return; }
    openPlayer();
    let start = 0;
    if (startId) {
        const i = S.steps.findIndex((s) => s.id === startId);
        if (i >= 0) start = i;
    } else {
        const p = S.steps.findIndex((s) => !S.completed.has(s.id));
        start = p >= 0 ? p : 0;
    }
    S.justOpened = true;   // first step will mention the Tour button
    showStep(start);
}

// ---- Entry decision logic ----
function loadState() {
    // Migrate (bump only — never clear completed; that powers new-step detection)
    const ver = parseInt(_lsGet(LS.version, '0'), 10) || 0;
    if (ver < STEP_VERSION) _lsSet(LS.version, String(STEP_VERSION));
    const rawCompleted = _lsJSON(LS.completed, []);   // tolerate corrupted (non-array) state
    S.completed = new Set(Array.isArray(rawCompleted) ? rawCompleted : []);
    S.ttsOn = _lsGet(LS.tts, '1') !== '0';   // default on
    updateTTSIcon();
}

function showWelcome(firstTime) {
    openPlayer();
    spotlightEl.style.display = 'none';
    const all = coach.get();
    const doneCount = all.filter((s) => S.completed.has(s.id)).length;
    if (firstTime) {
        renderOffer({
            title: 'Welcome to AlgeBench \u{1F44B}',
            message: 'I’m your guide. In a quick tour I’ll show you how to browse interactive ' +
                     'lessons, ask the AI anything, dive into the semantic graph of a proof, and play ' +
                     'with the 3D viewport. Ready?',
            primaryLabel: 'Start tour',
            onPrimary: () => openTour(),
            secondaryLabel: 'Not now',
            onSecondary: () => closePlayer(),
        });
        speak('Welcome to AlgeBench! I’m your guide. Let me give you a quick tour of what you can do ' +
              'here — from browsing lessons to asking the AI about the math.');
    } else {
        renderOffer({
            title: 'Welcome back \u{1F44B}',
            message: `Good to see you again. You’ve explored ${doneCount} of ${all.length} things so ` +
                     'far — want to pick up where you left off?',
            primaryLabel: 'Continue',
            onPrimary: () => openTour(_lsGet(LS.position)),
            secondaryLabel: 'Not now',
            onSecondary: () => closePlayer(),
        });
        speak('Welcome back! Want to pick up the tour where you left off?');
    }
    autoPlace(null, 'center');
}

function showDailyHint(step) {
    openPlayer();
    spotlightEl.style.display = 'none';
    renderOffer({
        title: 'A quick tip \u{1F4A1}',
        message: `There’s more to discover: ${step.title}. Want me to show you?`,
        primaryLabel: 'Show me',
        onPrimary: () => openTour(step.id),
        secondaryLabel: 'Not now',
        onSecondary: () => closePlayer(),
    });
    autoPlace(null, 'center');
}

function decide() {
    loadState();
    if (S.active) { log('decide: tour already active → skip auto offer'); return; }
    const pending = pendingSteps();
    log('decide:', {
        firstVisit: _lsGet(LS.firstVisitDone) !== '1',
        dismissed: _lsGet(LS.dismissed) === '1',
        completed: [...S.completed],
        pending: pending.map((s) => s.id),
        lastHintDate: _lsGet(LS.lastHintDate),
        today: today(),
    });

    // First visit — offer the tour; do not auto-dismiss.
    if (_lsGet(LS.firstVisitDone) !== '1') {
        _lsSet(LS.firstVisitDone, '1');
        log('→ first visit: welcome offer');
        showWelcome(true);
        return;
    }

    if (pending.length === 0) { log('→ all steps complete: nothing automatic'); return; }

    if (_lsGet(LS.dismissed) === '1') {
        // Daily-hint mode: one nudge per calendar day until all steps are done.
        if (_lsGet(LS.lastHintDate) !== today()) {
            _lsSet(LS.lastHintDate, today());
            log('→ daily hint:', pending[0].id);
            showDailyHint(pending[0]);
        } else {
            log('→ dismissed + already hinted today: stay quiet');
        }
        return;
    }

    // Returning, not dismissed, incomplete → welcome back + resume.
    log('→ returning, not dismissed: welcome back');
    showWelcome(false);
}

// ---- Programmatic control surface (used by the chat `control_coach` tool) ----

// Resolve a user-supplied step reference (id, fuzzy title, or 1-based index)
// to a concrete step id. Returns undefined if nothing matches.
function resolveStepId(step) {
    if (step == null || step === '') return undefined;
    const all = coach.get();
    const n = Number(step);
    if (Number.isFinite(n) && String(step).trim() !== '' && !/[a-z]/i.test(String(step))) {
        const i = Math.max(0, Math.min(all.length - 1, Math.round(n) - 1));   // 1-based
        return all[i] && all[i].id;
    }
    const key = String(step).toLowerCase().trim();
    let s = all.find((x) => x.id.toLowerCase() === key);
    if (!s) s = all.find((x) => x.id.toLowerCase().includes(key)
                              || (x.title || '').toLowerCase().includes(key));
    return s && s.id;
}

function coachStatus() {
    const all = coach.get();
    return {
        active: S.active,
        currentStepId: S.active && S.steps[S.idx] ? S.steps[S.idx].id : null,
        currentStepNumber: S.active ? S.idx + 1 : null,
        total: all.length,
        completed: [...S.completed],
        remaining: all.filter((s) => !S.completed.has(s.id)).map((s) => s.id),
        dismissed: _lsGet(LS.dismissed) === '1',
        narration: S.ttsOn ? 'on' : 'off',
        steps: all.map((s) => ({ id: s.id, title: s.title })),
    };
}

// Single entry point for the chat tool. Returns a small result object.
function coachControl(action, opts = {}) {
    ensureReady();   // engine may be called (via the chat tool) before init() runs
    action = String(action || '').toLowerCase().trim();
    const step = opts.step;
    log('control_coach', { action, step });
    switch (action) {
        case 'start': case 'activate': case 'open': case 'resume': case 'show': {
            const id = resolveStepId(step);
            openTour(id);
            return { ok: true, action, status: coachStatus() };
        }
        case 'goto': case 'step': case 'jump': {
            const id = resolveStepId(step);
            if (!id) return { ok: false, action, error: `No step matches "${step}".`, status: coachStatus() };
            openTour(id);
            return { ok: true, action, stepId: id, status: coachStatus() };
        }
        case 'next':
            if (S.active) gotoNext(); else openTour();   // resume if dismissed/closed
            return { ok: true, action, status: coachStatus() };
        case 'prev': case 'back':
            if (S.active) gotoPrev(); else openTour();
            return { ok: true, action, status: coachStatus() };
        case 'stop': case 'deactivate': case 'close': case 'dismiss': case 'hide':
            dismiss();
            return { ok: true, action, status: coachStatus() };
        case 'reset': case 'restart': {
            window.AlgeBenchCoach.engine.reset();
            _lsSet(LS.dismissed, '0');
            openTour();   // start over from the first step
            return { ok: true, action, status: coachStatus() };
        }
        case 'status': case 'info': case '':
            return { ok: true, action: 'status', status: coachStatus() };
        default:
            return { ok: false, action, error: `Unknown action "${action}".`, status: coachStatus() };
    }
}

// ---- Boot ----
// Idempotent bootstrap: builds the CSS/button/layer and audio-unlock hook
// without any auto-offer side effects. Safe to call from engine methods that
// may run (via the chat tool) before init()'s DOMContentLoaded handler fires.
let _ready = false;
function ensureReady() {
    if (_ready) return;
    _ready = true;
    initDebug();
    injectCSS();
    buildButton();
    buildLayer();
    loadState();          // hydrate completed/ttsOn even if controlled before init()/decide()
    setupAudioUnlock();   // defer narration until the first gesture (autoplay policy)
}
function init() {
    ensureReady();
    log('init (debug logging on)');
    try { decide(); } catch (e) { console.error('[coach] init failed:', e); }
    updateDot();   // reflect completion state on the Tour button's signal dot
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Public control surface — used by the chat `control_coach` tool and handy for
// manual driving from the console.
window.AlgeBenchCoach.engine = {
    openTour,
    dismiss,
    control: coachControl,     // control_coach tool entry point
    status: coachStatus,
    state: () => ({ ...S, completed: [...S.completed] }),
    setDebug(on) { DEBUG = !!on; _lsSet(LS.debug, on ? '1' : '0'); log('debug logging', on ? 'enabled' : 'disabled'); },
    reset() {
        [LS.completed, LS.position, LS.dismissed, LS.lastHintDate, LS.firstVisitDone, LS.version]
            .forEach((k) => { try { localStorage.removeItem(k); } catch {} });
        S.completed = new Set();
        log('reset tour progress');
    },
};
