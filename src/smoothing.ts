// Camera-motion smoothing for pinch zoom and rotation drags. Pure (no THREE,
// no DOM) so it can be unit-tested.
//
// A Smoother tracks one scalar: `goal` is the total the input has asked for,
// `pos` the part already applied. Each frame it moves `pos` toward `goal` and
// returns the step to apply. Zoom smooths ln(zoom factor), so zooming in 2x
// and out 2x feel the same; rotation uses one Smoother per component of the
// rotation vector.
//
// Modes (pick one to compare; see SMOOTHING_MODES):
//   instant      apply every event at once (the old behaviour)
//   lowpass      first-order exponential approach — no overshoot, but the
//                velocity jumps the instant a new event lands
//   spring       critically-damped spring — velocity is continuous, so a
//                pinch starts and stops without a kick; no overshoot
//   ease-out     each event restarts a cubic ease-out tween to the new goal
//   ease-in-out  each event restarts a cubic ease-in-out tween; accelerates
//                from rest every time, so a continuous pinch pulses
//   min-jerk     each event re-plans a minimum-jerk (quintic) path from the
//                current position, velocity AND acceleration to the goal —
//                smoothest in the jerk sense, and retargets without a seam

export type SmoothingMode = 'instant' | 'lowpass' | 'spring' | 'ease-out' | 'ease-in-out' | 'min-jerk';

export const SMOOTHING_MODES: readonly SmoothingMode[] =
    ['instant', 'lowpass', 'spring', 'ease-out', 'ease-in-out', 'min-jerk'];

export const DEFAULT_SMOOTHING: SmoothingMode = 'min-jerk';

const LOWPASS_TAU = 0.06;      // s — time constant: 63% of the way in 60 ms
const SPRING_TIME = 0.08;      // s — SmoothDamp smooth time (≈ settle in 4x this)
const TWEEN_TIME = 0.18;       // s — ease-out / ease-in-out / min-jerk duration
const SETTLE_EPS = 1e-4;       // ln units: 0.01% zoom — below this, stop

export function isSmoothingMode(s: unknown): s is SmoothingMode {
    return typeof s === 'string' && (SMOOTHING_MODES as readonly string[]).includes(s);
}

export class Smoother {
    mode: SmoothingMode;
    pos = 0;
    goal = 0;
    vel = 0;
    acc = 0;
    // Tween / quintic plan, restarted on every retarget.
    private t = 0;
    private from = 0;
    private c: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];

    constructor(mode: SmoothingMode = DEFAULT_SMOOTHING) {
        this.mode = mode;
    }

    /** Add `dLog` (= ln factor, >0 zooms in) to the goal. */
    push(dLog: number): void {
        this.goal += dLog;
        this.t = 0;
        this.from = this.pos;
        if (this.mode === 'min-jerk') this.planQuintic();
    }

    /** Stop where we are (e.g. a distance limit was hit). */
    halt(): void {
        this.goal = this.pos;
        this.vel = 0;
        this.acc = 0;
        this.t = 0;
    }

    /** Rebase to zero so values stay small over a long session. */
    reset(): void {
        this.pos = this.goal = this.vel = this.acc = this.t = 0;
        this.from = 0;
    }

    get settled(): boolean {
        return Math.abs(this.goal - this.pos) < SETTLE_EPS && Math.abs(this.vel) < SETTLE_EPS * 10;
    }

    /** Advance by `dt` seconds; returns the Δpos to apply this frame. */
    step(dt: number): number {
        const dtc = Math.min(Math.max(dt, 0), 0.1);   // a stalled tab shouldn't teleport
        const prev = this.pos;
        switch (this.mode) {
            case 'instant':
                this.pos = this.goal;
                this.vel = 0;
                break;
            case 'lowpass': {
                const next = this.goal + (this.pos - this.goal) * Math.exp(-dtc / LOWPASS_TAU);
                this.vel = dtc > 0 ? (next - this.pos) / dtc : 0;
                this.pos = next;
                break;
            }
            case 'spring':
                this.smoothDamp(dtc);
                break;
            case 'ease-out':
            case 'ease-in-out': {
                this.t = Math.min(this.t + dtc, TWEEN_TIME);
                const u = this.t / TWEEN_TIME;
                const e = this.mode === 'ease-out'
                    ? 1 - Math.pow(1 - u, 3)
                    : (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
                const next = this.from + (this.goal - this.from) * e;
                this.vel = dtc > 0 ? (next - this.pos) / dtc : 0;
                this.pos = next;
                break;
            }
            case 'min-jerk': {
                this.t = Math.min(this.t + dtc, TWEEN_TIME);
                const [c0, c1, c2, c3, c4, c5] = this.c;
                const t = this.t;
                this.pos = c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * c5))));
                this.vel = c1 + t * (2 * c2 + t * (3 * c3 + t * (4 * c4 + t * 5 * c5)));
                this.acc = 2 * c2 + t * (6 * c3 + t * (12 * c4 + t * 20 * c5));
                if (this.t >= TWEEN_TIME) { this.pos = this.goal; this.vel = this.acc = 0; }
                break;
            }
        }
        if (this.settled) { this.pos = this.goal; this.vel = this.acc = 0; }
        return this.pos - prev;
    }

    // Critically-damped spring, exact for constant goal (Game Programming
    // Gems 4, "Critically Damped Ease-In/Ease-Out Smoothing" — Unity's
    // SmoothDamp). Stable for any dt.
    private smoothDamp(dt: number): void {
        const omega = 2 / SPRING_TIME;
        const x = omega * dt;
        const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const change = this.pos - this.goal;
        const temp = (this.vel + omega * change) * dt;
        this.vel = (this.vel - omega * temp) * exp;
        this.pos = this.goal + (change + temp) * exp;
    }

    // Quintic from (pos, vel, acc) now to (goal, 0, 0) at TWEEN_TIME: the
    // minimum-jerk trajectory with those boundary conditions.
    private planQuintic(): void {
        const T = TWEEN_TIME, d = this.goal - this.pos, v0 = this.vel, a0 = this.acc;
        this.c = [
            this.pos,
            v0,
            a0 / 2,
            (20 * d - 12 * v0 * T - 3 * a0 * T * T) / (2 * T ** 3),
            (-30 * d + 16 * v0 * T + 3 * a0 * T * T) / (2 * T ** 4),
            (12 * d - 6 * v0 * T - a0 * T * T) / (2 * T ** 5),
        ];
    }
}
