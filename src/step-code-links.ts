/** Step captions link into the same authored locations used by the code browser. */
import { state } from '/state.js';
import { compileExpr, evalExpr } from '/expr.js';
import { activeCodeLines, stepCodeLocations } from '/code-panel-model.js';
import type { LessonFormat, Scene } from '/types/lesson.js';

// The caption is rebuilt on every playback tick, and parsing each file's activeLineExpr
// again each time cost several milliseconds per tick in lessons with many code files.
// Scoped to the loaded lesson: how an expression compiles depends on that lesson's JS trust.
const compiledByLesson = new WeakMap<object, Map<string, ReturnType<typeof compileExpr>>>();
function compiledActive(lesson: object, expression: string) {
    let cache = compiledByLesson.get(lesson);
    if (!cache) { cache = new Map(); compiledByLesson.set(lesson, cache); }
    let fn = cache.get(expression);
    if (!fn) { fn = compileExpr(expression); cache.set(expression, fn); }
    return fn;
}

export function makeStepCodeLinks(): HTMLElement | null {
    const lesson = state.lessonSpec as LessonFormat | null;
    const scene = lesson?.scenes?.[state.currentSceneIndex] as Scene | undefined;
    const step = scene?.steps?.[state.currentStepIndex];
    if (!scene?.id || !step?.id) return null;
    const slider = scene.stepPlayback ? state.sceneSliders[scene.stepPlayback.slider] : undefined;
    const snapshot = slider && slider.kind !== 'tensor' ? slider.value : undefined;
    const refs = stepCodeLocations(lesson?.codeFiles ?? [], scene.id, step.id, snapshot, file => {
        if (!step.descriptionExpr || !file.activeLineExpr) return undefined;
        // lesson is non-null: scene came from lesson.scenes and was checked above.
        try { return activeCodeLines(evalExpr(compiledActive(lesson!, file.activeLineExpr), 0)); }
        catch { return new Set<number>(); }
    });
    if (!refs.length) return null;
    const links = document.createElement('div');
    links.className = 'step-code-links';
    links.setAttribute('role', 'group');
    links.setAttribute('aria-label', 'Code for this step');
    const label = document.createElement('span');label.textContent = 'Code:';links.append(label);
    for (const {file, location} of refs) {
        const button = document.createElement('button');button.type = 'button';
        button.textContent = file.path.split('/').pop() + ':' + location.line;
        button.title = location.label ?? file.path + ':' + location.line;
        button.setAttribute('aria-label', 'Open ' + file.path + ' line ' + location.line);
        button.addEventListener('mousedown', event => event.stopPropagation());
        button.onclick = () => window.dispatchEvent(new CustomEvent('algebench:opencode', {
            detail: {fileId: file.id, line: location.line, select: false},
        }));
        links.append(button);
    }
    return links;
}
