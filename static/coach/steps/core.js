// ============================================================
// coach/steps/core.js — the built-in tour stops.
//
// Self-registers via the registry. Each step has a STABLE `id`
// (drives completion tracking — never rename/reuse). Adding a new
// feature's hint later is a sibling file + one line in index.js;
// this file never needs to change for that.
// ============================================================

import { coach } from '../registry.js';

coach.register([
    {
        id: 'scenes-nav',
        order: 10,
        group: 'core',
        target: '#btn-scenes',
        title: 'Pick a lesson',
        narration: 'Start here. This menu lists built-in lessons — each one is an interactive ' +
                   'scene you can step through at your own pace.',
        position: 'bottom-start',
    },
    {
        id: 'scenes-panel',
        order: 15,
        group: 'core',
        // The left-dock scene/step tree for the loaded lesson.
        target: () => {
            const tree = document.getElementById('scene-tree');
            if (tree && tree.getBoundingClientRect().width > 0) return tree;
            return document.getElementById('scene-dock') || tree;
        },
        title: 'Your map of the lesson',
        narration: 'This panel is the lesson outline. Each lesson has several scenes, and each scene ' +
                   'has steps — click any one to jump straight there. It’s how you move around at your own pace.',
        position: 'right',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => { ctx.clickDockTab('scenes'); await ctx.delay(150); },
    },
    {
        id: 'chat-window',
        order: 20,
        group: 'core',
        target: '#explanation-panel',
        title: 'Ask the AI anything',
        narration: 'This is the AI chat. It already knows what’s on your screen, so you can ask it ' +
                   'about the current scene, a step, or what to try next.',
        position: 'left',
        examplePrompts: ['What is this scene about?', 'Walk me through this step.'],
        action: async (ctx) => ctx.openChatTab(),
    },
    {
        id: 'voice-controls',
        order: 25,
        group: 'core',
        target: '#chat-tts-controls',
        title: 'Give the AI a voice',
        narration: 'The AI can read its answers aloud. Up here you can pick a character and its voice, ' +
                   'choose how it speaks — Read for word-for-word, Perform to let the character act it out, ' +
                   'or Silent for no audio — and set the volume to taste.',
        position: 'left',
        when: (ctx) => ctx.chatAvailable,
        optional: true,
        action: async (ctx) => { ctx.openChatTab(); await ctx.delay(150); },
    },
    {
        id: 'ask-math',
        order: 30,
        group: 'core',
        target: '#chat-input',
        title: 'Go as deep as you want',
        narration: 'You can ask about the math itself — definitions, why a step is valid, or how a ' +
                   'formula is derived. Type your own question, or tap an example.',
        position: 'left',
        examplePrompts: ['Why is this step valid?', 'Explain the math behind this.'],
        action: async (ctx) => ctx.openChatTab(),
    },
    {
        id: 'ai-ask-buttons',
        order: 35,
        group: 'core',
        // The ✦ "Ask AI" buttons appear on overlays, math, proof steps and graph
        // nodes. Point at whichever one is currently on screen.
        target: () => [...document.querySelectorAll('.ai-ask-btn')]
            .find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null,
        title: 'The ✦ Ask-AI buttons',
        narration: 'See the little sparkle buttons dotted around? Each one asks the AI about that exact ' +
                   'thing — a value, a symbol, a proof step, or a graph node. Click it to send the question ' +
                   'straight to chat, or hold Command (or Ctrl) and click to edit the question first.',
        position: 'top',   // sit above the ✦ button so the caption on the left stays visible
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => { ctx.clickDockTab('scenes'); await ctx.delay(150); },
    },
    {
        id: 'math-tab',
        order: 38,
        group: 'core',
        target: '#graph-proof-tree',
        title: 'The MATH tab',
        narration: 'Switch to the MATH tab and you get the full proof for this scene, step by step. ' +
                   'It’s synchronized — pick a step here and the graph below and the proof panel on the ' +
                   'right all jump to the same place.',
        position: 'right',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(300);
            ctx.selectFirstGraphStep();
            await ctx.delay(300);
        },
    },
    {
        id: 'math-graph',
        order: 40,
        group: 'core',
        target: '#graph-viewport',
        title: 'The semantic graph',
        narration: 'Here’s the selected step drawn as a semantic graph — the structure of the math ' +
                   'laid out visually, not just the symbols.',
        position: 'left',
        when: (ctx) => ctx.hasScene,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(300);
            ctx.selectFirstGraphStep();   // render an actual graph, not the placeholder
            await ctx.delay(350);
        },
    },
    {
        id: 'graph-interactive',
        order: 50,
        group: 'core',
        target: () => document.getElementById('graph-mermaid-container')
                    || document.getElementById('graph-viewport'),
        title: 'Every piece is clickable',
        narration: 'The graph is interactive. Hover over any node and a ✦ button appears — click it to ' +
                   'ask the AI about that exact sub-expression, or hold Command (or Ctrl) and click to ' +
                   'edit the question first. And clicking a node opens its details, which we’ll look at next.',
        position: 'left',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(200);
            ctx.selectFirstGraphStep();
            await ctx.delay(300);
        },
    },
    {
        id: 'node-details',
        order: 51,
        group: 'core',
        target: '#graph-info-panel-host',
        title: 'Node details',
        narration: 'Click a node and this panel shows what it is — the expression, a plain-language ' +
                   'description, and how it connects to the rest of the proof. From here you can ask the ' +
                   'AI about it or derive it further.',
        position: 'right',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(300);
            ctx.selectFirstGraphStep();
            await ctx.delay(500);          // let the graph finish rendering
            ctx.selectFirstGraphNode();    // then open the details panel
            await ctx.delay(400);
        },
    },
    {
        id: 'derive-button',
        order: 52,
        group: 'core',
        target: () => document.querySelector('.graph-panel-derive-btn'),
        title: 'Derive it step by step',
        narration: 'The Derive button — the stacked-lines icon next to ✦ — derives this expression. ' +
                   'It builds a verified, step-by-step derivation and docks it right onto the graph, so ' +
                   'you can watch how the result is reached rather than just being told.',
        position: 'bottom',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(300);
            ctx.selectFirstGraphStep();
            await ctx.delay(500);          // let the graph finish rendering
            ctx.selectFirstGraphNode();    // derive button lives in the node panel
            await ctx.delay(400);
        },
    },
    {
        id: 'chart-button',
        order: 53,
        group: 'core',
        target: () => [...document.querySelectorAll('.d3sg-chart-btn')]
            .find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null,
        title: 'Plot it as a chart',
        narration: 'Nodes whose expression can be plotted show a small chart button. Click it to open an ' +
                   'interactive Chart.js plot of that expression — handy for seeing how a function behaves, ' +
                   'not just its formula.',
        position: 'right',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('graph');
            await ctx.delay(250);
            ctx.selectFirstGraphStep();
            await ctx.delay(350);
        },
    },
    {
        id: 'graph-controls',
        order: 54,
        group: 'core',
        target: () => document.getElementById('graph-controls-left')
                    || document.getElementById('graph-viewport'),
        title: 'Make the graph yours',
        narration: 'This toolbar controls the graph itself. Switch the renderer between D3 and Mermaid, ' +
                   'change the theme and how much detail the labels show, flip the layout direction, zoom ' +
                   'in and out, or dock the graph right beside the 3D view so you can see both at once.',
        position: 'bottom',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => { ctx.clickDockTab('graph'); await ctx.delay(250); },
    },
    {
        id: 'proof-panel',
        order: 55,
        group: 'core',
        target: '#proof-panel',
        title: 'The proof, in words',
        narration: 'Over on the right, the proof panel walks the very same steps in plain language and ' +
                   'equations. Use the arrows at the bottom to step through it — it stays in sync with the ' +
                   'MATH tab and the graph.',
        position: 'left',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.openProofPanel();
            await ctx.delay(200);
            ctx.ensureProofStep();   // show a step unless one is already selected
            await ctx.delay(150);
        },
    },
    {
        id: 'viewport-3d',
        order: 60,
        group: 'core',
        target: () => document.getElementById('mathbox-container'),
        title: 'Play with the 3D view',
        narration: 'This is the 3D viewport, and it’s hands-on. Drag to rotate, scroll to zoom, and ' +
                   'shift-drag to pan. Everything here is live — the visualization updates as you explore.',
        position: 'top',
        when: (ctx) => ctx.hasScene,
        action: async (ctx) => { ctx.clickDockTab('scenes'); await ctx.delay(150); },
    },
    {
        id: 'camera-views',
        order: 62,
        group: 'core',
        target: '#camera-buttons',
        title: 'Jump to the best angle',
        narration: 'These camera buttons snap you to hand-picked viewpoints for the scene — an overview, ' +
                   'close-ups, or a follow/ride-along view that tracks the motion. Reset returns you to the ' +
                   'default angle whenever you get lost.',
        position: 'left',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => { ctx.clickDockTab('scenes'); await ctx.delay(200); },
    },
    {
        id: 'viewport-sliders',
        order: 64,
        group: 'core',
        target: () => {
            const so = document.getElementById('slider-overlay');
            if (so && !so.classList.contains('hidden') && so.children.length) return so;
            return document.getElementById('mathbox-container');
        },
        title: 'Move the sliders',
        narration: 'Many steps add sliders. Drag one and the 3D scene, the equations, and the labels all ' +
                   'update together in real time — it’s the best way to build intuition for how each ' +
                   'quantity shapes the result.',
        position: 'top',
        when: (ctx) => ctx.hasScene,
        optional: true,
        action: async (ctx) => {
            ctx.clickDockTab('scenes');
            ctx.gotoSliderStep();   // navigate to a step that actually has sliders
            await ctx.delay(400);
        },
    },
]);
