// ============================================================
// AlgeBench AI Chat Agent (Gemini-powered)
// Integrated as a tab in the explanation panel
// ============================================================
//
// Until phase 4e this file was a CLASSIC, non-module script
// (`<script src="/chat.js">`), so every top-level `function` became a window
// property automatically and other modules reached them as bare globals. It is
// now an ES module in the index bundle, which removes those automatic globals —
// so the whole public surface is re-assigned to `window` explicitly at the
// bottom of this file. Replacing that flat surface with an `AlgeBench`
// namespace is issue #406, deliberately deferred to post-migration.
//
// The ambient declarations for both directions live in src/globals.d.ts.

export {};

import { invokeExpert, ExpertError } from '/expert-client.js';
import { applyBuildOps, ensureLessonFormat, PlacementError } from '/lesson-placement.js';
import {
    buildSceneRequestFromToolCall, interpretBuildSceneReply,
    type BuildSceneToolArgs,
} from '/build-scene-tool.js';
import {
    landOnSlot, placeholderScene, releaseOp, reserveOp, showBuildPill, slotIndex,
} from '/build-progress.js';

/**
 * How long to wait for a scene build.
 *
 * Shorter than DERIVE_TIMEOUT_MS: a build is ONE LM call with no verify-and-retry
 * loop behind it, so the 6-minute derivation budget would leave a user staring at
 * a dead chat for minutes after the request had already failed.
 */
const BUILD_SCENE_TIMEOUT_MS = 90_000;

/** One turn of the chat transcript sent back to the server as history. */
interface ChatHistoryEntry {
    role: 'user' | 'assistant';
    text: string;
}

/** The `/api/chat` response body. */
interface ChatApiResponse {
    response: string;
    toolCalls?: AlgeBenchChatToolCall[];
    debug?: { systemPrompt?: string; contents?: unknown[] };
}

/** Visual state of a message's speaker button. */
type SpeakBtnState = 'active' | 'loading' | null;

/**
 * The per-message speaker button. chat.js hung its polling handles and helpers
 * straight onto the DOM node; the port keeps that exactly, typed.
 */
interface SpeakButton extends HTMLButtonElement {
    _ttsLoadPoll?: ReturnType<typeof setInterval> | null;
    _ttsStatePoll?: ReturnType<typeof setInterval> | null;
    _setBtnState?: (state: SpeakBtnState) => void;
    _downloadBtn?: HTMLAnchorElement;
    _ignoreNextClick?: boolean;
}

/** A rendered chat message; assistant messages carry their own speak starter. */
interface ChatMessageElement extends HTMLDivElement {
    _startSpeak?: () => void;
}

// ----- Chat State -----
let chatHistory: ChatHistoryEntry[] = [];       // [{role: 'user'|'assistant', text: string}]
let chatAvailable = false;  // set true if GEMINI_API_KEY is configured
let chatSending = false;
let activeSpeakBtn: SpeakButton | null = null;  // the .msg-speak-btn currently playing TTS
let welcomeInFlight = false;
let welcomeRequestId = 0;
let memorySnapshot: Record<string, AlgeBenchMemoryEntry> | null = null;
let ttsCharacterPicker: GeminiCharacterPicker | null = null;
let selectedTtsCharacter = 'joker';
let selectedTtsVoice = 'Charon';
let selectedTtsMode = 'read';

const CHAT_HISTORY_MAX = Infinity;

function _escHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

let _presetPrompts: string[] = [];

// Track which surface the user last interacted with so chat context can
// disambiguate "what are they looking at right now" — the dock tab being
// "graph" only tells us the graph is *visible*, not that the user is
// actually working in it (vs. the 3D viewport or the side panel).
// Values: 'graph' | 'viewport' | 'panel' | null
let _lastFocusedSurface: string | null = null;
function _classifyFocusTarget(target: EventTarget | null): string | null {
    // Event targets are only sometimes Elements (window, document, media
    // elements); the original guarded on `.closest` existing, so keep that.
    const el = target as Element | null;
    if (!el || !el.closest) return null;
    if (el.closest('#graph-viewport, #dock-tab-graph, .graph-panel-info, .graph-panel-tooltip')) return 'graph';
    if (el.closest('#mathbox-container, #mathbox-overlay, canvas')) return 'viewport';
    if (el.closest('.explanation-panel, .panel-tab, .tab-content, #chat-input, #preset-prompts')) return 'panel';
    return null;
}
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (e) => {
        const surface = _classifyFocusTarget(e.target);
        if (surface) _lastFocusedSurface = surface;
    }, true);
}

function setPresetPrompts(prompts: string[] | null | undefined): void {
    _presetPrompts = prompts || [];
    const container = document.getElementById('preset-prompts');
    if (!container) return;
    container.innerHTML = '';
    if (!_presetPrompts.length) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    for (const text of _presetPrompts) {
        const btn = document.createElement('button');
        btn.className = 'preset-prompt-btn';
        btn.textContent = text;
        btn.title = text + '\n\nClick to send · ⌘/Ctrl-click to edit';
        btn.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) {
                const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
                if (input) {
                    input.value = text;
                    input.focus();
                    input.dispatchEvent(new Event('input'));
                }
            } else {
                if (!chatSending) sendChatMessage(text);
            }
        });
        container.appendChild(btn);
    }
}

function shouldSkipWelcome(): boolean {
    return chatHistory.length > 0 || chatSending;
}

// ----- Context Snapshot -----
function buildChatContext(): AlgeBenchChatContext {
    const ctx: AlgeBenchChatContext = {};

    // ---- Lesson metadata ----
    if (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.title) {
        ctx.lessonTitle = lessonSpec.title;
    }

    // ---- Current scene JSON (the complete definition) ----
    if (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes) {
        ctx.totalScenes = lessonSpec.scenes.length;
        const idx = typeof currentSceneIndex !== 'undefined' ? currentSceneIndex : 0;
        ctx.sceneNumber = idx + 1;  // 1-based for agent
        const scene = lessonSpec.scenes[idx];
        if (scene) {
            // Dump the full scene definition — the agent gets everything
            ctx.currentScene = scene;
        }

        // Scene tree for navigation awareness
        ctx.sceneTree = lessonSpec.scenes.map((s, i) => {
            const entry: AlgeBenchChatSceneTreeEntry = { sceneNumber: i + 1, title: s.title || ('Scene ' + (i + 1)) };
            if (s.steps && s.steps.length > 0) {
                entry.steps = s.steps.map((st, j) => ({
                    stepNumber: j + 1,  // 1-based: step 1 = first step
                    title: st.title || ('Step ' + (j + 1)),
                    description: st.description || ''
                }));
            }
            return entry;
        });
    }

    // ---- Live runtime state (not in scene JSON) ----
    const runtime: AlgeBenchChatRuntimeContext = {};

    // Step navigation — agent-facing: 0=root, 1=first step, 2=second, etc.
    // Internal currentStepIndex: -1=root, 0=first step, 1=second, etc.
    const internalStep = typeof currentStepIndex !== 'undefined' ? currentStepIndex : -1;
    runtime.stepNumber = internalStep + 1;  // Convert: internal -1→0 (root), 0→1 (first step), etc.

    // Camera
    if (typeof camera !== 'undefined' && camera) {
        runtime.cameraPosition = {
            x: +camera.position.x.toFixed(2),
            y: +camera.position.y.toFixed(2),
            z: +camera.position.z.toFixed(2)
        };
    }
    if (typeof controls !== 'undefined' && controls && controls.target) {
        runtime.cameraTarget = {
            x: +controls.target.x.toFixed(2),
            y: +controls.target.y.toFixed(2),
            z: +controls.target.z.toFixed(2)
        };
    }

    // Available camera views
    if (typeof CAMERA_VIEWS !== 'undefined') {
        const viewNames = Object.keys(CAMERA_VIEWS).filter(k => k !== '__agent' && k !== '_step' && k !== 'reset');
        if (viewNames.length > 0) {
            runtime.cameraViews = viewNames;
        }
    }

    // Visible elements (computed from scene + step)
    if (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes && typeof getAllElements === 'function') {
        const scene = lessonSpec.scenes[currentSceneIndex];
        if (scene) {
            const els = getAllElements(scene, currentStepIndex);
            const NON_VISUAL_TYPES = new Set(['slider', 'info', 'preset_prompts']);
            runtime.visibleElements = els
                .filter(el => {
                    if (NON_VISUAL_TYPES.has(el.type)) return false;
                    if (typeof elementRegistry !== 'undefined' && el.id && elementRegistry[el.id]) {
                        return !elementRegistry[el.id]!.hidden;
                    }
                    return true;
                })
                .map(el => ({
                    label: el.label || el.id || el.type,
                    type: el.type
                }));
        }
    }

    // Slider current values + definitions
    if (typeof sceneSliders !== 'undefined' && sceneSliders) {
        const sliders: Record<string, AlgeBenchSliderState> = {};
        for (const [id, s] of Object.entries(sceneSliders)) {
            sliders[id] = {
                value: s.value,
                min: s.min,
                max: s.max,
                step: s.step,
                label: s.label || id
            };
        }
        if (Object.keys(sliders).length > 0) {
            runtime.sliders = sliders;
        }
    }

    // Caption text — use raw data-markdown source to avoid KaTeX MathML artifacts
    const captionEl = document.getElementById('step-caption');
    if (captionEl && !captionEl.classList.contains('hidden')) {
        const raw = captionEl.dataset.markdown || captionEl.textContent;
        runtime.currentCaption = raw!.trim();
    }

    // Active panel tab (doc vs chat)
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) {
        runtime.activeTab = activeTab.id.replace('tab-', '');
    }

    // Projection mode
    if (typeof currentProjection !== 'undefined') {
        runtime.projection = currentProjection;
    }

    // Proof context
    if (typeof getProofContext === 'function') {
        const proofCtx = getProofContext();
        if (proofCtx) {
            runtime.proof = proofCtx;
        }
    }

    // Semantic-graph dock context (issue #124)
    if (typeof window.algebenchGetGraphPanelState === 'function') {
        try {
            const gp = window.algebenchGetGraphPanelState();
            if (gp) runtime.graphPanel = gp;
        } catch (e) {
            console.warn('[chat] failed to read graph panel state:', e);
        }
    }

    // Which surface did the user last touch? Disambiguates dock visibility
    // from actual user attention (issue #124 follow-up).
    if (_lastFocusedSurface) {
        runtime.lastFocusedSurface = _lastFocusedSurface;
    }

    // High-level "what is the user actually seeing right now?" — composed
    // from the dock tab (main viewport), the right-panel tab, and the
    // proof-panel toggle. Gives the agent a one-glance summary it can use
    // for both the welcome message and contextual replies.
    // Examples:
    //   ['scene', 'doc']
    //   ['scene', 'chat', 'proof']
    //   ['semantic graph', 'chat', 'proof']
    const viewing: string[] = [];
    const graphActive = runtime.graphPanel && runtime.graphPanel.open;
    viewing.push(graphActive ? 'semantic graph' : 'scene');
    if (runtime.activeTab === 'chat') {
        viewing.push('chat');
        const proofPanel = document.getElementById('proof-panel');
        if (proofPanel && !proofPanel.classList.contains('hidden')) {
            viewing.push('proof');
        }
    } else if (runtime.activeTab === 'doc') {
        viewing.push('doc');
    }
    runtime.userViewing = viewing;

    // Guided-tour ("Coach") state so the agent can answer questions about it
    // and decide whether/how to drive it via the control_coach tool.
    try {
        const coachEngine = window.AlgeBenchCoach && window.AlgeBenchCoach.engine;
        if (coachEngine && typeof coachEngine.status === 'function') {
            runtime.coach = coachEngine.status();
        }
    } catch {}

    ctx.runtime = runtime;
    return ctx;
}

window.algebenchBuildChatContext = buildChatContext;

// ----- Tab Switching -----
function switchPanelTab(tabName: string): void {
    // Update tab buttons
    document.querySelectorAll<HTMLElement>('.panel-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('active', el.id === 'tab-' + tabName);
    });
    // Deeplink sync: which right-panel tab (Doc/Chat) is open is shareable.
    try { window.dispatchEvent(new CustomEvent('algebench:panelchange')); } catch (_) { /* ignore */ }
    // Focus input and greet only when chat history is empty
    if (tabName === 'chat') {
        if (typeof refreshProofPanel === 'function') refreshProofPanel();
        const input = document.getElementById('chat-input');
        if (input) setTimeout(() => input.focus(), 50);
        if (chatAvailable && !welcomeInFlight && !shouldSkipWelcome()) {
            // Delay so any concurrently-triggered user message can arrive first.
            // Re-check at execution time — if the user already sent something, skip.
            setTimeout(() => {
                if (!welcomeInFlight && !shouldSkipWelcome()) {
                    sendWelcomeMessage();
                }
            }, 800);
        }
    }
}

// ----- UI Setup -----
function setupChat(): void {
    // Check availability and show/hide tab bar
    fetch('/api/chat/available')
        .then(r => r.json())
        .then((data: { available: boolean }) => {
            chatAvailable = data.available;
            if (!chatAvailable) {
                const msg = document.getElementById('chat-unavailable-msg');
                const tab = document.getElementById('tab-chat');
                if (msg) msg.classList.remove('hidden');
                if (tab) tab.classList.add('unavailable');
            }
        })
        .catch(() => {
            chatAvailable = false;
            const msg = document.getElementById('chat-unavailable-msg');
            const tab = document.getElementById('tab-chat');
            if (msg) msg.classList.remove('hidden');
            if (tab) tab.classList.add('unavailable');
        });

    // Tab click handlers
    document.querySelectorAll<HTMLElement>('.panel-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            switchPanelTab(btn.dataset.tab!);
        });
    });

    // 'C' keyboard shortcut — open panel on Chat tab
    document.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const panel = document.getElementById('explanation-panel')!;
            const toggle = document.getElementById('explain-toggle')!;
            const handle = document.getElementById('panel-resize-handle')!;
            // Open panel if hidden
            if (panel.classList.contains('hidden')) {
                panel.classList.remove('hidden');
                handle.style.display = 'block';
                toggle.style.display = 'block';
                toggle.classList.add('active');
                setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
            }
            switchPanelTab('chat');
        }
    });

    const input = document.getElementById('chat-input') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('chat-send')!;
    initChatTtsControls();

    // Send on Enter (Shift+Enter for newline)
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = input.value.trim();
            if (text && !chatSending) {
                input.value = '';
                input.style.height = 'auto';
                sendChatMessage(text);
            }
        }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    sendBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (text && !chatSending) {
            input.value = '';
            input.style.height = 'auto';
            sendChatMessage(text);
        }
    });
}

function initChatTtsControls(): void {
    const lib = window.GeminiVoiceCharacterSelector;
    if (!lib) return;

    const characterBtn = document.getElementById('chatCharacterBtn');
    const characterPalette = document.getElementById('chatCharacterPalette');
    const characterSearch = document.getElementById('chatCharacterSearch');
    const characterList = document.getElementById('chatCharacterList');
    const characterBackdrop = document.getElementById('chatCharacterBackdrop');
    const voiceSelect = document.getElementById('chatVoiceSelect') as HTMLSelectElement | null;
    if (!characterBtn || !characterPalette || !characterSearch || !characterList || !characterBackdrop || !voiceSelect) {
        return;
    }

    // Keep overlay UI outside the panel's stacking/overflow context so it can
    // position globally and never be clipped by the right-side panel.
    if (characterPalette.parentElement !== document.body) {
        document.body.appendChild(characterPalette);
    }
    if (characterBackdrop.parentElement !== document.body) {
        document.body.appendChild(characterBackdrop);
    }

    selectedTtsVoice = lib.setupVoiceSelect(voiceSelect, {
        includeSystem: false,
        storageKey: 'algebenchTtsVoice',
        defaultValue: 'Charon'
    });

    ttsCharacterPicker = new lib.CharacterPicker({
        buttonEl: characterBtn,
        paletteEl: characterPalette,
        searchEl: characterSearch,
        listEl: characterList,
        backdropEl: characterBackdrop,
        options: lib.CHARACTER_OPTIONS,
        groupMap: lib.CHARACTER_GROUPS,
        groupOrder: lib.CHARACTER_GROUP_ORDER,
        storageKey: 'algebenchTtsCharacter',
        recentsKey: 'algebenchTtsCharacterRecents',
        defaultId: 'joker',
        hotkey: 'k',
        onChange: (characterId) => {
            selectedTtsCharacter = characterId;
            const opt = lib.CHARACTER_OPTIONS.find(o => o.id === characterId);
            if (opt && opt.defaultVoice && voiceSelect) {
                voiceSelect.value = opt.defaultVoice;
                selectedTtsVoice = opt.defaultVoice;
                localStorage.setItem('algebenchTtsVoice', opt.defaultVoice);
            }
        }
    });
    selectedTtsCharacter = ttsCharacterPicker.init();

    voiceSelect.addEventListener('change', () => {
        selectedTtsVoice = voiceSelect.value || 'Charon';
    });

    const ttsModeSelect = document.getElementById('chatTtsModeSelect') as HTMLSelectElement | null;
    if (ttsModeSelect) {
        selectedTtsMode = localStorage.getItem('algebenchTtsMode') || 'read';
        ttsModeSelect.value = selectedTtsMode;
        ttsModeSelect.addEventListener('change', () => {
            selectedTtsMode = ttsModeSelect.value;
            localStorage.setItem('algebenchTtsMode', selectedTtsMode);
        });
    }
}

// ----- Message Sending -----
/**
 * Run one `build_scene` tool call: assemble, ask the expert, apply, navigate.
 *
 * Returns the assistant text that must join `chatHistory`, or '' when there is
 * nothing to record. The CALLER pushes it, after the agent's own reply — order
 * matters. A clarifying question is recovered next turn by pairing an assistant
 * turn ending in '?' with the user's next turn, so a question filed BEFORE the
 * agent's reply has that reply sitting between it and the answer, the pair is
 * never made, and the expert asks the same question forever.
 */
async function runBuildSceneTool(tc: AlgeBenchChatToolCall): Promise<string> {
    const args = (tc.args || {}) as BuildSceneToolArgs;

    let body;
    try {
        body = buildSceneRequestFromToolCall(
            args,
            (typeof lessonSpec !== 'undefined' && lessonSpec ? lessonSpec : null) as never,
            chatHistory,
        );
    } catch (e) {
        // An impossible ask — an empty intent, or a replace naming a scene that
        // is not there. Local, so say so locally rather than spend a request.
        const why = e instanceof Error ? e.message : String(e);
        console.warn('build_scene: not sent —', why);
        addChatMessage('assistant', `I couldn't build that: ${why}`);
        return '';
    }

    console.log('%c🎬 build_scene:', 'color: #ffaa00; font-weight: bold',
        body.op, 'at index', body.sceneIndex, '|', body.intent.slice(0, 120));

    // Promote a displayed single scene into a lesson wrapper if there isn't one
    // yet, so the very first build has somewhere to land.
    const { lesson, bootstrap } = ensureLessonFormat(
        (typeof lessonSpec !== 'undefined' && lessonSpec ? lessonSpec : null) as never,
        (typeof currentSpec !== 'undefined' && currentSpec ? currentSpec : null) as never,
    );
    const target = body.sceneIndex;

    // Reserve the slot BEFORE the request, and navigate to it. A build takes tens
    // of seconds; without this the whole interval looks like nothing happening,
    // because the only evidence is a chat bubble that arrives when it is over.
    // A replace needs no placeholder — the user is already looking at the scene
    // being rebuilt, and emptying it would hide what they are comparing against.
    const placeholder = body.op === 'insert' ? placeholderScene(body.intent) : null;
    if (placeholder) {
        try {
            applyBuildOps(lesson, [reserveOp(target, placeholder)]);
        } catch (e) {
            console.error('build_scene: could not reserve a slot', e);
            addChatMessage('assistant', `I couldn't make room for that scene: ${String(e)}`);
            return '';
        }
    }
    lessonSpec = lesson as never;
    // Bootstrapping made the displayed scene into scenes[0]; navigation still
    // thinks it is showing a standalone spec, so `navigateTo` would see no scene
    // change and refuse to move.
    if (bootstrap.bootstrapped && bootstrap.promotedScene) {
        currentSceneIndex = 0;
        currentStepIndex = -1;
    }
    showBuiltScene(lesson, target, -1);
    const hidePill = showBuildPill(body.op === 'replace' ? 'Rebuilding scene…' : 'Building scene…');

    /** Undo the reservation, so a build that produced nothing leaves nothing. */
    const release = (): void => {
        if (!placeholder) return;
        // By identity, not by the index it was reserved at: the lesson can move
        // during a build, and deleting index `target` blind would remove whatever
        // scene had shifted into it.
        const at = releaseOp(slotIndex(lesson.scenes, placeholder), placeholder);
        if (!at) return;
        try {
            applyBuildOps(lesson, [at]);
            showBuiltScene(lesson, Math.max(0, (at.at.index ?? 1) - 1), -1);
        } catch (e) {
            console.error('build_scene: could not release the reserved slot', e);
        }
    };

    let reply: unknown;
    try {
        reply = await invokeExpert('build_scene', body, { timeoutMs: BUILD_SCENE_TIMEOUT_MS });
    } catch (e) {
        hidePill();
        release();
        const msg = e instanceof ExpertError
            ? e.message
            : 'The scene builder could not be reached.';
        console.error('build_scene: request failed', e);
        addChatMessage('assistant', msg);
        return '';
    }
    hidePill();

    const outcome = interpretBuildSceneReply(reply);

    if (outcome.kind === 'passthrough') {
        // The expert read the intent as conversation, not a build. The agent has
        // already told the user it was building something, so silence would leave
        // them waiting for a scene that is never coming.
        console.log('build_scene: not a build → chat');
        release();
        const said = 'That reads more like a question than a scene to build — tell me what should be '
            + 'visible and I\'ll build it.';
        addChatMessage('assistant', said);
        return said;
    }

    if (outcome.kind === 'question') {
        console.log('build_scene: asking —', outcome.question);
        release();
        addChatMessage('assistant', outcome.question);
        return outcome.question;
    }

    if (outcome.kind === 'refused') {
        console.warn('build_scene: refused —', outcome.reason);
        release();
        const said = `I couldn't build that: ${outcome.reason}`;
        addChatMessage('assistant', said);
        return said;
    }

    const { ops, summary } = outcome.result;
    // The expert answers the request it was SENT — for an insert, "insert at N".
    // Applying that verbatim on top of the reserved slot would leave two scenes.
    const at = placeholder ? slotIndex(lesson.scenes, placeholder) : -1;
    const landed = placeholder ? ops.map((op) => landOnSlot(op, placeholder, at)) : ops;
    try {
        applyBuildOps(lesson, landed);
    } catch (e) {
        // A stale or malformed op. `applyBuildOps` is all-or-nothing, so the
        // lesson is as it was before this call — including the placeholder,
        // which still has to come out.
        const why = e instanceof PlacementError ? e.message : String(e);
        console.error('build_scene: could not apply', e);
        release();
        addChatMessage('assistant', `The scene was built but wouldn't fit the lesson: ${why}`);
        return '';
    }

    showBuiltScene(lesson, landed[0]!.at.index ?? target);
    console.log('%c🎬 build_scene complete', 'color: #44ff44; font-weight: bold', summary);
    addChatMessage('assistant', summary);
    return summary;
}

/**
 * Rebuild the scene tree and put the user on scene `index`.
 *
 * `step` defaults to "whichever step carries the sliders", because a scene whose
 * interactive part IS the point renders inert at its root view. Pass an explicit
 * step for the placeholder, which has none.
 */
function showBuiltScene(lesson: { scenes: unknown[] }, index: number, step?: number): void {
    const scene = lesson.scenes[index] as { steps?: Array<{ sliders?: unknown[] }> } | undefined;
    const first = scene && Array.isArray(scene.steps) ? scene.steps[0] : undefined;
    const targetStep = step !== undefined
        ? step
        : (first && Array.isArray(first.sliders) && first.sliders.length ? 0 : -1);
    try {
        if (typeof buildSceneTree === 'function') buildSceneTree(lessonSpec!);
        if (typeof updateDockVisibility === 'function') updateDockVisibility();
        // `navigateTo` re-renders only on a CHANGE of position, and a build
        // replaces the scene the user is already standing on — the placeholder.
        // Without forgetting where we are it no-ops, and the finished scene sits
        // in the lesson behind a viewport still captioned "Building…".
        if (index === currentSceneIndex) currentSceneIndex = -1;
        if (typeof navigateTo === 'function') navigateTo(index, targetStep);
        if (typeof window.algebenchEnsureSceneVisible === 'function') window.algebenchEnsureSceneVisible();
    } catch (e) {
        // The scene IS in the lesson; only the view failed to follow it there.
        console.error('build_scene: navigation/render failed:', e);
    }
}

async function sendChatMessage(text: string, { silent = false }: { silent?: boolean } = {}): Promise<void> {
    chatSending = true;
    if (!silent) addChatMessage('user', text);

    const loadingEl = addChatLoading();
    const context = buildChatContext();

    // Log on send
    console.log('%c🤖 Chat send: %c' + text.substring(0, 60),
        'color: #8888ff; font-weight: bold', 'color: #ccc');

    const payload = {
        message: text,
        // silent: user wasn't added to chatHistory, so don't slice
        history: silent ? chatHistory : chatHistory.slice(0, -1),
        context: context
    };

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        loadingEl.remove();

        if (!res.ok) {
            const err: { detail?: unknown; error?: unknown } =
                await res.json().catch(() => ({ error: 'Request failed' }));
            // FastAPI HTTPException (e.g. 429 rate limit) returns `detail`;
            // the app's own errors use `error`. Surface whichever is present.
            // `detail` may be a non-string (e.g. 422 returns a list of dicts),
            // so coerce to a string before logging/rendering — otherwise
            // renderMarkdown/renderKaTeX would throw or print "[object Object]".
            const rawMsg = err.detail ?? err.error;
            const msg = typeof rawMsg === 'string'
                ? rawMsg
                : (rawMsg != null ? JSON.stringify(rawMsg) : '');
            console.error('%c🤖 Chat error: %c' + res.status + ' — ' + (msg || 'unknown'),
                'color: #ff4444; font-weight: bold', 'color: #ccc');
            addChatMessage('assistant', msg || 'Something went wrong. Please try again.');
            if (chatHistory.length && chatHistory[chatHistory.length - 1]!.role === 'user') chatHistory.pop();
            chatSending = false;
            return;
        }

        const data: ChatApiResponse = await res.json();

        const tcNames = (data.toolCalls || []).map(tc => tc.name).join(', ');
        console.log('%c🤖 Chat response: %c' + data.response.length + ' chars' + (tcNames ? ' | tools: ' + tcNames : ''),
            'color: #88ff88; font-weight: bold', 'color: #ccc');

        // Log full tool call details
        if (data.toolCalls && data.toolCalls.length > 0) {
            for (const tc of data.toolCalls) {
                console.groupCollapsed('%c🔧 TOOL CALL: ' + tc.name, 'color: #ff8844; font-weight: bold');
                console.log('%cRequest rawArgs:', 'color: #aaa; font-weight: bold', tc.rawArgs || tc.args);
                console.log('%cRequest exec args:', 'color: #aaa; font-weight: bold', tc.args);
                console.log('%cResult:', 'color: #aaa; font-weight: bold', tc.result);
                console.groupEnd();
            }
        }

        // Store full chat history (system prompt + all messages + this response)
        if (data.debug) {
            const contents = data.debug.contents || [];
            // Append the model's response just like other messages in the history
            const modelParts: unknown[] = [{ text: data.response }];
            if (data.toolCalls && data.toolCalls.length > 0) {
                for (const tc of data.toolCalls) {
                    modelParts.push({ functionCall: { name: tc.name, args: tc.rawArgs || tc.args } });
                }
            }
            contents.push({ role: 'model', parts: modelParts });

            window.geminiChatHistory = {
                systemPrompt: data.debug.systemPrompt,
                contents: contents,
            };
            try { localStorage.setItem('geminiChatHistory', JSON.stringify(window.geminiChatHistory)); } catch(e) {}
            console.log('%c📋 geminiChatHistory: %c' + (window.geminiChatHistory.systemPrompt || '').length + ' char prompt, ' +
                contents.length + ' messages (window.geminiChatHistory)',
                'color: #ffaa44; font-weight: bold', 'color: #ccc');
        }

        // Render tool calls first, then the text response
        if (data.toolCalls && data.toolCalls.length > 0) {
            const messagesEl = document.getElementById('chat-messages')!;
            for (const tc of data.toolCalls) {
                messagesEl.appendChild(renderToolCallChip(tc));
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        let assistantMsg: ChatMessageElement | null = null;
        if (data.response) assistantMsg = addChatMessage('assistant', data.response);

        // What a client-executed builder SAID, to be filed after the agent's own
        // reply so the thread reads in the order the user saw it.
        const builderTurns: string[] = [];

        // Execute tool calls client-side
        if (data.toolCalls && data.toolCalls.length > 0) {
            for (const tc of data.toolCalls) {
                if (tc.name === 'navigate_to') {
                    // Agent uses 1-based scenes, 1-based steps (0=root)
                    const agentScene = Math.round(Number(tc.args.scene) || 1);
                    const agentStep = tc.args.step !== undefined ? Math.round(Number(tc.args.step)) : 0;
                    // Internal uses 0-based scenes, -1=root for steps
                    const internalScene = agentScene - 1;
                    const internalStep = agentStep - 1;
                    const totalScenes = (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes) ? lessonSpec.scenes.length : 0;
                    const beforeScene = currentSceneIndex;
                    const beforeStep = currentStepIndex;
                    console.log('%c📍 navigate_to: %cagent: scene=' + agentScene + ' step=' + agentStep +
                        ' → internal: scene=' + internalScene + ' step=' + internalStep +
                        ' | before: scene=' + (beforeScene + 1) + ' step=' + (beforeStep + 1) +
                        ' | totalScenes=' + totalScenes,
                        'color: #ff8844; font-weight: bold', 'color: #ccc');
                    if (internalScene < 0 || internalScene >= totalScenes) {
                        console.error('📍 navigate_to REJECTED: scene ' + agentScene + ' out of bounds (1-' + totalScenes + ')');
                    } else if (typeof navigateTo === 'function') {
                        navigateTo(internalScene, internalStep);
                        // Surface the scene the agent moved to: if the user is on the
                        // full-screen Math view, switch back to Scenes (unless split).
                        if (typeof window.algebenchEnsureSceneVisible === 'function') window.algebenchEnsureSceneVisible();
                        console.log('%c📍 navigate_to result: %cnow at scene ' + (currentSceneIndex + 1) + ' step ' + (currentStepIndex + 1) +
                            (currentSceneIndex === beforeScene && currentStepIndex === beforeStep ? ' ⚠️ NO CHANGE' : ''),
                            'color: #ff8844; font-weight: bold', 'color: #ccc');
                    }
                } else if (tc.name === 'set_camera') {
                    const viewName = tc.args.view;
                    // If a named view is specified, use it directly
                    if (viewName && typeof CAMERA_VIEWS !== 'undefined') {
                        const key = viewName.toLowerCase().replace(/\s+/g, '-');
                        if (CAMERA_VIEWS[key]) {
                            animateCamera(key, 800);
                        } else {
                            // Follow-cam and expr-camera views aren't in CAMERA_VIEWS;
                            // activate them by clicking the matching camera button.
                            const btn = document.querySelector<HTMLElement>(`.cam-btn[data-view="${key}"]`);
                            if (btn) btn.click();
                        }
                    } else if (tc.args.position || tc.args.target) {
                        const tgt = (tc.args.target as number[] | undefined) || [0, 0, 0];
                        let pos = tc.args.position as number[] | undefined;
                        const zoom = tc.args.zoom;
                        if (!pos && typeof camera !== 'undefined' && typeof controls !== 'undefined'
                            && typeof worldCameraToData === 'function') {
                            // Target-only: keep current camera offset, re-aim at new target
                            const curPosData = worldCameraToData([camera!.position.x, camera!.position.y, camera!.position.z]);
                            const curTgtData = worldCameraToData([controls!.target.x, controls!.target.y, controls!.target.z]);
                            pos = [
                                tgt[0]! + (curPosData[0]! - curTgtData[0]!),
                                tgt[1]! + (curPosData[1]! - curTgtData[1]!),
                                tgt[2]! + (curPosData[2]! - curTgtData[2]!),
                            ];
                        } else if (!pos) {
                            pos = [tgt[0]!, tgt[1]! + 50, tgt[2]! + 50]; // fallback offset
                        }
                        if (pos) {
                            // Direction vector from target to requested position
                            const dx = pos[0]! - tgt[0]!, dy = pos[1]! - tgt[1]!, dz = pos[2]! - tgt[2]!;
                            const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                            if (zoom != null && zoom > 0) {
                                // Explicit zoom: scale the requested distance
                                const s = 1 / zoom;
                                pos = [tgt[0]! + dx * s, tgt[1]! + dy * s, tgt[2]! + dz * s];
                            }
                        }
                        if (typeof CAMERA_VIEWS !== 'undefined' && typeof animateCamera === 'function') {
                            // Convert data-space coords to world-space (same as view buttons)
                            const wPos = (typeof dataCameraToWorld === 'function') ? dataCameraToWorld(pos!) : pos!;
                            const wTgt = (typeof dataCameraToWorld === 'function') ? dataCameraToWorld(tgt) : tgt;
                            // Preserve the current up vector so orientation isn't flipped
                            const sceneUp = (typeof camera !== 'undefined' && camera)
                                ? [camera.up.x, camera.up.y, camera.up.z]
                                : [0, 1, 0];
                            CAMERA_VIEWS['__agent'] = { position: wPos, target: wTgt, up: sceneUp };
                            animateCamera('__agent', 800);
                        }
                    }
                } else if (tc.name === 'build_scene') {
                    // Client-executed, like derive_proof_animation: the browser
                    // calls the build_scene expert and applies the BuildOp it
                    // returns. Anything the builder SAYS is collected and filed
                    // after the agent's own reply — see runBuildSceneTool.
                    //
                    // Respect the server's own refusal, the same way the derive
                    // branch below does. A call with no `intent`, or a replace
                    // naming no scene, comes back `status: 'error'` — the model
                    // sees that and explains it in `data.response`, so building
                    // anyway would fail again locally and tell the reader twice,
                    // in two different wordings.
                    if (tc.result && tc.result.status === 'error') {
                        console.log('build_scene: skipped —', tc.result.error || 'refused by the server');
                    } else {
                        const said = await runBuildSceneTool(tc);
                        if (said) builderTurns.push(said);
                    }
                } else if (tc.name === 'set_sliders') {
                    const values = tc.args.values || {};
                    const promises = Object.entries(values).map(([id, target]) =>
                        typeof animateSlider === 'function'
                            ? animateSlider(id, parseFloat(String(target)), 800)
                            : Promise.resolve(false)
                    );
                    await Promise.all(promises);
                } else if (tc.name === 'set_preset_prompts') {
                    setPresetPrompts(tc.args.prompts || []);
                } else if (tc.name === 'set_info_overlay') {
                    if (tc.args.id) {
                        if (typeof addInfoOverlay === 'function')
                            addInfoOverlay(tc.args.id, tc.args.content || '', (tc.args.position as string | undefined) || 'top-left');
                    } else {
                        console.warn('set_info_overlay: tool call missing required `id`; dropping', { args: tc.args });
                    }
                } else if (tc.name === 'clear_info_overlays') {
                    if (typeof removeAllInfoOverlays === 'function') removeAllInfoOverlays();
                } else if (tc.name === 'navigate_proof') {
                    const proofStep = parseInt(String(tc.result?.step ?? tc.args?.step ?? 0));
                    // Agent uses 1-based, navigateProof uses 0-based (-1 = goal)
                    if (typeof navigateProof === 'function') navigateProof(proofStep - 1);
                } else if (tc.name === 'derive_proof_animation') {
                    // Initiate a client-side derivation, docked into the current
                    // step's graph (same as clicking a node's Derive button). The
                    // result lives on the graph, not in chat. Respect the server
                    // guard: a non-success result (e.g. needsGraph) means there's no
                    // graph to derive on — skip it; the agent relays the message.
                    if (tc.result && tc.result.status !== 'success') {
                        console.log('derive_proof_animation: skipped —', tc.result.error || 'not permitted');
                    } else if (typeof window.algebenchDeriveProof === 'function') {
                        window.algebenchDeriveProof(tc.args || {});
                    } else {
                        console.warn('derive_proof_animation: graph view not ready to derive');
                    }
                } else if (tc.name === 'control_coach') {
                    // Drive the guided-tour "Coach": start/stop/reset/goto/next/prev/status.
                    const engine = window.AlgeBenchCoach && window.AlgeBenchCoach.engine;
                    if (engine && typeof engine.control === 'function') {
                        engine.control(tc.args?.action, { step: tc.args?.step });
                    } else {
                        console.warn('control_coach: coach engine not available');
                    }
                }
            }
        }

        chatHistory.push({ role: 'assistant', text: data.response });
        for (const said of builderTurns) chatHistory.push({ role: 'assistant', text: said });

        while (chatHistory.length > CHAT_HISTORY_MAX) {
            chatHistory.shift();
        }

        // Refresh memory status pill/popup if any memory tools were used
        const memToolNames = ['eval_math', 'mem_get', 'mem_set'];
        if ((data.toolCalls || []).some(tc => memToolNames.includes(tc.name))) {
            updateMemoryStatus();
        }

        // Speak via the message's own speaker controller so UI state stays in sync.
        // Silent mode: skip auto-speak; user can still click the speaker button (uses Read).
        if (assistantMsg && typeof assistantMsg._startSpeak === 'function' && data.response && selectedTtsMode !== 'silent') {
            assistantMsg._startSpeak();
        }
        if (typeof window.algebenchRefreshPromptContext === 'function') {
            window.algebenchRefreshPromptContext('chat-turn');
        }

    } catch (err) {
        loadingEl.remove();
        console.error('%c🤖 Chat error: %c' + (err as Error), 'color: #ff4444; font-weight: bold', 'color: #ccc', err);
        const isNetwork = err instanceof TypeError && /fetch|network|connect/i.test(err.message);
        const msg = isNetwork
            ? 'Failed to reach AI service. Check your connection.'
            : 'Error processing response: ' + (err as Error).message;
        addChatMessage('assistant', msg);
        if (chatHistory.length && chatHistory[chatHistory.length - 1]!.role === 'user') chatHistory.pop();
    }

    chatSending = false;
}

// ----- Message Rendering -----
function addChatMessage(role: string, content: string, toolCalls?: AlgeBenchChatToolCall[]): ChatMessageElement {
    const messagesEl = document.getElementById('chat-messages')!;
    const msgDiv = document.createElement('div') as ChatMessageElement;
    msgDiv.className = 'chat-msg ' + role;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    const _icons = window.algebenchIcons;
    if (_icons) avatar.innerHTML = role === 'user' ? _icons.user : _icons.ai;
    else avatar.textContent = role === 'user' ? '👤' : '🤖';   // fallback
    msgDiv.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (typeof renderKaTeX === 'function' && typeof renderMarkdown === 'function') {
        body.innerHTML = role === 'user'
            ? renderKaTeX(content, false)
            : renderMarkdown(content);
    } else {
        body.textContent = content;
    }
    body.dataset.markdown = content;
    msgDiv.appendChild(body);

    // Speak / pause / resume button (assistant messages only)
    if (role === 'assistant') {
        const SVG_SPEAKER = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';

        const speakBtn = document.createElement('button') as SpeakButton;
        speakBtn.className = 'msg-speak-btn';
        speakBtn.title = 'Read aloud';
        speakBtn.innerHTML = SVG_SPEAKER;

        const setBtnState = (state: SpeakBtnState) => {
            speakBtn.classList.remove('active', 'loading', 'idle');
            if (state) speakBtn.classList.add(state);
            else speakBtn.classList.add('idle');
            msgDiv.classList.remove('tts-speaking', 'tts-loading');
            if (state === 'active') msgDiv.classList.add('tts-speaking');
            if (state === 'loading') msgDiv.classList.add('tts-loading');
            if (state === 'loading') {
                speakBtn.textContent = '...';
                speakBtn.title = 'Loading audio (click to cancel)';
            } else if (state === 'active') {
                speakBtn.innerHTML = SVG_SPEAKER;
                speakBtn.title = 'Playing (click to stop, double-click to restart)';
            } else {
                speakBtn.innerHTML = SVG_SPEAKER;
                speakBtn.title = 'Read aloud (click to play)';
            }
        };

        const stopOtherBtn = () => {
            if (activeSpeakBtn && activeSpeakBtn !== speakBtn) {
                // Only reset the previous button's UI — audio handoff is managed in speakText
                if (activeSpeakBtn._ttsLoadPoll) { clearInterval(activeSpeakBtn._ttsLoadPoll); activeSpeakBtn._ttsLoadPoll = null; }
                if (activeSpeakBtn._ttsStatePoll) { clearInterval(activeSpeakBtn._ttsStatePoll); activeSpeakBtn._ttsStatePoll = null; }
                if (typeof activeSpeakBtn._setBtnState === 'function') activeSpeakBtn._setBtnState(null);
                if (activeSpeakBtn._downloadBtn) activeSpeakBtn._downloadBtn.style.display = 'none';
                activeSpeakBtn = null;
            }
        };

        const stopAndReset = () => {
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
            setBtnState(null);
            if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
        };

        const startPlay = () => {
            stopOtherBtn();
            if (typeof window.algebenchSpeakText !== 'function') return;
            if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
            setBtnState('loading');
            activeSpeakBtn = speakBtn;
            window.algebenchSpeakText(body.dataset.markdown || content, () => {
                if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
                setBtnState(null);
                if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
            });
            // Poll to keep button state synced with player state
            speakBtn._ttsStatePoll = setInterval(() => {
                if (activeSpeakBtn !== speakBtn) {
                    clearInterval(speakBtn._ttsStatePoll!); speakBtn._ttsStatePoll = null; return;
                }
                const p = typeof _ensureTTSPlayer === 'function' ? _ensureTTSPlayer() : null;
                if (!p) return;
                const playerState = p._state; // 'idle' | 'loading' | 'playing'
                if (playerState === 'loading') {
                    if (!speakBtn.classList.contains('loading')) setBtnState('loading');
                } else if (playerState === 'playing') {
                    if (!speakBtn.classList.contains('active')) setBtnState('active');
                }
            }, 80);
        };
        speakBtn._setBtnState = setBtnState;
        msgDiv._startSpeak = startPlay;

        // Single click: play or stop (toggle)
        speakBtn.addEventListener('click', () => {
            if (speakBtn._ignoreNextClick) {
                speakBtn._ignoreNextClick = false;
                return;
            }
            // If currently active (loading or playing), stop
            if (activeSpeakBtn === speakBtn) {
                stopAndReset();
                return;
            }
            startPlay();
        });

        // Double click: restart from beginning
        speakBtn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            speakBtn._ignoreNextClick = true;
            stopAndReset();
            startPlay();
        });
        const downloadBtn = document.createElement('a');
        downloadBtn.className = 'tts-download-btn';
        downloadBtn.href = '/api/tts/download';
        downloadBtn.download = '';
        downloadBtn.title = 'Download audio';
        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5v-2z"/></svg>';
        downloadBtn.style.display = 'none';
        speakBtn._downloadBtn = downloadBtn;

        const speakCol = document.createElement('div');
        speakCol.className = 'tts-speak-col';
        speakCol.appendChild(speakBtn);
        speakCol.appendChild(downloadBtn);
        msgDiv.appendChild(speakCol);
    }

    messagesEl.appendChild(msgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (role === 'user') {
        chatHistory.push({ role: 'user', text: content });
    }

    return msgDiv;
}

function addChatLoading(): HTMLDivElement {
    const messagesEl = document.getElementById('chat-messages')!;
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-msg assistant';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    if (window.algebenchIcons) avatar.innerHTML = window.algebenchIcons.ai;
    else avatar.textContent = '🤖';   // fallback
    loadingDiv.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'msg-body chat-loading';
    body.innerHTML = '<span></span><span></span><span></span>';
    loadingDiv.appendChild(body);

    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return loadingDiv;
}

function renderToolCallChip(tc: AlgeBenchChatToolCall): HTMLDivElement {
    const chip = document.createElement('div');
    chip.className = 'chat-tool-call';
    const rawArgs = tc.rawArgs || tc.args;

    const e = _escHtml;
    let friendlyText = e(tc.name);
    if (tc.name === 'navigate_to') {
        const reason = tc.args.reason || '';
        const agentScene = Math.round(Number(tc.args.scene) || 1);  // 1-based
        const agentStep = tc.args.step !== undefined ? Math.round(Number(tc.args.step)) : 0;
        let sceneTitle = 'Scene ' + agentScene;
        let stepTitle = '';
        if (typeof lessonSpec !== 'undefined' && lessonSpec && lessonSpec.scenes) {
            const s = lessonSpec.scenes[agentScene - 1];  // convert to 0-based index
            if (s) {
                sceneTitle = s.title || sceneTitle;
                if (agentStep >= 1 && s.steps && s.steps[agentStep - 1]) {
                    stepTitle = s.steps[agentStep - 1]!.title || ('Step ' + agentStep);
                } else if (agentStep === 0) {
                    stepTitle = 'Root';
                }
            }
        }
        friendlyText = '📍 Navigated to "' + e(sceneTitle) + '"';
        if (stepTitle) friendlyText += ', ' + e(stepTitle);
        if (reason) friendlyText += ' — ' + e(reason);
    } else if (tc.name === 'set_camera') {
        const reason = tc.args.reason || 'better viewing angle';
        const viewLabel = tc.args.view ? ' (' + e(tc.args.view) + ')' : '';
        friendlyText = '🎥 Camera adjusted' + viewLabel + ' — ' + e(reason);
    } else if (tc.name === 'build_scene') {
        const verb = tc.args.op === 'replace' ? 'Rebuilding scene' : 'Building a scene';
        friendlyText = '🎬 ' + verb + ' — ' + e(String(tc.args.intent || 'new visualization'));
    } else if (tc.name === 'set_sliders') {
        const vals = tc.args.values || {};
        const parts = Object.entries(vals).map(([id, v]) => e(id) + '→' + e(String(v)));
        friendlyText = '🎚️ Set ' + (parts.length > 0 ? parts.join(', ') : 'sliders');
    } else if (tc.name === 'eval_math') {
        const expr = tc.args.expression || '';
        const result = tc.result && tc.result.result !== undefined ? tc.result.result : null;
        const storedAs = tc.result && tc.result.stored_as;
        const err = tc.result && tc.result.error;
        if (err) {
            friendlyText = '🧮 eval: ' + e(expr) + ' → ❌ ' + e(err);
        } else if (storedAs) {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '🧮 ' + e(expr) + ' → 💾 memory[\'' + e(storedAs) + '\'] ' + e(summary);
        } else if (Array.isArray(result) && result.length > 3) {
            friendlyText = '🧮 ' + e(expr) + ' → [' + result.length + ' points]';
        } else {
            const val = typeof result === 'number' ? (Number.isInteger(result) ? result : +result.toFixed(6)) : JSON.stringify(result);
            friendlyText = '🧮 ' + e(expr) + ' = ' + e(String(val));
        }
    } else if (tc.name === 'mem_get') {
        const key = tc.args.key || '';
        const err = tc.result && tc.result.error;
        if (key === '?') {
            const keys = tc.result && tc.result.keys;
            const keyList = keys && typeof keys === 'object' ? Object.keys(keys).join(', ') : '(empty)';
            friendlyText = '🗂️ memory keys: ' + e(keyList);
        } else if (err) {
            friendlyText = '🗂️ memory[\'' + e(key) + '\'] → ❌ not found';
        } else {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '🗂️ memory[\'' + e(key) + '\'] → ' + e(summary);
        }
    } else if (tc.name === 'mem_set') {
        const key = tc.args.key || '';
        const err = tc.result && tc.result.error;
        if (err) {
            friendlyText = '💾 mem_set[\'' + e(key) + '\'] → ❌ ' + e(err);
        } else {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '💾 memory[\'' + e(key) + '\'] = ' + e(summary);
        }
    } else if (tc.name === 'set_preset_prompts') {
        const count = (tc.args.prompts || []).length;
        friendlyText = count === 0
            ? '💬 Cleared preset prompts'
            : '💬 Set ' + count + ' preset prompt' + (count === 1 ? '' : 's');
    } else if (tc.name === 'set_info_overlay') {
        if (tc.args.clear) {
            friendlyText = '🖼️ Cleared info overlays';
        } else {
            const id = tc.args.id || 'overlay';
            const pos = (tc.args.position as string | undefined) || 'top-left';
            friendlyText = '🖼️ Info overlay "' + e(id) + '" @ ' + e(pos);
        }
    } else if (tc.name === 'navigate_proof') {
        const step = tc.args.step || 0;
        const reason = tc.args.reason || '';
        friendlyText = step === 0
            ? '📐 Proof: showing goal overview'
            : '📐 Proof: step ' + step + (reason ? ' — ' + e(reason) : '');
    } else if (tc.name === 'control_coach') {
        const action = tc.args.action || 'status';
        const step = tc.args.step ? ' → ' + e(String(tc.args.step)) : '';
        friendlyText = '🧭 Tour: ' + e(action) + step;
    }

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;';
    chip.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'tool-call-summary';
    summary.style.flex = '1';
    if (typeof renderMarkdown === 'function') {
        summary.innerHTML = renderMarkdown(friendlyText);
    } else {
        summary.textContent = friendlyText;
    }
    header.appendChild(summary);

    // Tiny icon: opens popup with resolved exec args/result.
    const resolvedBtn = document.createElement('button');
    resolvedBtn.type = 'button';
    resolvedBtn.title = 'View resolved args/result';
    resolvedBtn.textContent = 'ⓘ';
    resolvedBtn.style.cssText = 'border:1px solid rgba(255,255,255,0.2);background:transparent;color:#9aa0a6;border-radius:999px;width:18px;height:18px;line-height:16px;font-size:11px;cursor:pointer;padding:0;flex-shrink:0;';
    header.appendChild(resolvedBtn);

    // Expanded panel: full unresolved/raw tool call (no truncation).
    const details = document.createElement('div');
    details.className = 'tool-call-details hidden';
    details.textContent = JSON.stringify({ functionCall: { name: tc.name, args: rawArgs } }, null, 2);
    chip.appendChild(details);

    const resultPreview = document.createElement('div');
    resultPreview.className = 'tool-call-details hidden';
    resultPreview.style.cssText = 'margin-top:4px;font-size:11px;color:#7f8790;';
    const r = tc.result || {};
    if (typeof r.message === 'string' && r.message.trim()) {
        resultPreview.textContent = r.message.trim();
    } else if (typeof r.error === 'string' && r.error.trim()) {
        resultPreview.textContent = 'Error: ' + r.error.trim();
    } else if (typeof r.summary === 'string' && r.summary.trim()) {
        resultPreview.textContent = r.summary.trim();
    } else if (r.status) {
        resultPreview.textContent = 'Status: ' + r.status;
    }
    chip.appendChild(resultPreview);

    // Popup for resolved args/result.
    const resolvedBackdrop = document.createElement('div');
    resolvedBackdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;';

    const resolvedPanel = document.createElement('div');
    resolvedPanel.style.cssText = 'width:min(760px,92vw);max-height:82vh;overflow:auto;background:#11161d;border:1px solid rgba(255,255,255,0.18);border-radius:10px;padding:10px 12px;';
    resolvedBackdrop.appendChild(resolvedPanel);

    const resolvedHeader = document.createElement('div');
    resolvedHeader.style.cssText = 'position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;margin:-10px -12px 8px -12px;padding:10px 12px;background:#11161d;border-bottom:1px solid rgba(255,255,255,0.12);color:#cfd6df;font-size:12px;';
    resolvedHeader.textContent = 'Resolved args/result';
    resolvedPanel.appendChild(resolvedHeader);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'border:1px solid rgba(255,255,255,0.25);background:transparent;color:#cfd6df;border-radius:6px;padding:1px 6px;cursor:pointer;';
    resolvedHeader.appendChild(closeBtn);

    const resolvedBody = document.createElement('pre');
    resolvedBody.style.cssText = 'margin:0;font-size:12px;line-height:1.35;white-space:pre-wrap;word-break:break-word;color:#c9d1d9;';
    resolvedBody.textContent = JSON.stringify({
        functionCall: { name: tc.name, args: tc.args },
        result: tc.result
    }, null, 2);
    resolvedPanel.appendChild(resolvedBody);
    document.body.appendChild(resolvedBackdrop);

    summary.addEventListener('click', () => {
        details.classList.toggle('hidden');
        resultPreview.classList.toggle('hidden');
    });

    const hideResolvedPopup = () => { resolvedBackdrop.style.display = 'none'; };
    const onResolvedPopupKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && resolvedBackdrop.style.display !== 'none') {
            hideResolvedPopup();
        }
    };
    resolvedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resolvedBackdrop.style.display = 'flex';
    });
    closeBtn.addEventListener('click', hideResolvedPopup);
    resolvedBackdrop.addEventListener('click', (e) => {
        if (e.target === resolvedBackdrop) hideResolvedPopup();
    });
    document.addEventListener('keydown', onResolvedPopupKeydown);

    return chip;
}

// ----- TTS Playback (via TTSAudioPlayer from gemini-live-tools) -----
const _SVG_UNMUTED = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1.3L4.63 4H2.5A1.5 1.5 0 001 5.5v5A1.5 1.5 0 002.5 12h2.13L8 14.7V1.3zm3.74 2.04a4.5 4.5 0 010 9.32l-.55-.96a3.5 3.5 0 000-7.4l.55-.96zm-.93 2.17a2.5 2.5 0 010 4.98l-.55-.96a1.5 1.5 0 000-3.06l.55-.96z"/></svg>';
const _SVG_MUTED = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1.3L4.63 4H2.5A1.5 1.5 0 001 5.5v5A1.5 1.5 0 002.5 12h2.13L8 14.7V1.3zm3 4.2l1.5 1.5L14 5.5l.7.7L13.2 7.7l1.5 1.5-.7.7L12.5 8.4 11 9.9l-.7-.7 1.5-1.5L10.3 6.2l.7-.7z"/></svg>';
let ttsRequestId = 0;         // Monotonic counter — invalidates stale streams on new request
let ttsPausedByUser = false;
let ttsPlayer: GeminiTTSAudioPlayer | null = null;         // TTSAudioPlayer instance (lazy-init)
let ttsHasOutputFile = false;
let ttsAbortController: AbortController | null = null; // AbortController for the active fetch stream

function _ensureTTSPlayer(): GeminiTTSAudioPlayer | null {
    if (!ttsPlayer && window.GeminiTTSPlayer) {
        ttsPlayer = new window.GeminiTTSPlayer.TTSAudioPlayer({
            volume: 0.5,
            persistKey: 'algebenchTTS',
            onVolumeChange(vol, muted) {
                const slider = document.getElementById('ttsVolumeSlider') as HTMLInputElement | null;
                const icon = document.getElementById('ttsVolumeIcon');
                if (slider) slider.value = String(muted ? 0 : vol);
                if (icon) icon.innerHTML = muted ? _SVG_MUTED : _SVG_UNMUTED;
            },
        });
        // Sync slider/icon to persisted volume on init
        const slider = document.getElementById('ttsVolumeSlider') as HTMLInputElement | null;
        const icon = document.getElementById('ttsVolumeIcon');
        if (slider) {
            slider.value = String(ttsPlayer.isMuted() ? 0 : ttsPlayer.getVolume());
            slider.addEventListener('input', () => ttsPlayer!.setVolume(parseFloat(slider.value)));
        }
        if (icon) {
            icon.innerHTML = ttsPlayer.isMuted() ? _SVG_MUTED : _SVG_UNMUTED;
            icon.addEventListener('click', () => ttsPlayer!.toggleMute());
        }
    }
    return ttsPlayer;
}

window.algebenchGetTTSAudioStream = function() {
    const p = _ensureTTSPlayer();
    return p ? p.getMediaStream() : null;
};

// ---- State queries ----

window.algebenchIsTTSSpeaking = function() {
    if (ttsPausedByUser) return false;
    const p = _ensureTTSPlayer();
    return p ? p._state === 'playing' : false;
};

window.algebenchIsTTSPaused = function() {
    return ttsPausedByUser;
};

window.algebenchIsTTSLoading = function() {
    const p = _ensureTTSPlayer();
    return p ? p._state === 'loading' : false;
};

// ---- Controls ----

window.algebenchPauseTTS = function() {
    const p = _ensureTTSPlayer();
    if (!p || !p._ctx) return;
    ttsPausedByUser = true;
    p._ctx.suspend().catch(() => {});
};

window.algebenchResumeTTS = function() {
    const p = _ensureTTSPlayer();
    if (!p || !p._ctx) return;
    ttsPausedByUser = false;
    p._ctx.resume().catch(() => {});
};

window.algebenchStopTTS = function() {
    ++ttsRequestId;
    ttsPausedByUser = false;
    ttsHasOutputFile = false;
    if (ttsAbortController) { ttsAbortController.abort(); ttsAbortController = null; }
    const p = _ensureTTSPlayer();
    if (p) p.stop();
    // Tell server to kill active TTS streams and broadcast stop
    fetch('/api/tts/kill', { method: 'POST' }).catch(() => {});
};

// ---- algebenchSpeakText with completion callback ----

window.algebenchSpeakText = function(text, onEnd) {
    const expectedId = ttsRequestId + 1;
    speakText(text, { explicit: true });

    if (typeof onEnd !== 'function') return;

    const startTime = Date.now();
    let hasStarted = false;
    let sawNonIdle = false;
    const poll = setInterval(() => {
        if (ttsRequestId !== expectedId) {
            clearInterval(poll); onEnd(); return;
        }
        const p = _ensureTTSPlayer();
        if (p && p._state !== 'idle') sawNonIdle = true;
        if (p && p.isPlaying()) hasStarted = true;
        // Only trigger onEnd after playback has actually started then stopped
        if (hasStarted && p && !p.isPlaying()) {
            clearInterval(poll); onEnd(); return;
        }
        // Abort/error path: request became active, but the player returned to idle
        // before any audio started, so the button should reset immediately.
        if (!hasStarted && sawNonIdle && p && p._state === 'idle') {
            clearInterval(poll); onEnd(); return;
        }
        if (Date.now() - startTime > 60000) {
            clearInterval(poll); onEnd();
        }
    }, 80);
};

// ---- Core streaming speakText ----

async function speakText(text: string, { explicit = false }: { explicit?: boolean } = {}): Promise<void> {
    if (selectedTtsMode === 'silent' && !explicit) return;

    const clean = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[📍🤖👤]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!clean) return;

    const myId = ++ttsRequestId;
    ttsPausedByUser = false;
    ttsHasOutputFile = false;
    if (activeSpeakBtn && activeSpeakBtn._downloadBtn) activeSpeakBtn._downloadBtn.style.display = 'none';
    const myDownloadBtn = activeSpeakBtn ? activeSpeakBtn._downloadBtn : null;

    const player = _ensureTTSPlayer();
    if (!player) return;

    if (ttsAbortController) { ttsAbortController.abort(); ttsAbortController = null; }
    const abort = new AbortController();
    ttsAbortController = abort;
    let response: Response;
    try {
        response = await fetch('/api/tts/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abort.signal,
            body: JSON.stringify({
                text: clean,
                character: selectedTtsCharacter || 'joker',
                voice: selectedTtsVoice || 'Charon',
                mode: (selectedTtsMode === 'silent') ? 'perform' : (selectedTtsMode || 'read'),
            }),
        });
        if (!response.ok || ttsRequestId !== myId) return;

        ttsHasOutputFile = response.headers.get('X-TTS-Has-Output-File') === '1';

        // Delegate all audio decoding and playback to TTSAudioPlayer
        await player.playStreamWithAbort(response, abort);

        // Show download button if server saved audio to file
        if (ttsRequestId === myId && ttsHasOutputFile && myDownloadBtn) {
            myDownloadBtn.style.display = 'flex';
        }
    } catch (err) {
        return;
    } finally {
        if (ttsAbortController === abort) ttsAbortController = null;
    }
}

// ----- TTS Kill SSE Listener -----
(function _initTTSKillListener() {
    let es: EventSource | null = null;
    function connect() {
        es = new EventSource('/api/tts/events');
        es.addEventListener('kill', () => {
            // Stop locally only — don't call algebenchStopTTS which
            // would POST /api/tts/kill and create an infinite loop.
            ++ttsRequestId;
            ttsPausedByUser = false;
            ttsHasOutputFile = false;
            if (ttsAbortController) { ttsAbortController.abort(); ttsAbortController = null; }
            const p = _ensureTTSPlayer();
            if (p) p.stop();
        });
        es.onerror = () => {
            es!.close();
            setTimeout(connect, 3000);
        };
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connect);
    } else {
        connect();
    }
})();

// ----- Context Change Tracking -----
let _lastContextJson = '';

function logContextIfChanged(): void {
    const context = buildChatContext();
    const json = JSON.stringify(context, null, 2);
    if (json === _lastContextJson) return;
    _lastContextJson = json;

    localStorage.setItem('algebench-chat-context', json);
    window.dispatchEvent(new CustomEvent('algebench-context-changed', {
        detail: { context, json }
    }));

    const scene = context.currentScene || {};
    const rt = context.runtime || {};
    const sceneParts = [
        scene.title ? `"${scene.title}"` : null,
        scene.steps ? `${scene.steps.length} steps` : null,
        scene.prompt ? 'has prompt' : null,
    ].filter(Boolean).join(', ');
    const rtParts = [
        rt.stepNumber !== undefined ? `step ${rt.stepNumber}` : null,
        rt.sliders ? `${Object.keys(rt.sliders).length} sliders` : null,
        rt.activeTab || null,
    ].filter(Boolean).join(', ');
    if (document.body.dataset.debugMode === 'true') console.log('%c🤖 Chat context updated: %c' +
        `scene=[${sceneParts}] runtime=[${rtParts}] (${json.length} chars)`,
        'color: #8888ff; font-weight: bold', 'color: #ccc');
}

// Poll for context changes (scene/step/camera/slider changes)
let _contextPollId: ReturnType<typeof setInterval> | null = null;
function startContextPolling(): void {
    if (_contextPollId) return;
    _contextPollId = setInterval(logContextIfChanged, 1000);
}

// ----- Welcome Message -----
function sendWelcomeMessage(): void {
    if (!chatAvailable || shouldSkipWelcome() || welcomeInFlight) return;
    welcomeInFlight = true;
    sendChatMessage(
        '**LENGTH OVERRIDE FOR THIS REPLY ONLY:** the usual brevity rule does NOT apply to this welcome. Subsequent replies revert to normal brevity.\n\n' +
        'The user just switched to the Chat tab. Read the **USER VIEWING** line in Current State and ground your welcome in exactly that surface. *Actually explain what is on screen* — do not just acknowledge it. Structure:\n\n' +
        '1. ONE short sentence acknowledging the surface (e.g. "You are looking at the semantic graph for step 3" or "You are on the 3D scene of …").\n' +
        '2. A SUBSTANTIVE explanation (3–6 sentences) of what is on screen right now:\n' +
        '   - If a graph node is selected: explain that node — what the symbol means in context, what role it plays in the equation, and how it relates to the surrounding nodes (use the incoming/outgoing neighbors from Active Semantic Graph).\n' +
        '   - If the semantic graph is open with no node selected: walk through the structure of the graph (root operator, key operands, the relationship the graph encodes).\n' +
        '   - If on the 3D scene: explain the visible elements and what the current step is demonstrating.\n' +
        '3. End with ONE concrete follow-up question the user is most likely to ask next, phrased as an offer (e.g. "Want me to walk through how … relates to … ?").\n\n' +
        'Do not be generic. Do not list capabilities. Use the specific names, symbols, and relationships from the Active Semantic Graph / Active Proof Step / Current Scene Definition sections of the system prompt.',
        { silent: true }
    ).finally(() => { welcomeInFlight = false; });
}

// ----- Memory Status Popup -----
function renderMemoryPopup(mem: Record<string, AlgeBenchMemoryEntry> | null, queryText?: string | null): void {
    const body = document.getElementById('memory-popup-body');
    if (!body) return;
    body.innerHTML = '';

    if (!mem || Object.keys(mem).length === 0) {
        const empty = document.createElement('div');
        empty.id = 'memory-popup-empty';
        empty.textContent = 'No keys stored yet.';
        body.appendChild(empty);
        return;
    }

    const q = (queryText || '').trim().toLowerCase();
    let matchCount = 0;

    for (const key of Object.keys(mem)) {
        const entry = mem[key] || {};
        const summary = entry.summary || '';
        const val = entry.value;
        let previewText = '';
        if (val !== null && val !== undefined) {
            previewText = JSON.stringify(val);
            if (previewText.length > 120) previewText = previewText.slice(0, 120) + '…';
        }

        if (q) {
            const haystack = `${key}\n${summary}\n${previewText}`.toLowerCase();
            if (!haystack.includes(q)) continue;
        }
        matchCount++;

        const div = document.createElement('div');
        div.className = 'memory-entry';

        const keyEl = document.createElement('span');
        keyEl.className = 'memory-entry-key';
        keyEl.textContent = key;
        div.appendChild(keyEl);

        const sep = document.createElement('span');
        sep.style.color = 'rgba(120,200,255,0.4)';
        sep.textContent = ' → ';
        div.appendChild(sep);

        const summaryEl = document.createElement('span');
        summaryEl.className = 'memory-entry-summary';
        summaryEl.textContent = summary;
        div.appendChild(summaryEl);

        if (previewText) {
            const preview = document.createElement('div');
            preview.className = 'memory-entry-preview';
            preview.textContent = previewText;
            div.appendChild(preview);
        }

        body.appendChild(div);
    }

    if (matchCount === 0) {
        const noRes = document.createElement('div');
        noRes.id = 'memory-popup-no-results';
        noRes.textContent = 'No matching memory entries.';
        body.appendChild(noRes);
    }
}

function updateMemoryStatus(): void {
    fetch('/api/memory')
        .then(r => r.ok ? r.json() : null)
        .then((mem: Record<string, AlgeBenchMemoryEntry> | null) => {
            if (!mem) return;
            memorySnapshot = mem;
            // Expose raw memory values globally so info overlays can evaluate
            // {{expr}} bindings against agent memory keys (c1, c2, ...).
            window.agentMemoryValues = Object.fromEntries(
                Object.entries(mem).map(([k, v]) => [k, v && Object.prototype.hasOwnProperty.call(v, 'value') ? v.value : undefined])
            );
            // Overlays may have been added before memory arrived; re-evaluate now.
            if (typeof updateInfoOverlays === 'function') {
                try { updateInfoOverlays(); } catch (_e) {}
            }
            const keys = Object.keys(mem);
            const pill = document.getElementById('memory-status');
            const countEl = pill && pill.querySelector('.memory-status-count');
            const searchInput = document.getElementById('memory-popup-search') as HTMLInputElement | null;

            if (!pill) return;

            if (keys.length === 0) {
                pill.classList.add('hidden');
                // Also close popup if open
                const popup = document.getElementById('memory-popup');
                if (popup) popup.classList.add('hidden');
                return;
            }

            // Update pill — String() is what the textContent setter did implicitly.
            if (countEl) countEl.textContent = String(keys.length);
            pill.classList.remove('hidden');

            // Update status bar visibility (show bar even if no sliders)
            const bar = document.getElementById('status-bar');
            if (bar) bar.classList.remove('hidden');

            renderMemoryPopup(mem, searchInput ? searchInput.value : '');
        })
        .catch(() => {});
}

// ----- Initialize on DOM ready -----
document.addEventListener('DOMContentLoaded', () => {
    setupChat();
    startContextPolling();

    // Wire memory pill → popup toggle
    const memPill = document.getElementById('memory-status');
    const memPopup = document.getElementById('memory-popup');
    const memClose = document.getElementById('memory-popup-close');
    const memSearch = document.getElementById('memory-popup-search') as HTMLInputElement | null;

    if (memPill && memPopup) {
        memPill.addEventListener('click', () => {
            memPopup.classList.toggle('hidden');
        });
    }
    if (memClose && memPopup) {
        memClose.addEventListener('click', () => {
            memPopup.classList.add('hidden');
        });
    }
    if (memSearch) {
        memSearch.addEventListener('input', () => {
            renderMemoryPopup(memorySnapshot, memSearch.value);
        });
    }
});

// ============================================================
// Re-publish the classic-script global surface.
//
// As a classic <script>, every top-level `function` in this file automatically
// became a property of `window`, and other modules reach several of them that
// way — `switchPanelTab` and `sendChatMessage` as bare globals behind
// `typeof … === 'function'` guards (src/overlay.js, src/labels.ts),
// `setPresetPrompts` likewise (src/scene-loader.js), and `window.*`-qualified
// in src/view-state-bridge.js and src/proof-animation/sg-proof.js.
//
// Module scope publishes nothing, so the full set is re-assigned here. This is
// deliberately the SAME flat surface as before — replacing it with an
// `AlgeBench` namespace is issue #406, out of scope for the migration.
//
// (The top-level `let`/`const` bindings — chatHistory, ttsPlayer, … — were
// never window properties even as a classic script: `let`/`const` land in the
// global LEXICAL scope, not on the global object. Nothing outside this file
// reads them, so there is nothing to re-publish.)
// ============================================================
window._escHtml = _escHtml;
window._classifyFocusTarget = _classifyFocusTarget;
window.setPresetPrompts = setPresetPrompts;
window.shouldSkipWelcome = shouldSkipWelcome;
window.buildChatContext = buildChatContext;
window.switchPanelTab = switchPanelTab;
window.setupChat = setupChat;
window.initChatTtsControls = initChatTtsControls;
window.sendChatMessage = sendChatMessage;
window.addChatMessage = addChatMessage;
window.addChatLoading = addChatLoading;
window.renderToolCallChip = renderToolCallChip;
window._ensureTTSPlayer = _ensureTTSPlayer;
window.speakText = speakText;
window.logContextIfChanged = logContextIfChanged;
window.startContextPolling = startContextPolling;
window.sendWelcomeMessage = sendWelcomeMessage;
window.renderMemoryPopup = renderMemoryPopup;
window.updateMemoryStatus = updateMemoryStatus;
