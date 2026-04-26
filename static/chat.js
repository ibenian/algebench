// ============================================================
// AlgeBench AI Chat Agent (Gemini-powered)
// Integrated as a tab in the explanation panel
// ============================================================

// ----- Chat State -----
let chatHistory = [];       // [{role: 'user'|'assistant', text: string}]
let chatAvailable = false;  // set true if GEMINI_API_KEY is configured
let chatSending = false;
let activeSpeakBtn = null;  // the .msg-speak-btn currently playing TTS
let welcomeInFlight = false;
let welcomeRequestId = 0;
let memorySnapshot = null;
let ttsCharacterPicker = null;
let selectedTtsCharacter = 'joker';
let selectedTtsVoice = 'Charon';
let selectedTtsMode = 'read';

const CHAT_HISTORY_MAX = Infinity;

let _presetPrompts = [];

// Track which surface the user last interacted with so chat context can
// disambiguate "what are they looking at right now" — the dock tab being
// "graph" only tells us the graph is *visible*, not that the user is
// actually working in it (vs. the 3D viewport or the side panel).
// Values: 'graph' | 'viewport' | 'panel' | null
let _lastFocusedSurface = null;
function _classifyFocusTarget(target) {
    if (!target || !target.closest) return null;
    if (target.closest('#graph-viewport, #dock-tab-graph, .graph-panel-info, .graph-panel-tooltip')) return 'graph';
    if (target.closest('#mathbox-container, #mathbox-overlay, canvas')) return 'viewport';
    if (target.closest('.explanation-panel, .panel-tab, .tab-content, #chat-input, #preset-prompts')) return 'panel';
    return null;
}
if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', (e) => {
        const surface = _classifyFocusTarget(e.target);
        if (surface) _lastFocusedSurface = surface;
    }, true);
}

function setPresetPrompts(prompts) {
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
        btn.title = text + '\n\nClick to send · ⌘-click to edit';
        btn.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) {
                const input = document.getElementById('chat-input');
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

function shouldSkipWelcome() {
    return chatHistory.length > 0 || chatSending;
}

// ----- Context Snapshot -----
function buildChatContext() {
    const ctx = {};

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
            const entry = { sceneNumber: i + 1, title: s.title || ('Scene ' + (i + 1)) };
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
    const runtime = {};

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
                        return !elementRegistry[el.id].hidden;
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
        const sliders = {};
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
        runtime.currentCaption = raw.trim();
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
    const viewing = [];
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

    ctx.runtime = runtime;
    return ctx;
}

window.algebenchBuildChatContext = buildChatContext;

// ----- Tab Switching -----
function switchPanelTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.panel-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('active', el.id === 'tab-' + tabName);
    });
    // Focus input and greet only when chat history is empty
    if (tabName === 'chat') {
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
function setupChat() {
    // Check availability and show/hide tab bar
    fetch('/api/chat/available')
        .then(r => r.json())
        .then(data => {
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
    document.querySelectorAll('.panel-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            switchPanelTab(btn.dataset.tab);
        });
    });

    // 'C' keyboard shortcut — open panel on Chat tab
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const panel = document.getElementById('explanation-panel');
            const toggle = document.getElementById('explain-toggle');
            const handle = document.getElementById('panel-resize-handle');
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

    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
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

function initChatTtsControls() {
    const lib = window.GeminiVoiceCharacterSelector;
    if (!lib) return;

    const characterBtn = document.getElementById('chatCharacterBtn');
    const characterPalette = document.getElementById('chatCharacterPalette');
    const characterSearch = document.getElementById('chatCharacterSearch');
    const characterList = document.getElementById('chatCharacterList');
    const characterBackdrop = document.getElementById('chatCharacterBackdrop');
    const voiceSelect = document.getElementById('chatVoiceSelect');
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

    const ttsModeSelect = document.getElementById('chatTtsModeSelect');
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
async function sendChatMessage(text, { silent = false } = {}) {
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
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            console.error('%c🤖 Chat error: %c' + res.status + ' — ' + (err.error || 'unknown'),
                'color: #ff4444; font-weight: bold', 'color: #ccc');
            addChatMessage('assistant', err.error || 'Something went wrong. Please try again.');
            if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
            chatSending = false;
            return;
        }

        const data = await res.json();

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
                if (tc.name === 'add_scene') {
                    console.log('%cparsedScene:', 'color: #ffcc00; font-weight: bold', tc.args.parsedScene || '❌ NOT SET');
                    if (tc.args.scene) console.log('%craw scene:', 'color: #888', typeof tc.args.scene === 'string' ? tc.args.scene.substring(0, 500) : tc.args.scene);
                }
                console.groupEnd();
            }
        }

        // Store full chat history (system prompt + all messages + this response)
        if (data.debug) {
            const contents = data.debug.contents || [];
            // Append the model's response just like other messages in the history
            const modelParts = [{ text: data.response }];
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
            const messagesEl = document.getElementById('chat-messages');
            for (const tc of data.toolCalls) {
                messagesEl.appendChild(renderToolCallChip(tc));
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        let assistantMsg = null;
        if (data.response) assistantMsg = addChatMessage('assistant', data.response);

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
                            const btn = document.querySelector(`.cam-btn[data-view="${key}"]`);
                            if (btn) btn.click();
                        }
                    } else if (tc.args.position || tc.args.target) {
                        const tgt = tc.args.target || [0, 0, 0];
                        let pos = tc.args.position;
                        const zoom = tc.args.zoom;
                        if (!pos && typeof camera !== 'undefined' && typeof controls !== 'undefined'
                            && typeof worldCameraToData === 'function') {
                            // Target-only: keep current camera offset, re-aim at new target
                            const curPosData = worldCameraToData([camera.position.x, camera.position.y, camera.position.z]);
                            const curTgtData = worldCameraToData([controls.target.x, controls.target.y, controls.target.z]);
                            pos = [
                                tgt[0] + (curPosData[0] - curTgtData[0]),
                                tgt[1] + (curPosData[1] - curTgtData[1]),
                                tgt[2] + (curPosData[2] - curTgtData[2]),
                            ];
                        } else if (!pos) {
                            pos = [tgt[0], tgt[1] + 50, tgt[2] + 50]; // fallback offset
                        }
                        if (pos) {
                            // Direction vector from target to requested position
                            const dx = pos[0] - tgt[0], dy = pos[1] - tgt[1], dz = pos[2] - tgt[2];
                            const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                            if (zoom != null && zoom > 0) {
                                // Explicit zoom: scale the requested distance
                                const s = 1 / zoom;
                                pos = [tgt[0] + dx * s, tgt[1] + dy * s, tgt[2] + dz * s];
                            }
                        }
                        if (typeof CAMERA_VIEWS !== 'undefined' && typeof animateCamera === 'function') {
                            // Convert data-space coords to world-space (same as view buttons)
                            const wPos = (typeof dataCameraToWorld === 'function') ? dataCameraToWorld(pos) : pos;
                            const wTgt = (typeof dataCameraToWorld === 'function') ? dataCameraToWorld(tgt) : tgt;
                            // Preserve the current up vector so orientation isn't flipped
                            const sceneUp = (typeof camera !== 'undefined' && camera)
                                ? [camera.up.x, camera.up.y, camera.up.z]
                                : [0, 1, 0];
                            CAMERA_VIEWS['__agent'] = { position: wPos, target: wTgt, up: sceneUp };
                            animateCamera('__agent', 800);
                        }
                    }
                } else if (tc.name === 'add_scene') {
                    // Scene properties are now top-level in args (parsedScene set by backend)
                    const newScene = tc.args.parsedScene;
                    if (!newScene) {
                        console.error('add_scene: no parsedScene in args');
                        continue;
                    }

                    console.log('%c🎬 add_scene:', 'color: #ffaa00; font-weight: bold',
                        'elements:', (newScene.elements || []).length,
                        'title:', newScene.title);

                    // Stash for debug
                    tc._generatedScene = newScene;

                    // Add to lessonSpec (create lesson wrapper if needed)
                    if (typeof lessonSpec === 'undefined' || !lessonSpec) {
                        // Wrap the currently displayed single scene into a lesson
                        const existingScene = (typeof currentSpec !== 'undefined' && currentSpec) ? currentSpec : null;
                        lessonSpec = { title: "Lesson", scenes: existingScene ? [existingScene] : [] };
                        console.log('  Created lesson wrapper, existing scenes:', lessonSpec.scenes.length);
                        // Sync navigation indices so navigateTo sees a scene change
                        if (existingScene) {
                            currentSceneIndex = 0;
                            currentStepIndex = -1;
                        }
                    }
                    if (!Array.isArray(lessonSpec.scenes)) lessonSpec.scenes = [];
                    lessonSpec.scenes.push(newScene);
                    const targetIdx = lessonSpec.scenes.length - 1;
                    const firstStepHasSliders = !!(
                        Array.isArray(newScene.steps) &&
                        newScene.steps.length > 0 &&
                        Array.isArray(newScene.steps[0].sliders) &&
                        newScene.steps[0].sliders.length > 0
                    );
                    const targetStep = firstStepHasSliders ? 0 : -1;
                    console.log('  Navigating to scene index:', targetIdx, 'currentSceneIndex:', currentSceneIndex);

                    // Rebuild scene tree UI and navigate to new scene
                    try {
                        if (typeof buildSceneTree === 'function') buildSceneTree(lessonSpec);
                        if (typeof updateDockVisibility === 'function') updateDockVisibility();
                        if (typeof navigateTo === 'function') navigateTo(targetIdx, targetStep);
                        console.log('%c🎬 add_scene complete', 'color: #44ff44; font-weight: bold');
                    } catch(e) {
                        console.error('add_scene: navigation/render failed:', e);
                    }
                } else if (tc.name === 'set_sliders') {
                    const values = tc.args.values || {};
                    const promises = Object.entries(values).map(([id, target]) =>
                        typeof animateSlider === 'function'
                            ? animateSlider(id, parseFloat(target), 800)
                            : Promise.resolve(false)
                    );
                    await Promise.all(promises);
                } else if (tc.name === 'set_preset_prompts') {
                    setPresetPrompts(tc.args.prompts || []);
                } else if (tc.name === 'set_info_overlay') {
                    if (tc.args.id) {
                        if (typeof addInfoOverlay === 'function')
                            addInfoOverlay(tc.args.id, tc.args.content || '', tc.args.position || 'top-left');
                    } else {
                        console.warn('set_info_overlay: tool call missing required `id`; dropping', { args: tc.args });
                    }
                } else if (tc.name === 'clear_info_overlays') {
                    if (typeof removeAllInfoOverlays === 'function') removeAllInfoOverlays();
                } else if (tc.name === 'navigate_proof') {
                    const proofStep = parseInt(tc.result?.step ?? tc.args?.step ?? 0);
                    // Agent uses 1-based, navigateProof uses 0-based (-1 = goal)
                    if (typeof navigateProof === 'function') navigateProof(proofStep - 1);
                }
            }
        }

        chatHistory.push({ role: 'assistant', text: data.response });

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
        console.error('%c🤖 Chat error: %c' + err, 'color: #ff4444; font-weight: bold', 'color: #ccc', err);
        const isNetwork = err instanceof TypeError && /fetch|network|connect/i.test(err.message);
        const msg = isNetwork
            ? 'Failed to reach AI service. Check your connection.'
            : 'Error processing response: ' + err.message;
        addChatMessage('assistant', msg);
        if (chatHistory.length && chatHistory[chatHistory.length - 1].role === 'user') chatHistory.pop();
    }

    chatSending = false;
}

// ----- Message Rendering -----
function addChatMessage(role, content, toolCalls) {
    const messagesEl = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ' + role;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';
    msgDiv.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'msg-body';

    body.innerHTML = role === 'user'
        ? (typeof renderKaTeX === 'function' ? renderKaTeX(content, false) : content)
        : (typeof renderMarkdown === 'function' ? renderMarkdown(content) : content);
    body.dataset.markdown = content;
    msgDiv.appendChild(body);

    // Speak / pause / resume button (assistant messages only)
    if (role === 'assistant') {
        const SVG_SPEAKER = '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';

        const speakBtn = document.createElement('button');
        speakBtn.className = 'msg-speak-btn';
        speakBtn.title = 'Read aloud';
        speakBtn.innerHTML = SVG_SPEAKER;

        const setBtnState = (state) => {
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
                    clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; return;
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

function addChatLoading() {
    const messagesEl = document.getElementById('chat-messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-msg assistant';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '🤖';
    loadingDiv.appendChild(avatar);

    const body = document.createElement('div');
    body.className = 'msg-body chat-loading';
    body.innerHTML = '<span></span><span></span><span></span>';
    loadingDiv.appendChild(body);

    messagesEl.appendChild(loadingDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return loadingDiv;
}

function renderToolCallChip(tc) {
    const chip = document.createElement('div');
    chip.className = 'chat-tool-call';
    const rawArgs = tc.rawArgs || tc.args;

    let friendlyText = tc.name;
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
                    stepTitle = s.steps[agentStep - 1].title || ('Step ' + agentStep);
                } else if (agentStep === 0) {
                    stepTitle = 'Root';
                }
            }
        }
        friendlyText = '📍 Navigated to "' + sceneTitle + '"';
        if (stepTitle) friendlyText += ', ' + stepTitle;
        if (reason) friendlyText += ' — ' + reason;
    } else if (tc.name === 'set_camera') {
        const reason = tc.args.reason || 'better viewing angle';
        const viewLabel = tc.args.view ? ' (' + tc.args.view + ')' : '';
        friendlyText = '🎥 Camera adjusted' + viewLabel + ' — ' + reason;
    } else if (tc.name === 'add_scene') {
        friendlyText = '🎬 New scene added — ' + (tc.args.title || tc.args.parsedScene?.title || 'new visualization');
    } else if (tc.name === 'set_sliders') {
        const vals = tc.args.values || {};
        const parts = Object.entries(vals).map(([id, v]) => id + '→' + v);
        friendlyText = '🎚️ Set ' + (parts.length > 0 ? parts.join(', ') : 'sliders');
    } else if (tc.name === 'eval_math') {
        const expr = tc.args.expression || '';
        const result = tc.result && tc.result.result !== undefined ? tc.result.result : null;
        const storedAs = tc.result && tc.result.stored_as;
        const err = tc.result && tc.result.error;
        if (err) {
            friendlyText = '🧮 eval: ' + expr + ' → ❌ ' + err;
        } else if (storedAs) {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '🧮 ' + expr + ' → 💾 memory[\'' + storedAs + '\'] ' + summary;
        } else if (Array.isArray(result) && result.length > 3) {
            friendlyText = '🧮 ' + expr + ' → [' + result.length + ' points]';
        } else {
            const val = typeof result === 'number' ? (Number.isInteger(result) ? result : +result.toFixed(6)) : JSON.stringify(result);
            friendlyText = '🧮 ' + expr + ' = ' + val;
        }
    } else if (tc.name === 'mem_get') {
        const key = tc.args.key || '';
        const err = tc.result && tc.result.error;
        if (key === '?') {
            const keys = tc.result && tc.result.keys;
            const keyList = keys && typeof keys === 'object' ? Object.keys(keys).join(', ') : '(empty)';
            friendlyText = '🗂️ memory keys: ' + keyList;
        } else if (err) {
            friendlyText = '🗂️ memory[\'' + key + '\'] → ❌ not found';
        } else {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '🗂️ memory[\'' + key + '\'] → ' + summary;
        }
    } else if (tc.name === 'mem_set') {
        const key = tc.args.key || '';
        const err = tc.result && tc.result.error;
        if (err) {
            friendlyText = '💾 mem_set[\'' + key + '\'] → ❌ ' + err;
        } else {
            const summary = (tc.result && tc.result.summary) || '';
            friendlyText = '💾 memory[\'' + key + '\'] = ' + summary;
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
            const pos = tc.args.position || 'top-left';
            friendlyText = '🖼️ Info overlay "' + id + '" @ ' + pos;
        }
    } else if (tc.name === 'navigate_proof') {
        const step = tc.args.step || 0;
        const reason = tc.args.reason || '';
        friendlyText = step === 0
            ? '📐 Proof: showing goal overview'
            : '📐 Proof: step ' + step + (reason ? ' — ' + reason : '');
    }

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;';
    chip.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'tool-call-summary';
    summary.style.flex = '1';
    summary.innerHTML = typeof renderMarkdown === 'function' ? renderMarkdown(friendlyText) : friendlyText;
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
    } else {
        resultPreview.textContent = 'Click summary to view raw tool call';
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
    });

    const hideResolvedPopup = () => { resolvedBackdrop.style.display = 'none'; };
    const onResolvedPopupKeydown = (e) => {
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
let ttsPlayer = null;         // TTSAudioPlayer instance (lazy-init)
let ttsHasOutputFile = false;
let ttsAbortController = null; // AbortController for the active fetch stream

function _ensureTTSPlayer() {
    if (!ttsPlayer && window.GeminiTTSPlayer) {
        ttsPlayer = new window.GeminiTTSPlayer.TTSAudioPlayer({
            volume: 0.5,
            persistKey: 'algebenchTTS',
            onVolumeChange(vol, muted) {
                const slider = document.getElementById('ttsVolumeSlider');
                const icon = document.getElementById('ttsVolumeIcon');
                if (slider) slider.value = muted ? 0 : vol;
                if (icon) icon.innerHTML = muted ? _SVG_MUTED : _SVG_UNMUTED;
            },
        });
        // Sync slider/icon to persisted volume on init
        const slider = document.getElementById('ttsVolumeSlider');
        const icon = document.getElementById('ttsVolumeIcon');
        if (slider) {
            slider.value = ttsPlayer.isMuted() ? 0 : ttsPlayer.getVolume();
            slider.addEventListener('input', () => ttsPlayer.setVolume(parseFloat(slider.value)));
        }
        if (icon) {
            icon.innerHTML = ttsPlayer.isMuted() ? _SVG_MUTED : _SVG_UNMUTED;
            icon.addEventListener('click', () => ttsPlayer.toggleMute());
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

async function speakText(text, { explicit = false } = {}) {
    if (selectedTtsMode === 'silent' && !explicit) return;

    const clean = text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[📍🤖👤]/g, '')
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
    let response;
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

// ----- Context Change Tracking -----
let _lastContextJson = '';

function logContextIfChanged() {
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
let _contextPollId = null;
function startContextPolling() {
    if (_contextPollId) return;
    _contextPollId = setInterval(logContextIfChanged, 1000);
}

// ----- Welcome Message -----
function sendWelcomeMessage() {
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
function renderMemoryPopup(mem, queryText) {
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

function updateMemoryStatus() {
    fetch('/api/memory')
        .then(r => r.ok ? r.json() : null)
        .then(mem => {
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
            const searchInput = document.getElementById('memory-popup-search');

            if (!pill) return;

            if (keys.length === 0) {
                pill.classList.add('hidden');
                // Also close popup if open
                const popup = document.getElementById('memory-popup');
                if (popup) popup.classList.add('hidden');
                return;
            }

            // Update pill
            if (countEl) countEl.textContent = keys.length;
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
    const memSearch = document.getElementById('memory-popup-search');

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
