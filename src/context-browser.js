// ============================================================
// Context browser — buildSceneTree and scene dock navigation.
// ============================================================

import { state } from '/state.js';
import { renderKaTeX } from '/labels.js';

// navigateTo is injected at runtime via setBuildSceneTreeNavigateFn
// to avoid a circular dependency with scene-loader.js.
let _navigateFn = null;
export function setNavigateFn(fn) { _navigateFn = fn; }

export function buildSceneTree(spec) {
    const tree = document.getElementById('scene-tree');
    tree.innerHTML = '';
    if (!spec || !spec.scenes) return;

    spec.scenes.forEach((scene, i) => {
        const sceneTitle = scene.title || ('Scene ' + (i + 1));
        const sceneDiv = document.createElement('div');
        sceneDiv.className = 'tree-scene';
        sceneDiv.dataset.sceneIdx = i;

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
                stepDiv.dataset.sceneIdx = i;
                stepDiv.dataset.stepIdx = j;
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

export function updateTreeHighlight() {
    document.querySelectorAll('.tree-scene').forEach(el => {
        const idx = parseInt(el.dataset.sceneIdx);
        el.classList.toggle('active', idx === state.currentSceneIndex);
        if (idx === state.currentSceneIndex) {
            el.classList.add('expanded');
        }
    });

    document.querySelectorAll('.tree-step').forEach(el => {
        const si = parseInt(el.dataset.sceneIdx);
        const sti = parseInt(el.dataset.stepIdx);
        el.classList.toggle('active', si === state.currentSceneIndex && sti === state.currentStepIndex);
        el.classList.toggle('visited',
            state.visitedSteps.has(si + ':' + sti) && !(si === state.currentSceneIndex && sti === state.currentStepIndex));
    });
}
