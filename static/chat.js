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
        btn.title = text + '\n\nClick to send · Shift+click to edit';
        btn.addEventListener('click', (e) => {
            if (e.shiftKey) {
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

    ctx.runtime = runtime;
    return ctx;
}

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
                        }
                    } else if (tc.args.position) {
                        let pos = tc.args.position;
                        const tgt = tc.args.target || [0, 0, 0];
                        const zoom = tc.args.zoom;
                        // Direction vector from target to requested position
                        const dx = pos[0] - tgt[0], dy = pos[1] - tgt[1], dz = pos[2] - tgt[2];
                        const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
                        if (zoom != null && zoom > 0) {
                            // Explicit zoom: scale the requested distance
                            const s = 1 / zoom;
                            pos = [tgt[0] + dx * s, tgt[1] + dy * s, tgt[2] + dz * s];
                        } else if (typeof camera !== 'undefined' && typeof controls !== 'undefined') {
                            // No zoom: keep current distance, only change angle
                            const cx = camera.position.x - controls.target.x;
                            const cy = camera.position.y - controls.target.y;
                            const cz = camera.position.z - controls.target.z;
                            const curDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
                            const s = curDist / dirLen;
                            pos = [tgt[0] + dx * s, tgt[1] + dy * s, tgt[2] + dz * s];
                        }
                        if (typeof CAMERA_VIEWS !== 'undefined' && typeof animateCamera === 'function') {
                            CAMERA_VIEWS['__agent'] = { position: pos, target: tgt };
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
                    if (tc.args.clear) {
                        if (typeof removeAllInfoOverlays === 'function') removeAllInfoOverlays();
                    } else if (tc.args.id) {
                        if (typeof addInfoOverlay === 'function')
                            addInfoOverlay(tc.args.id, tc.args.content || '', tc.args.position || 'top-left');
                    }
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
            speakBtn.classList.remove('active', 'paused', 'loading', 'idle');
            if (state) speakBtn.classList.add(state);
            else speakBtn.classList.add('idle');
            msgDiv.classList.remove('tts-speaking', 'tts-loading', 'tts-paused');
            if (state === 'active') msgDiv.classList.add('tts-speaking');
            if (state === 'loading') msgDiv.classList.add('tts-loading');
            if (state === 'paused') msgDiv.classList.add('tts-paused');
            if (state === 'loading') {
                speakBtn.textContent = '...';
                speakBtn.title = 'Loading audio (click to cancel)';
            } else if (state === 'active') {
                speakBtn.innerHTML = SVG_SPEAKER;
                speakBtn.title = 'Playing (click to pause, double-click to restart)';
            } else if (state === 'paused') {
                speakBtn.innerHTML = SVG_SPEAKER;
                speakBtn.title = 'Paused (click to resume, double-click to restart)';
            } else {
                speakBtn.innerHTML = SVG_SPEAKER;
                speakBtn.title = 'Read aloud (click to play, double-click to restart)';
            }
        };

        const stopOtherBtn = () => {
            if (activeSpeakBtn && activeSpeakBtn !== speakBtn) {
                if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
                if (activeSpeakBtn._ttsLoadPoll) { clearInterval(activeSpeakBtn._ttsLoadPoll); activeSpeakBtn._ttsLoadPoll = null; }
                if (activeSpeakBtn._ttsStatePoll) { clearInterval(activeSpeakBtn._ttsStatePoll); activeSpeakBtn._ttsStatePoll = null; }
                if (typeof activeSpeakBtn._setBtnState === 'function') activeSpeakBtn._setBtnState(null);
                activeSpeakBtn = null;
            }
        };

        const startPlay = () => {
            stopOtherBtn();
            if (typeof window.algebenchSpeakText !== 'function') return;
            if (speakBtn._ttsLoadPoll) { clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null; }
            if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
            setBtnState('loading');
            activeSpeakBtn = speakBtn;
            window.algebenchSpeakText(body.dataset.markdown || content, () => {
                if (speakBtn._ttsLoadPoll) { clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null; }
                if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
                setBtnState(null);
                if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
            });
            // Poll: transition loading → active once TTS fetch completes
            speakBtn._ttsLoadPoll = setInterval(() => {
                if (!speakBtn.classList.contains('loading') || activeSpeakBtn !== speakBtn) {
                    clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null; return;
                }
                if (window.algebenchIsTTSLoading && !window.algebenchIsTTSLoading()) {
                    setBtnState('active');
                    clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null;
                }
            }, 80);
            // Keep UI synced to real TTS state.
            speakBtn._ttsStatePoll = setInterval(() => {
                if (activeSpeakBtn !== speakBtn) {
                    clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; return;
                }
                if (window.algebenchIsTTSLoading && window.algebenchIsTTSLoading()) {
                    if (!speakBtn.classList.contains('loading')) setBtnState('loading');
                    return;
                }
                if (window.algebenchIsTTSSpeaking && window.algebenchIsTTSSpeaking()) {
                    if (!speakBtn.classList.contains('active')) setBtnState('active');
                    return;
                }
                if (window.algebenchIsTTSPaused && window.algebenchIsTTSPaused()) {
                    if (!speakBtn.classList.contains('paused')) setBtnState('paused');
                    return;
                }
            }, 80);
        };
        speakBtn._setBtnState = setBtnState;
        msgDiv._startSpeak = startPlay;

        // Single click: play/pause/resume
        speakBtn.addEventListener('click', () => {
            if (speakBtn._ignoreNextClick) {
                speakBtn._ignoreNextClick = false;
                return;
            }
            if (speakBtn.classList.contains('loading')) {
                if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
                if (speakBtn._ttsLoadPoll) { clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null; }
                if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
                setBtnState(null);
                if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
                return;
            }
            if (activeSpeakBtn === speakBtn && ((window.algebenchIsTTSSpeaking && window.algebenchIsTTSSpeaking()) || speakBtn.classList.contains('active'))) {
                if (typeof window.algebenchPauseTTS === 'function') window.algebenchPauseTTS();
                setBtnState('paused');
                return;
            }
            if (activeSpeakBtn === speakBtn && ((window.algebenchIsTTSPaused && window.algebenchIsTTSPaused()) || speakBtn.classList.contains('paused'))) {
                if (typeof window.algebenchResumeTTS === 'function') window.algebenchResumeTTS();
                setBtnState('active');
                return;
            }
            startPlay();
        });

        // Double click: restart from beginning.
        speakBtn.addEventListener('dblclick', (e) => {
            e.preventDefault();
            speakBtn._ignoreNextClick = true;
            if (typeof window.algebenchStopTTS === 'function') window.algebenchStopTTS();
            if (speakBtn._ttsLoadPoll) { clearInterval(speakBtn._ttsLoadPoll); speakBtn._ttsLoadPoll = null; }
            if (speakBtn._ttsStatePoll) { clearInterval(speakBtn._ttsStatePoll); speakBtn._ttsStatePoll = null; }
            setBtnState(null);
            if (activeSpeakBtn === speakBtn) activeSpeakBtn = null;
            startPlay();
        });
        // Chunk progress bar (hidden until TTS starts)
        const chunkBar = document.createElement('div');
        chunkBar.className = 'tts-chunk-bar';
        chunkBar.style.display = 'none';
        speakBtn._chunkBar = chunkBar;
        const speakCol = document.createElement('div');
        speakCol.className = 'tts-speak-col';
        speakCol.appendChild(speakBtn);
        speakCol.appendChild(chunkBar);
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

// ----- TTS Playback (streaming Web Audio API) -----
let ttsRequestId = 0;         // Monotonic counter — invalidates stale streams on new request
let ttsLoading = false;        // true while fetch is open but no audio scheduled yet
let ttsPausedByUser = false;
let ttsAbortController = null; // AbortController for the active fetch stream
let ttsActiveSources = [];     // AudioBufferSourceNodes currently scheduled/playing
let ttsScheduleEndTime = 0;    // ctx.currentTime when the last scheduled buffer ends
let ttsStreamDone = false;     // true once all chunks have been received and scheduled
let ttsAudioContext = null;    // Shared AudioContext (also used for video-export recording)
let ttsMediaDestination = null;

// ----- TTS Chunk Progress Tracking -----
let ttsChunkTotal = 0;      // Total chunks expected (from X-TTS-Chunk-Count header)
let ttsChunksReceived = 0;  // Chunks decoded and scheduled
let ttsChunksPlayed = 0;    // Chunks that have finished playing

function _ttsResetChunkTracking(total) {
    ttsChunkTotal = total;
    ttsChunksReceived = 0;
    ttsChunksPlayed = 0;
    _ttsUpdateChunkUI();
}

function _ttsUpdateChunkUI() {
    if (!activeSpeakBtn) return;
    const bar = activeSpeakBtn._chunkBar;
    if (!bar) return;
    const n = ttsChunkTotal;
    if (n === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    // Rebuild pips if count changed
    if (bar.children.length !== n) {
        bar.innerHTML = '';
        for (let i = 0; i < n; i++) {
            const pip = document.createElement('span');
            pip.className = 'tts-pip';
            bar.appendChild(pip);
        }
    }
    const pips = bar.children;
    for (let i = 0; i < n; i++) {
        const pip = pips[i];
        if (i < ttsChunksPlayed) {
            pip.dataset.state = 'done';
        } else if (i === ttsChunksPlayed && ttsChunksReceived > ttsChunksPlayed) {
            pip.dataset.state = 'playing';
        } else if (i < ttsChunksReceived) {
            pip.dataset.state = 'buffered';
        } else {
            pip.dataset.state = 'pending';
        }
    }
}

// Lazy-init the shared AudioContext and recording destination.
function ensureTTSRecordingBus() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ttsAudioContext) ttsAudioContext = new Ctx();
    if (!ttsMediaDestination) ttsMediaDestination = ttsAudioContext.createMediaStreamDestination();
    return { ctx: ttsAudioContext, dest: ttsMediaDestination };
}

window.algebenchGetTTSAudioStream = function() {
    const bus = ensureTTSRecordingBus();
    if (!bus) return null;
    if (bus.ctx.state === 'suspended') bus.ctx.resume().catch(() => {});
    return bus.dest.stream;
};

// ---- State queries (same public API as before) ----

window.algebenchIsTTSSpeaking = function() {
    if (ttsLoading || ttsPausedByUser) return false;
    if (!ttsAudioContext) return false;
    // Playing if the context is running and there are scheduled or active sources
    return ttsAudioContext.state === 'running' &&
           (ttsActiveSources.length > 0 || ttsScheduleEndTime > ttsAudioContext.currentTime);
};

window.algebenchIsTTSPaused = function() {
    return ttsPausedByUser;
};

window.algebenchIsTTSLoading = function() { return ttsLoading; };

// ---- Controls ----

window.algebenchPauseTTS = function() {
    if (!ttsAudioContext) return;
    ttsPausedByUser = true;
    ttsAudioContext.suspend().catch(() => {});
};

window.algebenchResumeTTS = function() {
    if (!ttsAudioContext) return;
    ttsPausedByUser = false;
    ttsAudioContext.resume().catch(() => {});
};

window.algebenchStopTTS = function() {
    ++ttsRequestId;  // invalidate any in-flight stream
    _ttsStopActiveAudio();
};

function _ttsStopActiveAudio() {
    if (ttsAbortController) {
        ttsAbortController.abort();
        ttsAbortController = null;
    }
    for (const src of ttsActiveSources) {
        try { src.stop(); } catch (_) {}
    }
    ttsActiveSources = [];
    ttsScheduleEndTime = 0;
    ttsStreamDone = false;
    ttsLoading = false;
    ttsPausedByUser = false;
    ttsChunkTotal = 0;
    ttsChunksReceived = 0;
    ttsChunksPlayed = 0;
    if (activeSpeakBtn && activeSpeakBtn._chunkBar) {
        activeSpeakBtn._chunkBar.style.display = 'none';
    }
    // Resume the AudioContext so it's ready for the next request
    if (ttsAudioContext && ttsAudioContext.state === 'suspended') {
        ttsAudioContext.resume().catch(() => {});
    }
}

// ---- algebenchSpeakText with completion callback ----

window.algebenchSpeakText = function(text, onEnd) {
    const expectedId = ttsRequestId + 1;
    speakText(text, { explicit: true });

    if (typeof onEnd !== 'function') return;

    const startTime = Date.now();
    const poll = setInterval(() => {
        if (ttsRequestId !== expectedId) {
            clearInterval(poll); onEnd(); return;
        }
        // Done: stream finished and all scheduled audio has played out
        if (!ttsLoading && ttsStreamDone && ttsActiveSources.length === 0) {
            clearInterval(poll); onEnd(); return;
        }
        // Timeout fallback (e.g. TTS unavailable)
        if (Date.now() - startTime > 60000) {
            clearInterval(poll); onEnd();
        }
    }, 80);
};

// ---- WAV chunk parser ----
// The server yields self-contained WAV files. The fetch reader delivers raw bytes
// that may span chunk boundaries, so we accumulate and split on RIFF headers.

class _WavStreamParser {
    constructor() { this._buf = new Uint8Array(0); }

    push(data) {
        const merged = new Uint8Array(this._buf.length + data.length);
        merged.set(this._buf);
        merged.set(data, this._buf.length);
        this._buf = merged;

        const wavs = [];
        let pos = 0;
        while (pos + 8 <= this._buf.length) {
            // Verify RIFF magic
            if (this._buf[pos]   !== 0x52 || this._buf[pos+1] !== 0x49 ||
                this._buf[pos+2] !== 0x46 || this._buf[pos+3] !== 0x46) {
                pos++; continue;  // resync
            }
            const riffPayload = new DataView(
                this._buf.buffer, this._buf.byteOffset + pos + 4, 4
            ).getUint32(0, true);
            const total = riffPayload + 8;
            if (pos + total > this._buf.length) break; // incomplete — wait for more
            wavs.push(
                this._buf.buffer.slice(
                    this._buf.byteOffset + pos,
                    this._buf.byteOffset + pos + total
                )
            );
            pos += total;
        }
        this._buf = this._buf.slice(pos);
        return wavs;
    }
}

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

    // Stop previous playback and claim a new request ID
    const myId = ++ttsRequestId;
    _ttsStopActiveAudio();
    ttsLoading = true;
    ttsStreamDone = false;

    // Ensure AudioContext exists and is running
    const bus = ensureTTSRecordingBus();
    if (!bus) { ttsLoading = false; return; }
    const ctx = bus.ctx;
    const mediaDest = bus.dest;
    if (ctx.state === 'suspended') await ctx.resume();

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
    } catch (err) {
        if (ttsRequestId === myId) { ttsLoading = false; ttsStreamDone = true; }
        return;
    }

    if (!response.ok || ttsRequestId !== myId) {
        ttsLoading = false; ttsStreamDone = true; return;
    }

    const chunkCount = parseInt(response.headers.get('X-TTS-Chunk-Count') || '0', 10);
    _ttsResetChunkTracking(chunkCount);

    const parser = new _WavStreamParser();
    const reader = response.body.getReader();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done || ttsRequestId !== myId) break;

            for (const wavBuf of parser.push(value)) {
                if (ttsRequestId !== myId) break;

                let audioBuffer;
                try {
                    audioBuffer = await ctx.decodeAudioData(wavBuf);
                } catch (e) {
                    console.warn('TTS: decodeAudioData failed', e);
                    continue;
                }

                if (ttsRequestId !== myId || ctx.state === 'closed') break;

                // First decoded chunk — audio is starting
                if (ttsLoading) ttsLoading = false;

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                if (mediaDest) source.connect(mediaDest);

                const now = ctx.currentTime;
                const startAt = Math.max(ttsScheduleEndTime, now + 0.02);
                source.start(startAt);
                ttsScheduleEndTime = startAt + audioBuffer.duration;

                ttsChunksReceived++;
                _ttsUpdateChunkUI();

                ttsActiveSources.push(source);
                source.onended = () => {
                    const i = ttsActiveSources.indexOf(source);
                    if (i >= 0) ttsActiveSources.splice(i, 1);
                    ttsChunksPlayed++;
                    _ttsUpdateChunkUI();
                };
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.warn('TTS stream error:', err);
    } finally {
        if (ttsRequestId === myId) {
            ttsLoading = false;
            ttsStreamDone = true;
            ttsAbortController = null;
        }
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
    console.log('%c🤖 Chat context updated: %c' +
        `scene=[${sceneParts}] runtime=[${rtParts}] (${json.length} chars)`,
        'color: #8888ff; font-weight: bold', 'color: #ccc');
}

// Poll for context changes (scene/step/camera/slider changes)
let _contextPollId = null;
function startContextPolling() {
    if (_contextPollId) return;
    _contextPollId = setInterval(logContextIfChanged, 1000);
    // Also log immediately
    setTimeout(logContextIfChanged, 500);
}

// ----- Welcome Message -----
function sendWelcomeMessage() {
    if (!chatAvailable || shouldSkipWelcome() || welcomeInFlight) return;
    welcomeInFlight = true;
    sendChatMessage(
        'The user just opened the visualization. Give a brief, friendly welcome (1-2 sentences) and mention what they\'re currently looking at. Be concise.',
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
