// ============================================================
// Context browser — buildSceneTree and scene dock navigation.
// ============================================================

import { state } from '/state.js';
import { renderKaTeX } from '/labels.js';

/** The lesson shape this module reads — only the fields the tree renders. */
interface TreeSpec {
    scenes?: { title?: string; steps?: { title?: string }[] }[];
}

// state.js is still untyped JavaScript, so its fields infer from their
// initializers. Describe the slice this module owns rather than spreading
// `any`; the cast goes away when state.js is converted.
interface ContextBrowserState {
    currentSceneIndex: number;
    currentStepIndex: number;
    visitedSteps: Set<string>;
}
const contextState = state as unknown as ContextBrowserState;

// navigateTo is injected at runtime via setBuildSceneTreeNavigateFn
// to avoid a circular dependency with scene-loader.js.
type NavigateFn = (sceneIdx: number, stepIdx: number) => void;

let _navigateFn: NavigateFn | null = null;
export function setNavigateFn(fn: NavigateFn): void { _navigateFn = fn; }

export function buildSceneTree(spec: TreeSpec | null | undefined): void {
    // Non-null: #scene-tree is static markup in index.html, and the JS wrote to
    // it before any guard — a missing one must keep throwing.
    const tree = document.getElementById('scene-tree')!;
    tree.innerHTML = '';
    if (!spec || !spec.scenes) return;

    spec.scenes.forEach((scene, i) => {
        const sceneTitle = scene.title || ('Scene ' + (i + 1));
        const sceneDiv = document.createElement('div');
        sceneDiv.className = 'tree-scene';
        sceneDiv.dataset.sceneIdx = String(i);

        const header = document.createElement('div');
        header.className = 'tree-scene-header';
        header.title = sceneTitle;

        const arrow = document.createElement('span');
        arrow.className = 'tree-scene-arrow';
        arrow.textContent = '\u25B6'; // ▶
        header.appendChild(arrow);

        const title = document.createElement('span');
        title.innerHTML = renderKaTeX(sceneTitle, false);
        title.title = sceneTitle;
        header.appendChild(title);

        header.addEventListener('click', (e) => {
            const rect = arrow.getBoundingClientRect();
            if (e.clientX < rect.right + 4) {
                sceneDiv.classList.toggle('expanded');
            } else {
                sceneDiv.classList.add('expanded');
                if (_navigateFn) _navigateFn(i, -1);
            }
        });

        sceneDiv.appendChild(header);

        if (scene.steps && scene.steps.length > 0) {
            const stepsDiv = document.createElement('div');
            stepsDiv.className = 'tree-steps';

            scene.steps.forEach((step, j) => {
                const stepTitle = step.title || ('Step ' + (j + 1));
                const stepDiv = document.createElement('div');
                stepDiv.className = 'tree-step';
                stepDiv.dataset.sceneIdx = String(i);
                stepDiv.dataset.stepIdx = String(j);
                stepDiv.title = stepTitle;
                stepDiv.innerHTML = renderKaTeX(stepTitle, false);
                stepDiv.addEventListener('click', () => { if (_navigateFn) _navigateFn(i, j); });
                stepsDiv.appendChild(stepDiv);
            });

            sceneDiv.appendChild(stepsDiv);
        }

        tree.appendChild(sceneDiv);
    });
}

export function updateTreeHighlight(): void {
    document.querySelectorAll<HTMLElement>('.tree-scene').forEach(el => {
        // Non-null: every .tree-scene is built above with data-scene-idx set.
        const idx = parseInt(el.dataset.sceneIdx!);
        el.classList.toggle('active', idx === contextState.currentSceneIndex);
        if (idx === contextState.currentSceneIndex) {
            el.classList.add('expanded');
        }
    });

    document.querySelectorAll<HTMLElement>('.tree-step').forEach(el => {
        const si = parseInt(el.dataset.sceneIdx!);
        const sti = parseInt(el.dataset.stepIdx!);
        el.classList.toggle('active', si === contextState.currentSceneIndex && sti === contextState.currentStepIndex);
        el.classList.toggle('visited',
            contextState.visitedSteps.has(si + ':' + sti) && !(si === contextState.currentSceneIndex && sti === contextState.currentStepIndex));
    });
}
