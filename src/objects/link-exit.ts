/** How a link gone from the state leaves: `connectTo`'s exit and exitMs, as the animation to play. */
export type LinkExit = 'flicker' | 'fade' | 'none';

/** How long a fade takes when the lesson doesn't say. */
const FADE_MS = 300;

/**
 * A failing lamp's flicker, never twice the same: it drops and catches at random moments, each catch weaker on the
 * whole, and snaps between them rather than fading. The offsets and strengths are random; the end is always dark.
 */
function randomFlicker(): {frames: Keyframe[]; ms: number} {
    const catches = 3 + Math.floor(Math.random() * 4), frames: Keyframe[] = [{offset: 0, opacity: 1}];
    let at = 0;
    for (let k = 0; k < catches; k++) {
        const left = catches - k, dark = at + (.9 - at) / left * (.3 + Math.random() * .4), lit = dark + (.9 - dark) / left * (.3 + Math.random() * .5);
        frames.push({offset: dark, opacity: Math.random() * .15}, {offset: lit, opacity: (1 - k / catches) * (.5 + Math.random() * .5)});
        at = lit;
    }
    frames.push({offset: Math.min(.97, at + .03 + Math.random() * .05), opacity: 0}, {offset: 1, opacity: 0});
    return {frames: frames.map(f => ({...f, easing: 'step-end'})), ms: 450 + Math.random() * 500};
}

/** The keyframes and duration of a link's exit; null when it just goes, the default. exitMs sets the time. */
export function linkExitAnimation(exit: LinkExit = 'none', exitMs?: number): {frames: Keyframe[]; ms: number} | null {
    if (exit === 'none' || exitMs === 0) return null;
    if (exit === 'fade') return {frames: [{opacity: 1}, {opacity: 0}], ms: exitMs ?? FADE_MS};
    const flicker = randomFlicker();
    return {frames: flicker.frames, ms: exitMs ?? flicker.ms};
}
