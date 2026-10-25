/**
 * "Describe the problem": a code scene starts with the question, before any solution. The step caption's Ask-AI
 * button sends it on a step tied to code, and narration turned on at a code scene's first state sends it in place
 * of that state's narration.
 */
import { state } from '/state.js';
import type { LessonFormat, Scene } from '/types/lesson.js';

export const DESCRIBE_PROBLEM = {
    label: 'Describe the problem',
    prompt: "Introduce the problem this scene is about the way a good teacher would, before any solution: in plain, friendly words, what's the situation and what are we trying to figure out? Ground it in a small, concrete everyday picture or a tiny example I can hold in my head, and let me feel why it's not as easy as it first looks. Keep it short and conversational, not a formal spec (no input/output/constraints lists). Don't give away the solution, name the pattern or walk through the code; end by inviting me to think about how I'd approach it.",
};

function currentScene(): {lesson: LessonFormat; scene: Scene} | null {
    const lesson = state.lessonSpec as LessonFormat | null;
    const scene = lesson?.scenes?.[state.currentSceneIndex] as Scene | undefined;
    return lesson && scene?.id ? {lesson, scene} : null;
}

/** True when the current scene has code: a code file points into it. */
export function sceneHasCode(): boolean {
    const at = currentScene();
    return !!at && (at.lesson.codeFiles ?? []).some(file => (file.locations ?? []).some(l => l.scene === at.scene.id));
}

/** Send the prompt; resolves once the reply is in (false if the chat turned it away). */
export function describeProblem(): Promise<boolean> {
    return window.sendChatMessage(DESCRIBE_PROBLEM.prompt, {display: DESCRIBE_PROBLEM.label});
}
