/** Display-only Python sources and complete, immutable execution snapshots for the common-algorithm-patterns draft. */
export type Cell = number | string;
export type Value = number | string | Cell[];
/** One execution snapshot: every key is present in every frame of a trace, so bindings never miss a column. */
export type Frame = Record<string, Value> & { line: number; message: string; status: 'Running' | 'Done'; running: number };

/**
 * Records full copies of `vars` (arrays sliced) with the active one-based source line, and what the calls on that
 * line returned when given (`{'h(start)': 6}`, keyed by each call's source without spaces): the frame's `returns`.
 */
function recorder<V extends Record<string, Value>>(vars: V) {
    const trace: (V & Frame)[] = [];
    // ln_<var>: the line where <var> was last assigned, read off its tip changing. Labels link to it.
    const tipText: Record<string, Value> = {}, tipLine: Record<string, number> = {};
    const emit = (line: number, message: string, status: Frame['status'] = 'Running', returns?: Record<string, Value>) => {
        const copy = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]));
        for (const [k, v] of Object.entries(vars)) {
            if (!k.startsWith('tip_')) continue;
            if (v && v !== tipText[k]) tipLine[k] = line;
            tipText[k] = v;
            copy[`ln_${k.slice(4)}`] = v ? tipLine[k] ?? 0 : 0;
        }
        trace.push({ ...copy, line, message, status, running: status === 'Running' ? 1 : 0, ...(returns ? { returns } : {}) } as unknown as V & Frame);
    };
    return { trace, emit };
}

// tip_<var> columns: LaTeX explaining how a variable got its current value, set
// where it is assigned and kept until the next assignment. Labels show them as
// KaTeX tooltips, and as callouts when the value is recalculated.
const tt = (name: string) => String.raw`\text{${name}}`;
const at = (arr: string, i: number | string) => String.raw`${tt(arr)}\lbrack ${i}\rbrack`;

export const PREFIX_SOURCE = `def build_prefix(nums):
    prefix = [0]
    for k, x in enumerate(nums):
        prefix.append(prefix[-1] + x)
    return prefix

def range_sum(prefix, i, j):
    return prefix[j + 1] - prefix[i]`;
export function prefixSumTrace(nums: number[], queries: [number, number][]) {
    const v = { k: -1, x: 0, prefix: [0] as number[], n: 1, qi: -1, qj: -1, querying: 0, answer: 0, hasAnswer: 0,
        tip_last: `${at('prefix', 0)} = 0`, tip_answer: '' };
    const { trace, emit } = recorder(v);
    emit(2, 'Start the prefix array with 0, the sum of no elements.');
    nums.forEach((x, k) => {
        v.k = k; v.x = x;
        emit(3, `Read nums[${k}] = ${x}.`);
        const last = v.prefix.at(-1)!;
        v.prefix.push(last + x); v.n = v.prefix.length;
        v.tip_last = `${at('prefix', k + 1)} = ${at('prefix', k)} + ${at('nums', k)} = ${last} + ${x} = ${last + x}`;
        emit(4, `prefix[${k + 1}] = prefix[${k}] + ${x} = ${last} + ${x} = ${last + x}, the sum of the first ${k + 1} numbers.`);
    });
    v.k = -1; v.x = 0;
    emit(5, `Built in one O(n) pass. prefix[m] is the sum of everything left of position m.`);
    queries.forEach(([i, j], q) => {
        v.querying = 1; v.qi = i; v.qj = j; v.hasAnswer = 0; v.answer = 0; v.tip_answer = '';
        emit(7, `Query: the sum of nums[${i}..${j}].`);
        const hi = v.prefix[j + 1]!, lo = v.prefix[i]!;
        v.answer = hi - lo; v.hasAnswer = 1;
        v.tip_answer = String.raw`\text{sum}(${tt('nums')}\lbrack ${i}..${j}\rbrack) = ${at('prefix', j + 1)} - ${at('prefix', i)} = ${hi} - ${lo} = ${v.answer}`;
        emit(8, `prefix[${j + 1}] − prefix[${i}] = ${hi} − ${lo} = ${v.answer}. One subtraction, no loop.`, q === queries.length - 1 ? 'Done' : 'Running');
    });
    return trace;
}

export const TWO_POINTERS_SOURCE = `def two_sum_sorted(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        total = nums[left] + nums[right]
        if total == target:
            return [left, right]
        if total < target:
            left += 1
        else:
            right -= 1
    return []`;
export function twoPointersTrace(nums: number[], target: number) {
    // sumL/sumR: the indices total was computed from. The pointers move on before total is recomputed.
    const v = { left: 0, right: nums.length - 1, total: 0, hasTotal: 0, sumL: -1, sumR: -1, found: 0,
        tip_left: `${tt('left')} = 0`, tip_right: String.raw`${tt('right')} = \text{len}(${tt('nums')}) - 1 = ${nums.length - 1}`, tip_total: '', tip_cmp: '' };
    const { trace, emit } = recorder(v);
    emit(2, `Start at both ends: left = 0, right = ${v.right}.`);
    while (true) {
        emit(3, v.left < v.right ? 'left < right, so candidate pairs remain.' : 'The pointers met, so no pair remains.');
        if (v.left >= v.right) break;
        const a = nums[v.left]!, b = nums[v.right]!;
        v.total = a + b; v.hasTotal = 1; v.sumL = v.left; v.sumR = v.right;
        v.tip_total = `${tt('total')} = ${at('nums', v.left)} + ${at('nums', v.right)} = ${a} + ${b} = ${v.total}`;
        v.tip_cmp = v.total < target ? String.raw`${v.total} < ${target} \;\Rightarrow\; ${tt('left')} \mathrel{+}= 1`
            : v.total > target ? String.raw`${v.total} > ${target} \;\Rightarrow\; ${tt('right')} \mathrel{-}= 1`
            : String.raw`${v.total} = ${target} \;\Rightarrow\; \text{found at } (${v.left}, ${v.right})`;
        emit(4, `nums[${v.left}] + nums[${v.right}] = ${a} + ${b} = ${v.total}.`);
        emit(5, `Is ${v.total} equal to the target ${target}?`);
        if (v.total === target) { v.found = 1; emit(6, `Found it: indices ${v.left} and ${v.right}.`, 'Done'); return trace; }
        emit(7, `Is ${v.total} less than ${target}?`);
        if (v.total < target) {
            v.left++; v.tip_left = `${tt('left')} = ${v.left - 1} + 1 = ${v.left}`;
            emit(8, `Too small. nums[right] is the largest value left, so ${a} cannot reach the target with anything. Drop it: left = ${v.left}.`);
        } else {
            v.right--; v.tip_right = `${tt('right')} = ${v.right + 1} - 1 = ${v.right}`;
            emit(10, `Too big. nums[left] is the smallest value left, so ${b} overshoots with everything. Drop it: right = ${v.right}.`);
        }
    }
    v.hasTotal = 0; v.tip_total = v.tip_cmp = '';
    emit(11, 'No pair sums to the target.', 'Done');
    return trace;
}

export const SLIDING_WINDOW_SOURCE = `def max_window_sum(nums, k):
    window = sum(nums[:k])
    best = window
    for right in range(k, len(nums)):
        window += nums[right] - nums[right - k]
        best = max(best, window)
    return best`;
export function slidingWindowTrace(nums: number[], k: number) {
    // prevBest/improved describe the comparison on line 6, made before best is updated; -1/0 elsewhere.
    // wOld/wIn/wOut/wRight: the last O(1) update that produced window (wOld = -1 before the first slide).
    const v = { left: 0, right: k - 1, dropped: -1, window: 0, best: 0, bestLeft: 0, prevBest: -1, improved: 0, wOld: -1, wIn: 0, wOut: 0, wRight: -1,
        tip_window: '', tip_best: '', tip_cmp: '', tip_right: '' };
    const { trace, emit } = recorder(v);
    v.window = nums.slice(0, k).reduce((s, x) => s + x, 0);
    v.tip_window = String.raw`${tt('window')} = \text{sum}(${tt('nums')}\lbrack :${k}\rbrack) = ${nums.slice(0, k).join(' + ')} = ${v.window}`;
    emit(2, `Sum the first window, nums[0..${k - 1}]: ${v.window}.`);
    v.best = v.window; v.tip_best = `${tt('best')} = ${tt('window')} = ${v.best}`;
    emit(3, `best = ${v.best}.`);
    for (let right = k; right < nums.length; right++) {
        v.right = right; v.left = right - k + 1; v.dropped = right - k;
        v.tip_right = String.raw`${tt('right')} = ${right} \quad \text{(next of range(${k}, ${nums.length}))}`;
        const enter = nums[right]!, leave = nums[right - k]!, old = v.window;
        emit(4, `Slide right: nums[${right}] = ${enter} enters, nums[${right - k}] = ${leave} leaves.`);
        v.window += enter - leave; v.wOld = old; v.wIn = enter; v.wOut = leave; v.wRight = right;
        v.tip_window = `${tt('window')} = ${old} + ${at('nums', right)} - ${at('nums', right - k)} = ${old} + ${enter} - ${leave} = ${v.window}`;
        emit(5, `window = ${old} + ${enter} − ${leave} = ${v.window}. An O(1) update instead of re-summing ${k} numbers.`);
        v.dropped = -1; v.prevBest = v.best; v.improved = v.window > v.best ? 1 : 0;
        v.tip_cmp = v.tip_best = String.raw`${tt('best')} = \max(${v.prevBest}, ${v.window}) = ${Math.max(v.prevBest, v.window)}`;
        if (v.improved) { v.best = v.window; v.bestLeft = v.left; emit(6, `${v.window} beats the old best: best = ${v.best}.`); }
        else emit(6, `${v.window} does not beat best = ${v.best}.`);
        v.prevBest = -1; v.improved = 0; v.tip_cmp = '';
    }
    v.left = v.bestLeft; v.right = v.bestLeft + k - 1;
    emit(7, `The best window is nums[${v.left}..${v.right}], with sum ${v.best}.`, 'Done');
    return trace;
}

export const FAST_SLOW_SOURCE = `def find_duplicate(nums):
    slow = fast = 0
    while True:
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast:
            break
    slow = 0
    while slow != fast:
        slow = nums[slow]
        fast = nums[fast]
    return slow`;
export function fastSlowTrace(nums: number[]) {
    // Index 0 is the start: no value is 0, so nothing points back to it and it is never inside the loop.
    const v = { slow: 0, fast: 0, phase: 1, hop: -1, tip_slow: `${tt('slow')} = 0`, tip_fast: `${tt('fast')} = 0` };
    const { trace, emit } = recorder(v);
    emit(2, 'Both pointers start at index 0. Read each value as a pointer to the index it names.');
    while (true) {
        emit(3, 'Phase 1: slow moves one hop, fast moves two, until they meet.');
        const s = v.slow; v.slow = nums[s]!; v.tip_slow = `${tt('slow')} = ${at('nums', s)} = ${v.slow}`;
        emit(4, `slow takes one hop: nums[${s}] = ${v.slow}.`);
        const f = v.fast; v.hop = nums[f]!; v.fast = nums[v.hop]!;
        v.tip_fast = String.raw`${tt('fast')} = ${tt('nums')}\lbrack ${at('nums', f)}\rbrack = ${at('nums', v.hop)} = ${v.fast}`;
        emit(5, `fast takes two hops: nums[${f}] = ${v.hop}, then nums[${v.hop}] = ${v.fast}.`);
        v.hop = -1;
        emit(6, `Do they meet? slow = ${v.slow}, fast = ${v.fast}.`);
        if (v.slow === v.fast) { emit(7, `They meet at index ${v.slow}, somewhere inside the cycle.`); break; }
    }
    v.phase = 2; v.slow = 0; v.tip_slow = `${tt('slow')} = 0`;
    emit(8, 'Phase 2: restart slow at index 0; fast stays put. Both now move one hop at a time.');
    while (true) {
        emit(9, v.slow !== v.fast ? `slow = ${v.slow}, fast = ${v.fast}: not yet equal.` : `slow = fast = ${v.slow}.`);
        if (v.slow === v.fast) break;
        const s = v.slow; v.slow = nums[s]!; v.tip_slow = `${tt('slow')} = ${at('nums', s)} = ${v.slow}`;
        emit(10, `slow: nums[${s}] = ${v.slow}.`);
        const f = v.fast; v.fast = nums[f]!; v.tip_fast = `${tt('fast')} = ${at('nums', f)} = ${v.fast}`;
        emit(11, `fast: nums[${f}] = ${v.fast}.`);
    }
    emit(12, `They meet at the cycle entrance, ${v.slow}. Two indices point to it, so ${v.slow} is the duplicate.`, 'Done');
    return trace;
}

/**
 * The shape the pointers walk: following nums from index 0 gives a straight path (the lead-in) into a loop,
 * entered at the duplicate. A = steps from 0 to the entrance, C = the loop's length.
 */
export function rhoShape(nums: number[]) {
    const order: number[] = [];
    for (let i = 0; !order.includes(i); i = nums[i]!) order.push(i);
    const entrance = nums[order.at(-1)!]!;
    const A = order.indexOf(entrance);
    return { path: order.slice(0, A), cycle: order.slice(A), entrance, A, C: order.length - A };
}

/**
 * Why phase 2 finds the entrance, as a recorded run on the same code: phase 1 to the first meeting, then the
 * proof (A, B, C and the three equations, one per state, `stage` counting what is revealed), then phase 2.
 * `phaseSteps` counts phase-2 steps; `meet` is the first meeting point.
 */
export function fastSlowProofTrace(nums: number[]) {
    const { entrance, A, C, cycle } = rhoShape(nums);
    const v = { slow: 0, fast: 0, phase: 1, stage: 0, t: 0, phaseSteps: -1, meet: -1, B: -1 };
    const { trace, emit } = recorder(v);
    const ring = (i: number) => cycle.indexOf(i);   // steps past the entrance, for an index on the loop
    emit(2, `Both pointers start at index 0. Following the arrows, a path of **A** = ${A} steps leads into a loop of **C** = ${C} steps, entered at index ${entrance}.`);
    while (true) {
        v.t++;
        v.slow = nums[v.slow]!; v.fast = nums[nums[v.fast]!]!;
        emit(5, `Round t = ${v.t}: slow takes 1 step to ${v.slow}, fast takes 2 to ${v.fast}. Slow has walked t = ${v.t}, fast 2t = ${2 * v.t}.`);
        if (v.slow === v.fast) break;
    }
    v.meet = v.slow; v.B = ring(v.meet);
    const t = v.t, k = t / C, m = (t - A - v.B) / C;
    emit(7, `They first meet at index ${v.meet} after **t = ${t}** rounds. That is not the entrance (${entrance}), so it is not yet the answer.`);
    v.stage = 1; emit(7, `**A = ${A}**: the steps from the start to the loop's entrance, index ${entrance}.`);
    v.stage = 2; emit(7, `**B = ${v.B}**: the steps from the entrance on to the meeting point, index ${v.meet}.`);
    v.stage = 3; emit(7, `**C = ${C}**: the length of the loop.`);
    v.stage = 4; emit(7, `Fast walked $2t$, slow $t$, and they stand on the same spot, so fast's extra $t$ steps are whole laps: $2t - t = kC$. Here $${2 * t} - ${t} = ${t} = ${k}\\cdot ${C}$.`);
    v.stage = 5; emit(7, `Slow walked the path, then $B$ into the loop, plus some whole laps: $t = A + B + mC$. Here $${t} = ${A} + ${v.B} + ${m}\\cdot ${C}$.`);
    v.stage = 6; emit(7, `Both equal $t$, so $A + B = (k - m)C$, a whole number of laps: $\\boxed{A \\equiv -B \\pmod C}$. Here $${A} \\equiv -${v.B} \\equiv ${((A % C) + C) % C} \\pmod{${C}}$. So $A$ more steps from the meeting point (already $B$ past the entrance) end $B + A \\equiv 0$ steps past it: at the entrance.`);
    v.phase = 2; v.slow = 0; v.phaseSteps = 0;
    emit(8, `Phase 2: slow goes back to the start; fast stays at the meeting point, ${v.B} past the entrance. Both now take one step at a time: slow needs $A = ${A}$ to arrive, and fast, $B + A \\equiv 0 \\pmod C$, arrives on the same step.`);
    while (v.slow !== v.fast) {
        v.slow = nums[v.slow]!; v.fast = nums[v.fast]!; v.phaseSteps++;
        const s = v.phaseSteps, past = (v.B + s) % C;
        emit(11, v.slow === v.fast
            ? `Step ${s} = A: slow reaches the entrance along the path, fast reaches it around the loop ($B + A = ${v.B + s} \\equiv 0 \\pmod{${C}}$). They meet at index ${v.slow}.`
            : `Step ${s}: slow is ${A - s} step${A - s === 1 ? '' : 's'} from the entrance; fast is $B + ${s} = ${v.B + s} \\equiv ${past}$ step${past === 1 ? '' : 's'} past it.`);
    }
    emit(12, `Index ${v.slow} is the entrance, and two cells point to it (${nums.flatMap((x, i) => x === v.slow ? [i] : []).join(' and ')}), so **${v.slow} is the duplicate**.`, 'Done');
    return trace;
}

export const MONOTONIC_STACK_SOURCE = `def daily_temperatures(temps):
    answer = [0] * len(temps)
    stack = []
    for i, t in enumerate(temps):
        while stack and temps[stack[-1]] < t:
            j = stack.pop()
            answer[j] = i - j
        stack.append(i)
    return answer`;
export function monotonicStackTrace(temps: number[]) {
    const v = { i: -1, t: 0, j: -1, top: -1, stack: [] as number[], n: 0, answer: temps.map(() => 0), tip_t: '', tip_j: '' };
    const { trace, emit } = recorder(v);
    emit(2, 'Every answer starts at 0, meaning no warmer day yet.');
    emit(3, 'The stack holds days still waiting for a warmer day. Their temperatures never increase from bottom to top.');
    temps.forEach((t, i) => {
        v.i = i; v.t = t; v.j = -1; v.tip_t = `${tt('t')} = ${at('temps', i)} = ${t}`; v.tip_j = '';
        emit(4, `Day ${i}: ${t}°.`);
        while (true) {
            v.top = v.stack.at(-1) ?? -1;
            if (v.top < 0) { emit(5, 'The stack is empty, so nobody is waiting.'); break; }
            const warmer = temps[v.top]! < t;
            emit(5, `Is day ${v.top}'s ${temps[v.top]}° below ${t}°? ${warmer ? 'Yes.' : 'No, so the stack stays as it is.'}`);
            if (!warmer) break;
            v.j = v.stack.pop()!; v.n = v.stack.length; v.top = -1;
            v.tip_j = String.raw`${tt('j')} = ${tt('stack')}.\text{pop}() = ${v.j} \quad ${at('answer', v.j)} = ${i} - ${v.j} = ${i - v.j}`;
            emit(6, `Pop day ${v.j}: day ${i} is its first warmer day.`);
            v.answer[v.j] = i - v.j;
            emit(7, `answer[${v.j}] = ${i} − ${v.j} = ${i - v.j}.`);
        }
        v.j = -1; v.top = -1; v.tip_j = '';
        v.stack.push(i); v.n = v.stack.length;
        emit(8, `Push day ${i}. It waits for a warmer day.`);
    });
    v.i = -1; v.t = 0; v.tip_t = '';
    emit(9, `Each day was pushed once and popped at most once: O(n). Days left on the stack keep answer 0.`, 'Done');
    return trace;
}

export const ROTATED_SEARCH_SOURCE = `def search_rotated(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[lo] <= nums[mid]:
            if nums[lo] <= target < nums[mid]:
                hi = mid - 1
            else:
                lo = mid + 1
        else:
            if nums[mid] < target <= nums[hi]:
                lo = mid + 1
            else:
                hi = mid - 1
    return -1`;
export function rotatedSearchTrace(nums: number[], target: number) {
    const v = { lo: 0, hi: nums.length - 1, mid: -1, half: 0, found: -1,
        tip_lo: `${tt('lo')} = 0`, tip_hi: String.raw`${tt('hi')} = \text{len}(${tt('nums')}) - 1 = ${nums.length - 1}`, tip_mid: '', tip_half: '', comparing: 0, tip_cmp: '' };
    const { trace, emit } = recorder(v);
    emit(2, `Search all of nums: lo = 0, hi = ${v.hi}.`);
    while (true) {
        v.half = 0; v.tip_half = '';
        emit(3, v.lo <= v.hi ? `lo ≤ hi, so ${v.hi - v.lo + 1} candidates remain.` : 'lo passed hi, so no candidates remain.');
        if (v.lo > v.hi) break;
        v.mid = Math.floor((v.lo + v.hi) / 2);
        v.tip_mid = String.raw`${tt('mid')} = \lfloor (${tt('lo')} + ${tt('hi')}) / 2 \rfloor = \lfloor (${v.lo} + ${v.hi}) / 2 \rfloor = ${v.mid}`;
        emit(4, `mid = (${v.lo} + ${v.hi}) // 2 = ${v.mid}.`);
        const m = nums[v.mid]!, l = nums[v.lo]!, h = nums[v.hi]!;
        v.comparing = 1;
        v.tip_cmp = m === target ? String.raw`${at('nums', v.mid)} = ${m} = ${tt('target')} \;\Rightarrow\; \text{return } ${v.mid}`
            : String.raw`${at('nums', v.mid)} = ${m} \ne ${target} \;\Rightarrow\; \text{keep searching}`;
        emit(5, `Is nums[${v.mid}] = ${m} the target ${target}?`);
        if (m === target) { v.found = v.mid; emit(6, `Found ${target} at index ${v.mid}.`, 'Done'); return trace; }
        v.comparing = 0; v.tip_cmp = '';
        emit(7, `At least one half is sorted. Is nums[lo] = ${l} ≤ nums[mid] = ${m}?`);
        if (l <= m) {
            v.half = 1; v.tip_half = String.raw`${at('nums', v.lo)} = ${l} \le ${at('nums', v.mid)} = ${m} \;\Rightarrow\; \text{left half sorted}`;
            emit(8, `Yes: nums[${v.lo}..${v.mid}] runs ${l} to ${m} in order. Is ${target} inside that range?`);
            if (l <= target && target < m) { v.hi = v.mid - 1; v.tip_hi = `${tt('hi')} = ${tt('mid')} - 1 = ${v.mid} - 1 = ${v.hi}`; emit(9, `Yes: keep the left half. hi = ${v.hi}.`); }
            else { v.lo = v.mid + 1; v.tip_lo = `${tt('lo')} = ${tt('mid')} + 1 = ${v.mid} + 1 = ${v.lo}`; emit(11, `No: the target can only be right of mid. lo = ${v.lo}.`); }
        } else {
            v.half = 2; v.tip_half = String.raw`${at('nums', v.lo)} = ${l} > ${at('nums', v.mid)} = ${m} \;\Rightarrow\; \text{right half sorted}`;
            emit(13, `No, so nums[${v.mid}..${v.hi}] runs ${m} to ${h} in order. Is ${target} inside that range?`);
            if (m < target && target <= h) { v.lo = v.mid + 1; v.tip_lo = `${tt('lo')} = ${tt('mid')} + 1 = ${v.mid} + 1 = ${v.lo}`; emit(14, `Yes: keep the right half. lo = ${v.lo}.`); }
            else { v.hi = v.mid - 1; v.tip_hi = `${tt('hi')} = ${tt('mid')} - 1 = ${v.mid} - 1 = ${v.hi}`; emit(16, `No: the target can only be left of mid. hi = ${v.hi}.`); }
        }
    }
    v.mid = -1; v.tip_mid = '';
    emit(17, `${target} is not in the array.`, 'Done');
    return trace;
}

export const MERGE_INTERVALS_SOURCE = `def merge(intervals):
    intervals.sort(key=lambda iv: iv[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged`;
const showInterval = ([s, e]: [number, number]) => `[${s},${e}]`;
/**
 * A drawing lane per interval, fixed for that interval whatever order the array is in:
 * greedy over start order, so intervals sharing a lane never overlap.
 */
export function intervalLanes(input: [number, number][]): number[] {
    const order = input.map((_, i) => i).sort((a, b) => input[a]![0] - input[b]![0] || a - b);
    const laneEnds: number[] = [], lanes = input.map(() => 0);
    for (const i of order) {
        const [start, end] = input[i]!;
        let lane = laneEnds.findIndex(e => e < start);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); } else laneEnds[lane] = end;
        lanes[i] = lane;
    }
    return lanes;
}
export function mergeIntervalsTrace(input: [number, number][]) {
    const laneOf = intervalLanes(input);
    const v = { k: -1, starts: input.map(iv => iv[0]), ends: input.map(iv => iv[1]), lanes: laneOf.slice(), mStarts: [] as number[], mEnds: [] as number[], m: 0,
        // Line 5's check, kept until the next interval: cmp = 1 overlap, 0 no overlap, -1 merged empty, -2 not checked yet.
        // cmpStart/cmpEnd are the values compared, read before merged[-1] is extended.
        cmp: -2, cmpStart: 0, cmpEnd: 0, cmpIdx: -1, tip_cmp: '', tip_m: String.raw`\text{len}(${tt('merged')}) = 0` };
    const { trace, emit } = recorder(v);
    const sync = (merged: [number, number][]) => { v.mStarts = merged.map(iv => iv[0]); v.mEnds = merged.map(iv => iv[1]); v.m = merged.length; };
    emit(1, 'The input intervals, in the order given. Each column is one interval.');
    // Each interval keeps its lane through the sort: the lanes are permuted with it.
    const order = input.map((_, i) => i).sort((a, b) => input[a]![0] - input[b]![0]);
    const sorted = order.map(i => input[i]!);
    v.starts = sorted.map(iv => iv[0]); v.ends = sorted.map(iv => iv[1]); v.lanes = order.map(i => laneOf[i]!);
    emit(2, 'Sort by start. Now any interval that overlaps the current group must come right after it.');
    const merged: [number, number][] = [];
    emit(3, 'merged starts empty.');
    sorted.forEach(([start, end], k) => {
        v.k = k; v.cmp = -2; v.tip_cmp = '';
        emit(4, `Next interval: [${start},${end}].`);
        const last = merged.at(-1);
        const overlaps = !!last && start <= last[1];
        v.cmp = !last ? -1 : overlaps ? 1 : 0; v.cmpStart = start; v.cmpEnd = last?.[1] ?? 0; v.cmpIdx = merged.length - 1;
        v.tip_cmp = !last ? String.raw`${tt('merged')} = \lbrack\rbrack \;\Rightarrow\; \text{append}`
            : String.raw`${tt('start')} \le ${tt('merged')}\lbrack -1\rbrack\lbrack 1\rbrack \;\Rightarrow\; ${start} ${overlaps ? '\\le' : '>'} ${last[1]} \;\Rightarrow\; \text{${overlaps ? 'extend' : 'append'}}`;
        emit(5, last ? `Does it start at or before the last merged end, ${last[1]}? ${overlaps ? 'Yes.' : 'No.'}` : 'merged is empty, so there is nothing to overlap.');
        if (overlaps) {
            const before = last![1];
            last![1] = Math.max(last![1], end); sync(merged);
            v.tip_m = String.raw`${tt('merged')}\lbrack -1\rbrack\lbrack 1\rbrack = \max(${before}, ${end}) = ${last![1]} \quad \text{len}(${tt('merged')}) = ${v.m}`;
            emit(6, `Overlap: extend the last interval to ${showInterval(last!)}.`);
        } else {
            merged.push([start, end]); sync(merged);
            v.tip_m = String.raw`${tt('merged')}.\text{append}(\lbrack ${start}, ${end}\rbrack) \quad \text{len}(${tt('merged')}) = ${v.m}`;
            emit(8, `No overlap: start a new group, [${start},${end}].`);
        }
    });
    v.k = -1; v.cmp = -2; v.tip_cmp = '';
    emit(9, `${merged.length} disjoint intervals. Sorting costs O(n log n); the sweep is O(n).`, 'Done');
    return trace;
}

export const HOUSE_ROBBER_SOURCE = `def rob(houses):
    dp = [0] * (len(houses) + 1)
    dp[1] = houses[0]
    for i in range(2, len(houses) + 1):
        skip = dp[i - 1]
        take = dp[i - 2] + houses[i - 1]
        dp[i] = max(skip, take)
    return dp[-1]`;
export function houseRobberTrace(houses: number[]) {
    const v = { i: -1, house: -1, read: -1, skip: 0, take: 0, hasSkip: 0, hasTake: 0, dp: [0, ...houses.map(() => 0)], tip_skip: '', tip_take: '' };
    const { trace, emit } = recorder(v);
    emit(2, 'dp[i] will hold the most you can steal from the first i houses. dp[0] = 0: no houses, no loot.');
    v.i = 1; v.house = 0; v.dp[1] = houses[0]!;
    emit(3, `With one house, take it: dp[1] = ${houses[0]}.`);
    for (let i = 2; i <= houses.length; i++) {
        v.i = i; v.house = -1; v.read = -1; v.hasSkip = v.hasTake = 0; v.tip_skip = v.tip_take = '';
        emit(4, `Decide house ${i - 1} (value ${houses[i - 1]}), using answers already computed.`);
        v.read = i - 1; v.skip = v.dp[i - 1]!; v.hasSkip = 1;
        v.tip_skip = `${tt('skip')} = ${at('dp', i - 1)} = ${v.skip}`;
        emit(5, `Skip house ${i - 1}: keep the best from ${i - 1} houses, dp[${i - 1}] = ${v.skip}.`);
        v.read = i - 2; v.house = i - 1; v.take = v.dp[i - 2]! + houses[i - 1]!; v.hasTake = 1;
        v.tip_take = `${tt('take')} = ${at('dp', i - 2)} + ${at('houses', i - 1)} = ${v.dp[i - 2]} + ${houses[i - 1]} = ${v.take}`;
        emit(6, `Take house ${i - 1}: its neighbour is off limits, so add ${houses[i - 1]} to dp[${i - 2}] = ${v.dp[i - 2]}: ${v.take}.`);
        v.read = -1; v.house = -1; v.dp[i] = Math.max(v.skip, v.take);
        emit(7, `dp[${i}] = max(${v.skip}, ${v.take}) = ${v.dp[i]}.`);
    }
    v.hasSkip = v.hasTake = 0; v.i = houses.length; v.tip_skip = v.tip_take = '';
    emit(8, `Answer: dp[${houses.length}] = ${v.dp[houses.length]}. Each subproblem was solved once: O(n).`, 'Done');
    return trace;
}

export const KADANE_SOURCE = `def max_subarray(nums):
    cur = best = nums[0]
    for i in range(1, len(nums)):
        cur = max(nums[i], cur + nums[i])
        best = max(best, cur)
    return best`;
/**
 * Kadane's algorithm: cur is the best sum of a subarray ending at i, a DP that keeps only its last value.
 * start..i is the run cur covers; bs..be is the best run found.
 */
export function kadaneTrace(nums: number[]) {
    const first = nums[0]!;
    const v = { i: 0, cur: first, best: first, start: 0, bs: 0, be: 0, restart: 0, extend: 0,
        tip_cur: `${tt('cur')} = ${at('nums', 0)} = ${first}`, tip_best: `${tt('best')} = ${at('nums', 0)} = ${first}` };
    const { trace, emit } = recorder(v);
    emit(2, `Start with the first number: the best subarray ending at index 0 is just [${first}].`);
    for (let i = 1; i < nums.length; i++) {
        v.i = i; v.restart = 0; v.extend = v.cur + nums[i]!;
        emit(3, `Index ${i} (value ${nums[i]}): end a subarray here, either fresh or by extending the run.`);
        const prev = v.cur;
        if (nums[i]! > v.extend) { v.cur = nums[i]!; v.start = i; v.restart = 1; } else v.cur = v.extend;
        v.tip_cur = String.raw`${tt('cur')} = \max(${at('nums', i)},\; ${tt('cur')} + ${at('nums', i)}) = \max(${nums[i]},\; ${prev} + ${nums[i]}) = ${v.cur}`;
        emit(4, v.restart ? `Start fresh: ${nums[i]} beats ${prev} + ${nums[i]} = ${v.extend}, so the old run (sum ${prev}) only drags it down.`
            : `Extend the run: ${prev} + ${nums[i]} = ${v.extend} is at least ${nums[i]} on its own.`);
        if (v.cur > v.best) {
            const was = v.best;
            v.best = v.cur; v.bs = v.start; v.be = i;
            v.tip_best = String.raw`${tt('best')} = \max(${tt('best')},\; ${tt('cur')}) = \max(${was},\; ${v.cur}) = ${v.best}`;
            emit(5, `New best: ${v.best}, the sum of nums[${v.bs}..${v.be}].`);
        } else emit(5, `best stays ${v.best}: this run (${v.cur}) does not beat it.`);
    }
    emit(6, `Answer: ${v.best}, the sum of nums[${v.bs}..${v.be}]. One pass, keeping only the last dp value: O(n) time, O(1) space.`, 'Done');
    return trace;
}

export const LCS_SOURCE = `def lcs(a, b):
    dp = [[0] * (len(a) + 1) for _ in range(len(b) + 1)]
    for i in range(1, len(b) + 1):
        for j in range(1, len(a) + 1):
            if b[i - 1] == a[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[-1][-1]`;
/**
 * Longest common subsequence, a 2D DP: dp[i][j] is the LCS of b[:i] and a[:j]. Each table row is its own
 * column (r0, r1, ...) so the scene draws one array per row. match: -1 before the compare, else 1 / 0.
 * diag, up, left: the cells the recurrence reads (-1 outside the loop).
 */
export function lcsTrace(a: string, b: string) {
    const rows = Array.from({ length: b.length + 1 }, () => Array<number>(a.length + 1).fill(0));
    const v: Record<string, Value> = { i: 0, j: 0, match: -1, ca: '', cb: '', diag: -1, up: -1, left: -1, tip_cell: '' };
    const sync = () => rows.forEach((r, k) => { v[`r${k}`] = r.slice(); });
    sync();
    const { trace, emit } = recorder(v);
    emit(2, `dp[i][j] will hold the LCS length of the first i letters of "${b}" and the first j of "${a}". Row 0 and column 0 are empty strings: 0.`);
    for (let i = 1; i <= b.length; i++) {
        v.i = i; v.j = 0; v.match = -1; v.cb = b[i - 1]!; v.ca = ''; v.diag = v.up = v.left = -1;
        emit(3, `Row ${i}: add "${b[i - 1]}" from b.`);
        for (let j = 1; j <= a.length; j++) {
            v.j = j; v.ca = a[j - 1]!; v.diag = rows[i - 1]![j - 1]!; v.up = rows[i - 1]![j]!; v.left = rows[i]![j - 1]!;
            v.match = b[i - 1] === a[j - 1] ? 1 : 0;
            emit(5, `Compare b[${i - 1}] = "${b[i - 1]}" with a[${j - 1}] = "${a[j - 1]}": ${v.match ? 'a match' : 'different'}.`);
            if (v.match) {
                rows[i]![j] = (v.diag as number) + 1; sync();
                v.tip_cell = String.raw`${tt('dp')}\lbrack ${i}\rbrack\lbrack ${j}\rbrack = ${tt('dp')}\lbrack ${i - 1}\rbrack\lbrack ${j - 1}\rbrack + 1 = ${v.diag} + 1 = ${rows[i]![j]}`;
                emit(6, `Match: extend the LCS without both letters by one, dp[${i - 1}][${j - 1}] + 1 = ${rows[i]![j]}.`);
            } else {
                rows[i]![j] = Math.max(v.up as number, v.left as number); sync();
                v.tip_cell = String.raw`${tt('dp')}\lbrack ${i}\rbrack\lbrack ${j}\rbrack = \max(${tt('dp')}\lbrack ${i - 1}\rbrack\lbrack ${j}\rbrack,\; ${tt('dp')}\lbrack ${i}\rbrack\lbrack ${j - 1}\rbrack) = \max(${v.up},\; ${v.left}) = ${rows[i]![j]}`;
                emit(8, `No match: drop one letter, the better of above (${v.up}) and left (${v.left}): ${rows[i]![j]}.`);
            }
        }
    }
    v.match = -1; v.diag = v.up = v.left = -1; v.ca = v.cb = ''; v.tip_cell = '';
    emit(9, `Answer: dp[${b.length}][${a.length}] = ${rows[b.length]![a.length]}. Each of the ${a.length * b.length} cells took O(1): O(m·n).`, 'Done');
    return trace;
}

export const TOP_K_SOURCE = `import heapq

def kth_largest(nums, k):
    heap = []
    for x in nums:
        heapq.heappush(heap, x)
        if len(heap) > k:
            heapq.heappop(heap)
    return heap[0]`;
/**
 * k-th largest with a min-heap of size k, as heapq runs it: heappush appends and sifts up, heappop moves
 * the last value to the root and sifts down. Each comparison inside them is its own frame on the call's
 * line. a, b: the two heap slots compared (after a swap, a is where the moving value landed); over: line 7's
 * len(heap) > k (-1 before it is evaluated), checked: the length it saw; dropped: every value popped, all smaller than what stays.
 */
export function topKTrace(nums: number[], k: number) {
    const heap: number[] = [], dropped: number[] = [];
    const v = { i: -1, x: 0, heap, dropped, a: -1, b: -1, swap: 0, over: -1, checked: 0, size: 0 };
    const { trace, emit } = recorder(v);
    const sync = () => { v.heap = heap.slice(); v.dropped = dropped.slice(); v.size = heap.length; };
    const swap = (p: number, q: number) => { [heap[p], heap[q]] = [heap[q]!, heap[p]!]; };
    emit(4, `Start with an empty min-heap. It will hold the ${k} largest values seen so far, smallest on top.`);
    nums.forEach((x, i) => {
        v.i = i; v.x = x; v.a = v.b = -1; v.swap = 0; v.over = -1;
        emit(5, `Next value: x = ${x}.`);
        heap.push(x); sync(); v.a = heap.length - 1;
        emit(6, `heappush: append ${x} at index ${heap.length - 1}, the next free slot, so the tree stays complete.`);
        for (let c = heap.length - 1; c > 0;) {
            const p = (c - 1) >> 1;
            v.a = c; v.b = p; v.swap = 0;
            if (heap[c]! < heap[p]!) {
                emit(6, `${heap[c]} is smaller than its parent ${heap[p]} (index ${p}): swap it up.`);
                swap(c, p); sync(); v.a = p; v.b = c; v.swap = 1;
                emit(6, `${heap[p]} moved up to index ${p}.`);
                c = p;
            } else {
                emit(6, `${heap[c]} is at least its parent ${heap[p]}: every parent is ≤ its children again.`);
                break;
            }
        }
        v.a = v.b = -1; v.swap = 0; v.over = heap.length > k ? 1 : 0; v.checked = heap.length;
        emit(7, heap.length > k ? `len(heap) = ${heap.length} > k = ${k}: one too many.` : `len(heap) = ${heap.length} ≤ k = ${k}: keep everything so far.`);
        if (heap.length > k) {
            const root = heap[0]!, last = heap.pop()!;
            dropped.push(root);
            if (heap.length) heap[0] = last;
            sync(); v.a = heap.length ? 0 : -1;
            emit(8, `heappop: drop the smallest, ${root}. It cannot be among the ${k} largest. The last value, ${last}, moves to the root.`);
            for (let c = 0; ;) {
                const l = 2 * c + 1, r = l + 1;
                if (l >= heap.length) break;
                const m = r < heap.length && heap[r]! < heap[l]! ? r : l;
                v.a = c; v.b = m; v.swap = 0;
                if (heap[m]! < heap[c]!) {
                    emit(8, `${heap[c]} is larger than its smaller child ${heap[m]} (index ${m}): swap it down.`);
                    swap(c, m); sync(); v.a = m; v.b = c; v.swap = 1;
                    emit(8, `${heap[m]} moved down to index ${m}.`);
                    c = m;
                } else {
                    emit(8, `${heap[c]} is at most its smaller child ${heap[m]}: the heap rule holds.`);
                    break;
                }
            }
        }
        v.a = v.b = -1; v.swap = 0;
    });
    v.i = -1; v.over = -1;
    emit(9, `Answer: heap[0] = ${heap[0]}. The heap holds the ${k} largest values, and its root is the smallest of them: the k-th largest. O(n log k).`, 'Done');
    return trace;
}

export const TRIE_SOURCE = `class Node:
    def __init__(self):
        self.children = {}
        self.end = False

def build(words):
    root = Node()
    for word in words:
        node = root
        for ch in word:
            if ch not in node.children:
                node.children[ch] = Node()
            node = node.children[ch]
        node.end = True
    return root

def starts_with(root, prefix):
    node = root
    for ch in prefix:
        if ch not in node.children:
            return False
        node = node.children[ch]
    return True`;
/**
 * Build a trie from words, then answer starts_with for each query. Nodes are numbered in creation order
 * (the root is 0), and `nodes` describes the finished trie: each node's letter, parent and depth, so a view can
 * lay it out once and show the first `count` nodes at each frame. Per frame: cur, the node the code is at;
 * cond, line 11's / 20's `ch in node.children` (-1 before it runs); ends and onPath, 0/1 per node (end of a
 * word; on the walk from the root to cur); text, the word or prefix being walked, ci its letter.
 */
export function trieTrace(words: string[], queries: string[]) {
    const nodes: { ch: string; parent: number; depth: number }[] = [{ ch: '', parent: -1, depth: 0 }];
    const children: Map<string, number>[] = [new Map()];
    // The finished trie first, so every frame can mark nodes by their final index.
    for (const w of words) {
        let n = 0;
        for (const ch of w) {
            if (!children[n]!.has(ch)) { children[n]!.set(ch, nodes.length); nodes.push({ ch, parent: n, depth: nodes[n]!.depth + 1 }); children.push(new Map()); }
            n = children[n]!.get(ch)!;
        }
    }
    const total = nodes.length, made = new Set<number>([0]), ends = Array<number>(total).fill(0);
    const v = { phase: 0, wi: -1, qi: -1, ci: -1, ch: '', text: [] as string[], cur: 0, count: 1, cond: -1, ends: ends.slice(), onPath: Array<number>(total).fill(0), result: '' };
    const { trace, emit } = recorder(v);
    const path: number[] = [];
    const sync = () => { v.ends = ends.slice(); v.onPath = Array.from({ length: total }, (_, i) => path.includes(i) ? 1 : 0); v.count = made.size; };
    sync();
    emit(7, 'Start with an empty root. Each node maps a letter to a child; a path from the root spells a prefix.');
    words.forEach((w, wi) => {
        v.wi = wi; v.text = [...w]; v.ci = -1; v.ch = ''; v.cur = 0; v.cond = -1; path.length = 0; path.push(0); sync();
        emit(9, `Insert "${w}": start at the root.`);
        [...w].forEach((ch, ci) => {
            const next = children[v.cur]!.get(ch)!;
            v.ci = ci; v.ch = ch; v.cond = made.has(next) ? 1 : 0;
            emit(11, made.has(next) ? `"${ch}" is already a child: "${w.slice(0, ci + 1)}" is a shared prefix.` : `No "${ch}" child yet.`);
            if (!made.has(next)) { made.add(next); sync(); emit(12, `Create a node for "${ch}".`); }
            v.cur = next; path.push(next); v.cond = -1; sync();
            emit(13, `Step down to "${ch}".`);
        });
        ends[v.cur] = 1; sync();
        emit(14, `Mark the end of "${w}": a word stops here, even if longer words continue below.`);
    });
    v.phase = 1; v.wi = -1;
    queries.forEach((q, qi) => {
        v.qi = qi; v.text = [...q]; v.ci = -1; v.ch = ''; v.cur = 0; v.cond = -1; v.result = ''; path.length = 0; path.push(0); sync();
        emit(18, `starts_with("${q}"): start at the root.`);
        for (const [ci, ch] of [...q].entries()) {
            const next = children[v.cur]!.get(ch);
            v.ci = ci; v.ch = ch; v.cond = next !== undefined ? 1 : 0;
            emit(20, next !== undefined ? `"${ch}" is a child: keep going.` : `No "${ch}" child: no word starts with "${q.slice(0, ci + 1)}".`);
            if (next === undefined) { v.result = 'False'; emit(21, `Return False for "${q}".`); return; }
            v.cur = next; path.push(next); v.cond = -1; sync();
            emit(22, `Step down to "${ch}".`);
        }
        v.result = 'True'; v.ci = -1;
        emit(23, `Return True: the whole prefix "${q}" is a path from the root. O(length of the prefix), however many words are stored.`);
    });
    v.phase = 2; v.qi = -1; v.text = []; v.ci = -1; v.ch = ''; v.cond = -1; v.cur = 0; path.length = 0; sync();
    emit(23, `Done: ${words.length} words share ${total - 1} letter nodes instead of ${words.reduce((s, w) => s + w.length, 0)} letters, because shared prefixes are stored once.`, 'Done');
    return { trace, nodes };
}

export const LINKED_LIST_SOURCE = `class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

def reverse(head):
    prev = None
    curr = head
    while curr:
        nxt = curr.next
        curr.next = prev
        prev = curr
        curr = nxt
    return prev`;
/**
 * Reverse a singly linked list of nodes 0..n−1 (node i holds values[i], initially linked i → i + 1). next[i] is
 * node i's next (−1 for None); prev, curr, nxt are nodes (−1 for None). fromPrev / fromCurr spell the two lists
 * the pointers hold, as Python would walk them: the reversed part and what is left.
 */
export function linkedListTrace(values: number[]) {
    const n = values.length, next = values.map((_, i) => (i + 1 < n ? i + 1 : -1));
    const v = { next: next.slice(), prev: -1, curr: -1, nxt: -1, head: 0, flipped: -1, fromPrev: '', fromCurr: '' };
    const { trace, emit } = recorder(v);
    const walk = (start: number) => { const out: string[] = []; for (let i = start, k = 0; i >= 0 && k <= n; i = next[i]!, k++) out.push(String(values[i])); return [...out, 'None'].join(' → '); };
    const sync = () => { v.next = next.slice(); v.fromPrev = walk(v.prev); v.fromCurr = walk(v.curr); };
    sync();
    emit(6, `The list: ${walk(0)}. Reverse it in place by flipping each next pointer.`);
    v.prev = -1; sync(); emit(7, 'prev = None: the reversed part starts empty.');
    v.curr = 0; sync(); emit(8, `curr = head: start at ${values[0]}.`);
    while (v.curr >= 0) {
        const c = v.curr;
        v.flipped = -1;
        emit(9, `curr is ${values[c]}, not None: keep going.`);
        v.nxt = next[c]!; sync();
        emit(10, v.nxt >= 0 ? `Save nxt = ${values[v.nxt]} first: flipping curr.next would lose the rest of the list.` : 'Save nxt = None: this is the last node.');
        next[c] = v.prev; v.flipped = c; sync();
        emit(11, `Flip: ${values[c]}.next now points back at ${v.prev >= 0 ? values[v.prev] : 'None'}.`);
        v.flipped = -1; v.prev = c; sync();
        emit(12, `prev = ${values[c]}: the reversed part grows to ${walk(v.prev)}.`);
        v.curr = v.nxt; sync();
        emit(13, v.curr >= 0 ? `curr = nxt = ${values[v.curr]}.` : 'curr = nxt = None.');
    }
    v.nxt = -1; v.head = v.prev; sync();
    emit(9, 'curr is None: every node has been flipped.');
    emit(14, `Return prev = ${values[v.prev]}, the new head: ${walk(v.prev)}. Each node rewired once: O(n) time, O(1) space.`, 'Done');
    return trace;
}

export const HASH_MAP_SOURCE = `def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        other = target - num
        if other in seen:
            return [seen[other], i]
        seen[num] = i
    return []

def subarray_sum(nums, target):
    count = {0: 1}  # Pretend we've seen sum = 0 once before starting.
    running_sum = subarray_count = 0
    for num in nums:
        running_sum += num
        subarray_count += count.get(running_sum - target, 0)
        count[running_sum] = count.get(running_sum, 0) + 1
    return subarray_count`;
/** The 1-based line of HASH_MAP_SOURCE containing `text`, searching from the function `fn` on. */
export const hashLine = (fn: string, text: string) => {
    const lines = HASH_MAP_SOURCE.split('\n'), from = lines.findIndex(l => l.startsWith(`def ${fn}(`));
    return lines.findIndex((l, i) => i >= from && l.includes(text)) + 1;
};
/**
 * Two Sum with a dict: walk the list once; for each number, look up the partner it needs among the numbers seen so
 * far, then remember this one (value → index). Per frame: i (−1 before the loop), num, other (hasOther 1 once it is
 * computed for this num); keys and
 * vals, the dict's entries in insertion order; look, the entry position the lookup found (−1 a miss or none);
 * cond, the last `other in seen` (−1 not yet, 0 False, 1 True); result, the answer once found ('—' before), and
 * returned, its label text (kept in the data: an expression quoting "return" would read as JavaScript).
 */
export function twoSumTrace(nums: number[], target: number) {
    const L = (t: string) => hashLine('two_sum', t);
    // seen: the dict's keys, so the Code panel can test `other in seen`.
    const v = { i: -1, num: 0, other: 0, hasOther: 0, keys: [] as number[], vals: [] as number[], seen: [] as number[], look: -1, cond: -1, result: '—', returned: 'return: —' };
    const { trace, emit } = recorder(v);
    emit(L('seen = {}'), `seen starts empty: it will map each number to its index.`);
    for (let i = 0; i < nums.length; i++) {
        const num = nums[i]!;
        v.i = i; v.num = num; v.look = -1; v.cond = -1; v.hasOther = 0;
        emit(L('for i, num'), `i = ${i}, num = ${num}.`);
        v.other = target - num; v.hasOther = 1;
        emit(L('other = target - num'), `other = ${target} − ${num} = ${v.other}: the partner that would make ${target}.`);
        const at = v.keys.indexOf(v.other);
        v.cond = at >= 0 ? 1 : 0; v.look = at;
        emit(L('if other in seen'), at >= 0 ? `${v.other} is in seen: one lookup, O(1).` : `${v.other} is not in seen: no earlier number pairs with ${num}.`);
        if (at >= 0) {
            v.result = `[${v.vals[at]}, ${i}]`; v.returned = `return ${v.result}`;
            emit(L('return [seen[other], i]'), `Found: nums[${v.vals[at]}] + nums[${i}] = ${v.other} + ${num} = ${target}. Return ${v.result}.`, 'Done');
            return trace;
        }
        v.keys = [...v.keys, num]; v.vals = [...v.vals, i]; v.seen = v.keys; v.look = v.keys.length - 1;
        emit(L('seen[num] = i'), `Remember ${num} at index ${i}: seen[${num}] = ${i}.`);
    }
    v.i = -1; v.look = -1; v.result = '[]'; v.returned = 'return []';
    emit(L('return []'), 'No two numbers add up to the target.', 'Done');
    return trace;
}

/**
 * Subarrays summing to target, with prefix sums and a dict of how often each prefix has appeared: a subarray ending
 * here sums to target exactly when an earlier prefix equals running_sum − target. Per frame: i, num, runningSum, need (running_sum − target), target,
 * got (count.get(need, 0); −1 before the lookup), subarrayCount; keys and vals, the dict's entries; look, the entry
 * position read or written (−1 none); gotText, the lookup's label text (in the data: an expression quoting
 * "count.get(" would read as JavaScript).
 */
export function subarraySumTrace(nums: number[], target: number) {
    const L = (t: string) => hashLine('subarray_sum', t);
    const v = { target, i: -1, num: 0, runningSum: 0, need: 0, got: -1, subarrayCount: 0, keys: [0] as number[], vals: [1] as number[], look: -1, gotText: 'count.get(running_sum - target, 0): —' };
    const { trace, emit } = recorder(v);
    emit(L('count = {0: 1}'), 'count = {0: 1}: the empty prefix, before any number, has sum 0 once.');
    emit(L('running_sum = subarray_count = 0'), 'running_sum and subarray_count start at 0.');
    for (let i = 0; i < nums.length; i++) {
        const num = nums[i]!;
        v.i = i; v.num = num; v.got = -1; v.look = -1; v.gotText = 'count.get(running_sum - target, 0): —';
        emit(L('for num in nums'), `num = ${num}.`);
        v.runningSum += num; v.need = v.runningSum - target;
        emit(L('running_sum += num'), `running_sum = ${v.runningSum}: the sum of everything up to here.`);
        const at = v.keys.indexOf(v.need);
        v.got = at >= 0 ? v.vals[at]! : 0; v.look = at; v.subarrayCount += v.got; v.gotText = `count.get(${v.need}, 0) = ${v.got}`;
        emit(L('subarray_count += count.get'), at >= 0
            ? `running_sum − target = ${v.need} was seen ${v.got} time${v.got === 1 ? '' : 's'}: that many subarrays ending here sum to ${target}. subarray_count = ${v.subarrayCount}.`
            : `running_sum − target = ${v.need} was never seen: no subarray ending here sums to ${target}.`);
        const own = v.keys.indexOf(v.runningSum);
        if (own >= 0) { v.vals = v.vals.map((c, j) => j === own ? c + 1 : c); v.look = own; }
        else { v.keys = [...v.keys, v.runningSum]; v.vals = [...v.vals, 1]; v.look = v.keys.length - 1; }
        emit(L('count[running_sum] ='), `count[${v.runningSum}] = ${v.vals[v.look]}: one more prefix with sum ${v.runningSum}.`);
    }
    v.i = -1; v.look = -1;
    emit(L('return subarray_count'), `${v.subarrayCount} subarrays sum to ${target}, found in one pass: O(n) time, O(n) space for the dict.`, 'Done');
    return trace;
}

export const TOPO_SOURCE = `from collections import deque

def find_order_dfs(n, prerequisites):
    graph = [[] for _ in range(n)]
    for course, pre in prerequisites:
        graph[pre].append(course)

    state = [0] * n  # 0 new, 1 on the path, 2 done
    order = []

    def dfs(node):
        if state[node] == 1:
            return False  # back on the path: a cycle
        if state[node] == 2:
            return True
        state[node] = 1
        for nxt in graph[node]:
            if not dfs(nxt):
                return False
        state[node] = 2
        order.append(node)
        return True

    for c in range(n):
        if not dfs(c):
            return []
    return order[::-1]

def find_order(n, prerequisites):
    graph = [[] for _ in range(n)]
    indegree = [0] * n
    for course, pre in prerequisites:
        graph[pre].append(course)
        indegree[course] += 1

    queue = deque(c for c in range(n) if indegree[c] == 0)
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for nxt in graph[node]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)

    return order if len(order) == n else []`;
/** The 1-based line of TOPO_SOURCE that contains `text` (first match after line `after`). */
export const topoLine = (text: string, after = 0) => TOPO_SOURCE.split('\n').findIndex((l, i) => i >= after && l.includes(text)) + 1;
/**
 * Kahn's topological sort. `graph` gives each node's out-neighbours in insertion order (the edges the view draws).
 * Per frame: indeg, the in-degree counts; queue and order; node, the node just taken (−1 none); nxt, the
 * neighbour being decremented (−1 none); from/to, the edge being counted or relaxed (−1 none); seen, per node how
 * many of its edges have been relaxed; state per node: 0 waiting, 1 queued, 2 taken (in order); result, the
 * returned order as text once done.
 */
export function topoTrace(n: number, prerequisites: [number, number][]) {
    // K(text): the in-degree function's line containing text.
    const K = (text: string) => topoLine(text, topoLine('def find_order(') - 1);
    const graph: number[][] = Array.from({ length: n }, () => []);
    for (const [course, pre] of prerequisites) graph[pre]!.push(course);
    const v = { indeg: new Array(n).fill(0) as number[], queue: [] as number[], order: [] as number[], node: -1, nxt: -1, from: -1, to: -1,
        seen: new Array(n).fill(0) as number[], state: new Array(n).fill(0) as number[], result: '' };
    const { trace, emit } = recorder(v);
    const list = (xs: number[]) => `[${xs.join(', ')}]`;
    emit(K('graph = [[] for _ in range(n)]'), `${n} courses, ${prerequisites.length} prerequisites. Each pair [course, pre] is an edge pre → course: take pre first.`);
    emit(K('indegree = [0] * n'), 'Every in-degree starts at 0.');
    for (const [course, pre] of prerequisites) {
        v.from = pre; v.to = course; v.nxt = course;
        emit(K('graph[pre].append(course)'), `Edge ${pre} → ${course}: ${course} needs ${pre} first.`);
        v.indeg[course]!++;
        emit(K('indegree[course] += 1'), `indegree[${course}] = ${v.indeg[course]}: ${course} waits on ${v.indeg[course]} course${v.indeg[course] === 1 ? '' : 's'}.`);
    }
    v.from = v.to = v.nxt = -1;
    for (let c = 0; c < n; c++) if (v.indeg[c] === 0) { v.queue.push(c); v.state[c] = 1; }
    emit(K('queue = deque'), `Start the queue with every course that needs nothing: ${list(v.queue)}.`);
    emit(K('order = []'), 'order starts empty.');
    while (v.queue.length) {
        v.node = -1; v.nxt = -1; v.from = v.to = -1;
        emit(K('while queue'), `The queue holds ${list(v.queue)}: keep going.`);
        const node = v.queue.shift()!; v.node = node; v.state[node] = 2;
        emit(K('node = queue.popleft()'), `Take ${node}: everything it needs is already in order.`);
        v.order.push(node);
        emit(K('order.append(node)'), `order = ${list(v.order)}.`);
        for (const nxt of graph[node]!) {
            v.nxt = nxt; v.from = node; v.to = nxt;
            emit(K('for nxt in graph[node]'), `Edge ${node} → ${nxt}: ${nxt} was waiting on ${node}.`);
            v.indeg[nxt]!--;
            emit(K('indegree[nxt] -= 1'), `indegree[${nxt}] = ${v.indeg[nxt]}: one fewer course to wait for.`);
            const free = v.indeg[nxt] === 0;
            emit(K('if indegree[nxt] == 0'), free ? `${nxt} waits on nothing now.` : `${nxt} still waits on ${v.indeg[nxt]}.`);
            if (free) { v.queue.push(nxt); v.state[nxt] = 1; emit(K('queue.append(nxt)'), `Queue ${nxt}: queue = ${list(v.queue)}.`); }
            v.seen[node]!++;
        }
    }
    v.node = v.nxt = v.from = v.to = -1;
    emit(K('while queue'), 'The queue is empty.');
    const ok = v.order.length === n;
    v.result = ok ? list(v.order) : '[]';
    emit(K('return order if len'), ok ? `All ${n} courses are in order: ${v.result}. Each node and edge is handled once: O(V + E).`
        : `Only ${v.order.length} of ${n} courses could be ordered: the rest wait on each other in a cycle, so return [].`, 'Done');
    return { trace, graph };
}

/**
 * Topological sort by DFS, with no in-degrees: a course is appended once everything that depends on it is done
 * (post-order), so the reversed list puts every prerequisite first. state per node: 0 new, 1 on the current path,
 * 2 done; meeting a course that is on the path is a cycle. Per frame: state, order (post-order), node and nxt
 * (−1 none), from/to (the edge being followed), seen (per node, edges followed), c (the outer loop's course),
 * calls (call-site lines of the dfs calls not yet returned), result (the answer once done, '—' before).
 */
export function topoDfsTrace(n: number, prerequisites: [number, number][]) {
    // L(text): the DFS function's line containing text; L(text, line): the first such line after `line`.
    const def = topoLine('def find_order_dfs'), L = (text: string, after = def - 1) => topoLine(text, after);
    const graph: number[][] = Array.from({ length: n }, () => []);
    for (const [course, pre] of prerequisites) graph[pre]!.push(course);
    const v = { state: new Array(n).fill(0) as number[], order: [] as number[], node: -1, nxt: -1, from: -1, to: -1,
        seen: new Array(n).fill(0) as number[], c: -1, calls: [] as number[], result: '—' };
    const { trace, emit } = recorder(v);
    const list = (xs: number[]) => `[${xs.join(', ')}]`;
    const stack: number[] = [];   // the nodes of the dfs calls not yet returned, outermost first
    const where = () => { v.node = stack.at(-1) ?? -1; };
    emit(L('graph[pre].append'), `Build the graph: ${prerequisites.length} edges pre → course. No in-degrees this time.`);
    emit(L('state = [0] * n'), 'Every course starts new (state 0).');
    emit(L('order = []'), 'order will collect courses after everything that depends on them is done.');
    let cycle = false;
    const dfs = (node: number, site: number): boolean => {
        stack.push(node); v.calls.push(site); where(); v.nxt = -1; v.from = v.to = -1;
        if (v.state[node] === 1) { emit(L('return False  # back'), `${node} is already on the path: a cycle.`); stack.pop(); v.calls.pop(); where(); return false; }
        if (v.state[node] === 2) { emit(L('return True', L('if state[node] == 2') - 1), `${node} is already done: nothing to do.`); stack.pop(); v.calls.pop(); where(); return true; }
        v.state[node] = 1;
        emit(L('state[node] = 1'), `Visit ${node}: it is on the path now.`);
        for (const nxt of graph[node]!) {
            v.nxt = nxt; v.from = node; v.to = nxt;
            emit(L('for nxt in graph[node]'), `Edge ${node} → ${nxt}: ${nxt} depends on ${node}, so finish ${nxt} first.`);
            const ok = dfs(nxt, L('if not dfs(nxt)'));
            v.seen[node]!++; where(); v.nxt = nxt; v.from = node; v.to = nxt;
            if (!ok) { emit(L('return False', L('if not dfs(nxt)')), `A cycle below ${node}: give up.`); stack.pop(); v.calls.pop(); where(); return false; }
        }
        v.nxt = -1; v.from = v.to = -1;
        v.state[node] = 2;
        emit(L('state[node] = 2'), `Everything that depends on ${node} is done.`);
        v.order.push(node);
        emit(L('order.append(node)'), `Append ${node}: order = ${list(v.order)}.`);
        emit(L('return True', L('order.append(node)')), `dfs(${node}) returns.`);
        stack.pop(); v.calls.pop(); where();
        return true;
    };
    for (let c = 0; c < n && !cycle; c++) {
        v.c = c; v.node = -1;
        emit(L('for c in range(n)'), v.state[c] === 2 ? `Course ${c} is already done.` : `Start a search from course ${c}.`);
        if (!dfs(c, L('if not dfs(c)'))) { cycle = true; v.result = '[]'; emit(L('return []'), 'A cycle: no order exists.', 'Done'); }
    }
    if (!cycle) {
        v.c = -1; v.result = list([...v.order].reverse());
        emit(L('return order[::-1]'), `Reverse the post-order: ${v.result}. Each course follows all its prerequisites. O(V + E).`, 'Done');
    }
    return { trace, graph };
}

export const TREE_TRAVERSAL_SOURCE = `from collections import deque

def preorder(node, out):
    if node is None:
        return
    out.append(node.val)
    preorder(node.left, out)
    preorder(node.right, out)

def inorder(node, out):
    if node is None:
        return
    inorder(node.left, out)
    out.append(node.val)
    inorder(node.right, out)

def postorder(node, out):
    if node is None:
        return
    postorder(node.left, out)
    postorder(node.right, out)
    out.append(node.val)

def level_order(root):
    out, queue = [], deque([root])
    while queue:
        node = queue.popleft()
        out.append(node.val)
        for child in (node.left, node.right):
            if child:
                queue.append(child)
    return out`;
export type TreeOrder = 'preorder' | 'inorder' | 'postorder' | 'level';
/**
 * One traversal of a binary tree (node i: values[i], parent parents[i], side sides[i]). Per frame: cur, the
 * node the code is at (−1 none); stack, the recursion's nodes from the root call down (DFS) or queue, the nodes
 * waiting (BFS), both as node indexes; waiting, 0/1 per node on either; visited, 0/1 per node; out, the values
 * appended so far.
 */
export function treeTraversalTrace(order: TreeOrder, values: number[], parents: number[], sides: number[]) {
    const n = values.length;
    const child = (i: number, side: number) => parents.findIndex((p, c) => p === i && sides[c] === side);
    const visited = Array<number>(n).fill(0), out: number[] = [], stack: number[] = [], queue: number[] = [];
    const v = { cur: -1, stack: [] as number[], queue: [] as number[], waiting: Array<number>(n).fill(0), visited: visited.slice(), out: [] as number[] };
    const { trace, emit } = recorder(v);
    const sync = () => {
        v.stack = stack.slice(); v.queue = queue.slice(); v.visited = visited.slice(); v.out = out.slice();
        v.waiting = Array.from({ length: n }, (_, i) => stack.includes(i) || queue.includes(i) ? 1 : 0);
    };
    const root = parents.indexOf(-1);
    const L = { preorder: { check: 4, visit: 6, left: 7, right: 8 }, inorder: { check: 11, visit: 14, left: 13, right: 15 },
        postorder: { check: 18, visit: 22, left: 20, right: 21 } } as const;
    const visit = (i: number, line: number, why: string) => { visited[i] = 1; out.push(values[i]!); sync(); emit(line, `Visit ${values[i]}${why}: out = [${out.join(', ')}].`); };
    if (order === 'level') {
        queue.push(root); sync();
        emit(25, `Start the queue with the root, ${values[root]}.`);
        while (queue.length) {
            emit(26, `The queue holds ${queue.map(i => values[i]).join(', ')}: keep going.`);
            const i = queue.shift()!; v.cur = i; sync();
            emit(27, `Take ${values[i]} from the front: the oldest node waiting, so levels come out in order.`);
            visit(i, 28, '');
            for (const side of [0, 1]) {
                const c = child(i, side);
                if (c < 0) continue;
                queue.push(c); sync();
                emit(31, `Queue its ${side ? 'right' : 'left'} child, ${values[c]}, behind the nodes already waiting.`);
            }
        }
        v.cur = -1; sync();
        emit(32, `Done: [${out.join(', ')}], level by level. Each node is queued and visited once: O(n).`, 'Done');
        return trace;
    }
    const lines = L[order];
    const walk = (i: number) => {
        stack.push(i); v.cur = i; sync();
        emit(lines.check, `${order}(${values[i]}): not None, so ${order === 'preorder' ? 'visit it, then go left, then right' : order === 'inorder' ? 'go left first' : 'go left, then right, and visit it last'}.`);
        if (order === 'preorder') visit(i, lines.visit, ', on the way down');
        const left = child(i, 0);
        if (left >= 0) { v.cur = i; sync(); emit(lines.left, `Go left to ${values[left]}.`); walk(left); }
        v.cur = i; sync();
        if (order === 'inorder') visit(i, lines.visit, ', after everything on its left');
        const right = child(i, 1);
        if (right >= 0) { v.cur = i; sync(); emit(lines.right, `Go right to ${values[right]}.`); walk(right); }
        v.cur = i; sync();
        if (order === 'postorder') visit(i, lines.visit, ', after both children');
        stack.pop(); v.cur = stack.at(-1) ?? -1; sync();
    };
    walk(root);
    emit(lines.check, `Done: [${out.join(', ')}]. Each node is entered once: O(n) time, O(height) stack.`, 'Done');
    return trace;
}

export const ISLANDS_SOURCE = `def num_islands(grid):
    rows, cols = len(grid), len(grid[0])
    count = 0

    def dfs(r, c):
        if r < 0 or r >= rows or c < 0 or c >= cols:
            return
        if grid[r][c] != "1":
            return
        grid[r][c] = "0"
        dfs(r + 1, c)
        dfs(r - 1, c)
        dfs(r, c + 1)
        dfs(r, c - 1)

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == "1":
                count += 1
                dfs(r, c)
    return count`;
/**
 * Number of islands by flood fill: scan every cell; a "1" starts a new island, and dfs() visits it and every
 * land cell joined to it, recursing down, up, right, left, and marks each visited by overwriting it with "0". Cells are row-major indexes. Per
 * frame: grid (1/0 per cell, as the code holds it), island (which island sank each cell, 0 none), from (the
 * cell whose dfs() reached it, −1 none), stack (cells whose dfs() is running, 0/1 per cell), cur (the cell
 * dfs() is at, −1 none), scan (the outer loop's cell), r and c (the cell the code looks at), count.
 */
export function islandsTrace(input: number[][]) {
    const rows = input.length, cols = input[0]!.length, n = rows * cols;
    const grid = input.flat(), island = Array<number>(n).fill(0), from = Array<number>(n).fill(-1), stack: number[] = [];
    const v = { grid: grid.slice(), island: island.slice(), from: from.slice(), stack: Array<number>(n).fill(0), cur: -1, scan: -1, r: -1, c: -1, count: 0 };
    const { trace, emit } = recorder(v);
    const sync = () => { v.grid = grid.slice(); v.island = island.slice(); v.from = from.slice(); v.stack = Array.from({ length: n }, (_, i) => stack.includes(i) ? 1 : 0); };
    const at = (r: number, c: number) => r * cols + c;
    emit(2, `A ${rows} × ${cols} grid: 1 is land, 0 is water. Islands are land joined up, down, left or right.`);
    emit(3, 'count = 0.');
    const dfs = (r: number, c: number, parent: number) => {
        const i = at(r, c);
        stack.push(i); from[i] = parent; island[i] = v.count; grid[i] = 0;
        v.cur = i; v.r = r; v.c = c; sync();
        emit(9, `dfs(${r}, ${c}): land, so mark it visited by overwriting it with "0": it is now part of island ${v.count} and will not be counted again.`);
        for (const [dr, dc, line] of [[1, 0, 10], [-1, 0, 11], [0, 1, 12], [0, -1, 13]] as const) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[at(nr, nc)] !== 1) continue;
            v.cur = i; v.r = r; v.c = c; sync();
            emit(line, `(${nr}, ${nc}) next to it is land too: visit it.`);
            dfs(nr, nc, i);
        }
        stack.pop(); v.cur = stack.at(-1) ?? -1; sync();
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = at(r, c);
        v.scan = i; v.r = r; v.c = c; v.cur = -1; sync();
        if (grid[i] !== 1) { emit(16, `grid[${r}][${c}] is "0": ${island[i] ? `already visited with island ${island[i]}` : 'water'}, skip.`); continue; }
        v.count++;
        emit(17, `grid[${r}][${c}] is "1": land nothing has reached yet, a new island. count = ${v.count}.`);
        emit(18, `Visit the whole island with a depth-first search from (${r}, ${c}).`);
        dfs(r, c, -1);
    }
    v.scan = -1; v.cur = -1; v.r = v.c = -1; sync();
    emit(19, `Done: ${v.count} islands. Each cell is scanned once and visited at most once: O(rows × cols).`, 'Done');
    return trace;
}

export const RECURSION_SOURCE = `def power(x, n):
    if n == 0:
        return 1
    half = power(x, n // 2)
    if n % 2 == 0:
        return half * half
    return half * half * x

def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)`;
/**
 * A recursion as its call tree: calls are numbered as they are made (0 the first), and `parents` gives each
 * call's caller, so a view can lay the tree out and show the calls made so far. Per frame: count, calls made;
 * cur, the call the code is in (−1 none); stack and done, 0/1 per call (waiting on a recursive call, returned);
 * text, each call as written, with its result once it returns; result, the value just returned (−1 none);
 * calls, the call-site lines of the calls still waiting, outermost first;
 * n, the argument of the call the code is in (−1 outside any call); half, that call's half (fast power: the
 * smaller copy's answer, −1 until it returns).
 */
function callTree() {
    const parents: number[] = [], text: string[] = [], stack: number[] = [], done: number[] = [], ns: number[] = [], halves: number[] = [], sites: number[] = [];
    const v = { count: 0, cur: -1, stack: [] as number[], done: [] as number[], text: [] as string[], result: -1, n: -1, half: -1, calls: [] as number[] };
    const { trace, emit } = recorder(v);
    const sync = () => { v.count = parents.length; v.text = text.slice(); v.done = done.slice(); v.stack = parents.map((_, i) => stack.includes(i) ? 1 : 0); v.calls = stack.map(i => sites[i]!).filter(l => l > 0); };
    // site: the source line that made the call (−1 for the first call, made from outside the code shown).
    const enter = (label: string, parent: number, n: number, site = -1) => {
        const id = parents.length; parents.push(parent); text.push(label); done.push(0); ns.push(n); halves.push(-1); sites.push(site);
        stack.push(id); v.cur = id; v.n = n; v.half = -1; sync(); return id;
    };
    const leave = (id: number, value: number) => {
        text[id] = `${text[id]} = ${value}`; done[id] = 1; stack.pop(); v.result = value; sync();
    };
    const back = (id: number) => { v.cur = id; v.n = id >= 0 ? ns[id]! : -1; v.half = id >= 0 ? halves[id]! : -1; v.result = -1; sync(); };
    const setHalf = (id: number, value: number) => { halves[id] = value; v.half = value; };
    return { trace, emit, parents, enter, leave, back, setHalf };
}

/** Fast power: power(x, n) solves one smaller copy, power(x, n // 2), so the calls form a chain about log n long. */
export function powerTrace(x: number, n: number) {
    const t = callTree();
    const call = (k: number, parent: number): number => {
        const id = t.enter(`power(${x}, ${k})`, parent, k, parent < 0 ? -1 : 4);
        t.emit(2, `power(${x}, ${k}): is n 0?`);
        if (k === 0) { t.leave(id, 1); t.emit(3, `Base case: ${x}⁰ = 1, no smaller copy needed.`); return 1; }
        t.emit(4, `Trust the smaller copy: power(${x}, ${k} // 2 = ${Math.floor(k / 2)}) gives half the answer.`);
        const half = call(Math.floor(k / 2), id);
        t.back(id); t.setHalf(id, half);
        const even = k % 2 === 0, value = even ? half * half : half * half * x;
        t.emit(5, `Back in power(${x}, ${k}) with half = ${half}. Is ${k} even? ${even ? 'Yes' : 'No'}.`);
        t.leave(id, value);
        t.emit(even ? 6 : 7, even ? `${half} × ${half} = ${value}.` : `${k} is odd: ${half} × ${half} × ${x} = ${value}.`);
        return value;
    };
    const value = call(n, -1);
    t.back(-1);
    t.emit(7, `power(${x}, ${n}) = ${value}, from ${t.parents.length} calls: each halves n, so O(log n) multiplications instead of ${n}.`, 'Done');
    return { trace: t.trace, parents: t.parents };
}

/** Fibonacci, naively: fib(n) solves two smaller copies, so the calls branch and the same fib(k) is solved again. */
export function fibTrace(n: number) {
    const t = callTree();
    const call = (k: number, parent: number): number => {
        const id = t.enter(`fib(${k})`, parent, k, parent < 0 ? -1 : 12);
        t.emit(10, `fib(${k}): is n below 2?`);
        if (k < 2) { t.leave(id, k); t.emit(11, `Base case: fib(${k}) = ${k}.`); return k; }
        t.emit(12, `fib(${k}) needs two smaller copies: fib(${k - 1}) first.`);
        const a = call(k - 1, id);
        t.back(id);
        t.emit(12, `fib(${k - 1}) = ${a}. Now fib(${k - 2}).`);
        const b = call(k - 2, id);
        t.back(id);
        t.leave(id, a + b);
        t.emit(12, `fib(${k}) = ${a} + ${b} = ${a + b}.`);
        return a + b;
    };
    const value = call(n, -1);
    t.back(-1);
    t.emit(12, `fib(${n}) = ${value}, from ${t.parents.length} calls: the same smaller copies are solved more than once, and the count grows exponentially. Remembering answers (memoization) turns this into dynamic programming.`, 'Done');
    return { trace: t.trace, parents: t.parents };
}

export const SUBSETS_SOURCE = `def subsets(nums):
    out, path = [], []

    def backtrack(start):
        out.append(path[:])
        for i in range(start, len(nums)):
            path.append(nums[i])
            backtrack(i + 1)
            path.pop()

    backtrack(0)
    return out`;
/**
 * Subsets by backtracking: each backtrack(start) call records the current path, then for each later index
 * chooses nums[i] (append), explores (recurse) and un-chooses it (pop). Calls are numbered as made; parents gives
 * each call's caller. Per frame: count, calls made; cur, the call the code is in; stack and done, 0/1 per call;
 * text, each call's recorded path; calls, the call-site lines of the calls not yet returned (11 for the first, 8 for
 * recursive ones); path and pathText, the path now (as numbers, and as written); start and i, the call's start and loop index (−1 none);
 * out, how many subsets are recorded; outText, those subsets in order.
 */
export function subsetsTrace(nums: number[]) {
    const parents: number[] = [], text: string[] = [], done: number[] = [], stack: number[] = [], path: number[] = [];
    const starts: number[] = [];
    const v = { count: 0, cur: -1, stack: [] as number[], done: [] as number[], text: [] as string[], path: [] as number[], start: -1, i: -1, out: 0, outText: [] as string[], pathText: '[]', calls: [] as number[] };
    const { trace, emit } = recorder(v);
    const show = (p: number[]) => `[${p.join(', ')}]`;
    const sync = () => { v.count = parents.length; v.text = text.slice(); v.done = done.slice(); v.path = path.slice(); v.pathText = show(path); v.calls = stack.map(k => parents[k]! < 0 ? 11 : 8); v.stack = parents.map((_, k) => stack.includes(k) ? 1 : 0); };
    emit(2, `Start with no subsets and an empty path. nums = ${show(nums)}.`);
    const backtrack = (start: number, parent: number) => {
        const id = parents.length; parents.push(parent); text.push(show(path)); done.push(0); starts.push(start);
        stack.push(id); v.cur = id; v.start = start; v.i = -1; sync();
        emit(5, `backtrack(${start}): record the path ${show(path)} as a subset.`);
        v.out++; v.outText = [...v.outText, show(path)]; done[id] = 1; sync();
        emit(5, `out has ${v.out} subset${v.out === 1 ? '' : 's'}.`);
        for (let i = start; i < nums.length; i++) {
            v.cur = id; v.start = start; v.i = i; sync();
            emit(6, `Try index ${i}: nums[${i}] = ${nums[i]}.`);
            path.push(nums[i]!); sync();
            emit(7, `Choose ${nums[i]}: path = ${show(path)}.`);
            emit(8, `Explore: subsets that start with ${show(path)}, using only later numbers (start = ${i + 1}).`);
            backtrack(i + 1, id);
            v.cur = id; v.start = start; v.i = i; path.pop(); sync();
            emit(9, `Un-choose ${nums[i]}: path = ${show(path)}, ready to try the next number in its place.`);
        }
        stack.pop(); v.cur = stack.at(-1) ?? -1; v.start = v.cur >= 0 ? starts[v.cur]! : -1; v.i = -1; sync();
    };
    backtrack(0, -1);
    emit(12, `Done: ${v.out} subsets, one per call: every subset of ${nums.length} numbers (2^${nums.length} = ${2 ** nums.length}).`, 'Done');
    return { trace, parents };
}

export const MONOTONIC_QUEUE_SOURCE = `from collections import deque

def max_sliding_window(nums, k):
    dq, out = deque(), []
    for i, x in enumerate(nums):
        while dq and nums[dq[-1]] <= x:
            dq.pop()
        dq.append(i)
        if dq[0] <= i - k:
            dq.popleft()
        if i >= k - 1:
            out.append(nums[dq[0]])
    return out`;
export function monotonicQueueTrace(nums: number[], k: number) {
    // cond_<w|e|f>: each condition's last evaluation as text (while on line 6, expiry if on line 9, full-window
    // if on line 11). back is the deque index line 6 reads (nums[dq[-1]]), -1 when the deque is empty or elsewhere.
    const v = { i: -1, x: 0, left: -1, dq: [] as number[], out: [] as number[], popped: -1, back: -1, tip_x: '',
        cond_w: 'while dq and nums[dq[-1]] ≤ x → —', cond_e: 'if dq[0] ≤ i - k → —', cond_f: 'if i ≥ k - 1 → —' };
    const { trace, emit } = recorder(v);
    const bool = (ok: boolean) => ok ? 'True' : 'False';
    emit(4, 'The deque holds indices whose values decrease from front to back. The front is always the window maximum.');
    nums.forEach((x, i) => {
        v.i = i; v.x = x; v.left = Math.max(0, i - k + 1); v.popped = -1; v.tip_x = `x = ${at('nums', i)} = ${x}`;
        emit(5, `Index ${i}: ${x} enters the window nums[${v.left}..${i}].`);
        while (true) {
            const back = v.dq.at(-1);
            if (back === undefined) {
                v.back = -1; v.cond_w = 'while dq and nums[dq[-1]] ≤ x → dq = [] → False';
                emit(6, 'The deque is empty.'); break;
            }
            const smaller = nums[back]! <= x;
            v.back = back; v.cond_w = `while dq and nums[dq[-1]] ≤ x → ${nums[back]} ≤ ${x} → ${bool(smaller)}`;
            emit(6, `Is nums[${back}] = ${nums[back]} ≤ ${x}? ${smaller ? 'Yes: it can never be a maximum again.' : 'No: keep it.'}`);
            v.back = -1;
            if (!smaller) break;
            v.popped = v.dq.pop()!;
            emit(7, `Drop index ${v.popped} from the back.`);
        }
        v.back = -1; v.popped = -1; v.dq.push(i);
        emit(8, `Append index ${i} at the back.`);
        const expired = v.dq[0]! <= i - k;
        v.cond_e = `if dq[0] ≤ i - k → ${v.dq[0]} ≤ ${i - k} → ${bool(expired)}`;
        emit(9, expired ? `Front index ${v.dq[0]} has left the window.` : `Front index ${v.dq[0]} is still inside the window.`);
        if (expired) { v.popped = v.dq.shift()!; emit(10, `Drop index ${v.popped} from the front.`); v.popped = -1; }
        const full = i >= k - 1;
        v.cond_f = `if i ≥ k - 1 → ${i} ≥ ${k - 1} → ${bool(full)}`;
        emit(11, full ? `The window nums[${v.left}..${i}] is full.` : `The first window is not full yet (${i + 1} of ${k}).`);
        if (full) {
            v.out.push(nums[v.dq[0]!]!);
            emit(12, `Its maximum is nums[${v.dq[0]}] = ${nums[v.dq[0]!]}.`);
        }
    });
    v.i = -1; v.left = -1; v.tip_x = '';
    emit(13, 'Each index entered and left the deque at most once: O(n) for all windows.', 'Done');
    // The front index, for bindings that cannot index an empty deque.
    return trace.map(f => ({ ...f, front: (f.dq as number[])[0] ?? -1 }));
}

export const GREEDY_SOURCE = `def can_jump(nums):
    reach = 0
    for i, jump in enumerate(nums):
        if i > reach:
            return False
        reach = max(reach, i + jump)
    return True`;
export function greedyTrace(nums: number[]) {
    const v = { i: -1, jump: 0, reach: 0, ok: -1, tip_reach: `${tt('reach')} = 0` };
    const { trace, emit } = recorder(v);
    emit(2, 'reach is the farthest index we know we can get to. At first, only index 0.');
    for (let i = 0; i < nums.length; i++) {
        v.i = i; v.jump = nums[i]!;
        emit(3, `Stand on index ${i}; it allows a jump of up to ${v.jump}.`);
        emit(4, `Is index ${i} beyond reach = ${v.reach}?`);
        if (i > v.reach) { v.ok = 0; emit(5, `Yes: index ${i} cannot be reached, so neither can the end.`, 'Done'); return trace; }
        const old = v.reach; v.reach = Math.max(v.reach, i + v.jump);
        v.tip_reach = String.raw`${tt('reach')} = \max(${tt('reach')}, i + ${tt('jump')}) = \max(${old}, ${i} + ${v.jump}) = ${v.reach}`;
        emit(6, v.reach > old ? `From here we reach ${i} + ${v.jump} = ${i + v.jump}: reach grows to ${v.reach}.` : `${i} + ${v.jump} = ${i + v.jump} does not beat reach = ${v.reach}.`);
    }
    v.ok = 1;
    emit(7, 'Every index was within reach, including the last.', 'Done');
    return trace;
}

export const BITS_SOURCE = `def single_number(nums):
    result = 0
    for x in nums:
        result ^= x
    return result`;
const bitsOf = (n: number, width: number) => Array.from({ length: width }, (_, b) => (n >> (width - 1 - b)) & 1);
export function bitsTrace(nums: number[], width = 3) {
    // bBits: result before the latest XOR, shown above x so the flip reads like a worked sum; equal to rBits except on line 4.
    const v = { k: -1, x: 0, result: 0, xBits: bitsOf(0, width), bBits: bitsOf(0, width), rBits: bitsOf(0, width), tip_x: '', tip_result: `${tt('result')} = 0` };
    const { trace, emit } = recorder(v);
    emit(2, 'result starts at 0. XOR rules: a ^ a = 0 and a ^ 0 = a, in any order.');
    nums.forEach((x, k) => {
        v.k = k; v.x = x; v.xBits = bitsOf(x, width); v.bBits = v.rBits.slice();
        v.tip_x = String.raw`x = ${at('nums', k)} = ${x} = ${v.xBits.join('')}_2`;
        emit(3, `Take nums[${k}] = ${x}, binary ${v.xBits.join('')}.`);
        const old = v.result; v.result ^= x; v.rBits = bitsOf(v.result, width);
        v.tip_result = String.raw`${tt('result')} = ${old} \oplus ${x} = ${v.result} \quad (${bitsOf(old, width).join('')} \oplus ${v.xBits.join('')} = ${v.rBits.join('')})`;
        emit(4, `${old} ^ ${x} = ${v.result}: each bit flips where x has a 1.`);
    });
    v.k = -1; v.tip_x = ''; v.bBits = v.rBits.slice();
    emit(5, `Every value that appears twice cancelled itself out. ${v.result} is left: the single number. O(n) time, O(1) space.`, 'Done');
    return trace;
}

export const UNION_FIND_SOURCE = `def count_components(n, edges):
    parent = list(range(n))
    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
            n -= 1
    return n`;
export function unionFindTrace(n: number, edges: [number, number][]) {
    const v = { e: -1, a: -1, b: -1, x: -1, ra: -1, rb: -1, parent: Array.from({ length: n }, (_, i) => i), count: n,
        tip_count: `n = ${n}`, tip_edge: '' };
    const { trace, emit } = recorder(v);
    emit(2, `Each of the ${n} nodes starts as its own root: ${n} components.`);
    const find = (start: number) => {
        v.x = start;
        while (true) {
            const p = v.parent[v.x]!;
            emit(4, p === v.x ? `parent[${v.x}] = ${v.x}: ${v.x} is a root.` : `parent[${v.x}] = ${p}: not a root, keep climbing.`);
            if (p === v.x) break;
            v.x = p;
            emit(5, `Climb to ${v.x}.`);
        }
        emit(6, `find(${start}) = ${v.x}.`);
        const root = v.x; v.x = -1; return root;
    };
    edges.forEach(([a, b], e) => {
        v.e = e; v.a = a; v.b = b; v.ra = v.rb = -1; v.tip_edge = String.raw`a, b = ${at('edges', e)} = (${a}, ${b})`;
        emit(7, `Edge ${a}–${b}.`);
        v.ra = find(a); v.rb = find(b);
        emit(8, `ra = ${v.ra}, rb = ${v.rb}.`);
        emit(9, v.ra !== v.rb ? 'Different roots: two separate components meet.' : 'Same root: already connected, so this edge changes nothing.');
        if (v.ra !== v.rb) {
            v.parent[v.rb] = v.ra;
            emit(10, `Attach root ${v.rb} under ${v.ra}: parent[${v.rb}] = ${v.ra}.`);
            v.count--; v.tip_count = `n = ${v.count + 1} - 1 = ${v.count}`;
            emit(11, `${v.count} components remain.`);
        }
    });
    v.e = v.a = v.b = v.ra = v.rb = -1; v.tip_edge = '';
    emit(12, `${v.count} connected components. With path compression and union by rank, each find is nearly O(1).`, 'Done');
    return trace;
}

export const KMP_SOURCE = `def build_lps(p):
    lps, k = [0] * len(p), 0
    for i in range(1, len(p)):
        while k and p[i] != p[k]:
            k = lps[k - 1]
        if p[i] == p[k]:
            k += 1
        lps[i] = k
    return lps

def kmp_search(text, p):
    lps, k, hits = build_lps(p), 0, []
    for i, ch in enumerate(text):
        while k and ch != p[k]:
            k = lps[k - 1]
        if ch == p[k]:
            k += 1
        if k == len(p):
            hits.append(i - k + 1)
            k = lps[k - 1]
    return hits`;
export function kmpTrace(text: string, p: string) {
    // Each while/if condition is a row: cond_<id> holds its last evaluation as text ("while k and p[i] ≠ p[k] →
    // 1 and b ≠ a → True") and stays until evaluated again. Every evaluation is its own step, false ones too.
    // cmpT/cmpA/cmpB name the cells the current evaluation compares (text index, left pattern index, k), else -1.
    const v = { phase: 1, i: -1, k: 0, pi: -1, lps: [...p].map(() => 0), hits: [] as number[], lo: -1, hi: -1, tip_k: 'k = 0',
        cmpT: -1, cmpA: -1, cmpB: -1,
        cond_bw: 'while k and p[i] ≠ p[k] → —', cond_bi: 'if p[i] = p[k] → —',
        cond_sw: 'while k and text[i] ≠ p[k] → —', cond_si: 'if text[i] = p[k] → —', cond_sm: 'if k = len(p) → —' };
    const { trace, emit } = recorder(v);
    const T = [...text], P = [...p];
    const bool = (ok: boolean) => ok ? 'True' : 'False';
    const cells = (t: number, a: number, b: number) => { v.cmpT = t; v.cmpA = a; v.cmpB = b; };
    // lo..hi is the stretch of text currently matched by p[0..k-1].
    const span = (end: number) => { v.lo = v.k ? end - v.k + 1 : -1; v.hi = v.k ? end : -1; };
    /** `while k and left != p[k]`: short-circuits when k = 0, so p[k] is not read then. */
    const fallback = (row: 'bw' | 'sw', left: string, char: string, t: number, a: number) => {
        const head = row === 'bw' ? 'while k and p[i] ≠ p[k]' : 'while k and text[i] ≠ p[k]';
        if (!v.k) { v[`cond_${row}`] = `${head} → k = 0 → False`; cells(-1, -1, -1); return false; }
        const ok = char !== P[v.k];
        v[`cond_${row}`] = `${head} → ${v.k} and ${char} ≠ ${P[v.k]} → ${bool(ok)}`; cells(t, a, v.k);
        return ok;
    };
    emit(2, 'Phase 1: lps[i] = length of the longest proper prefix of p that is also a suffix of p[0..i].');
    for (let i = 1; i < P.length; i++) {
        v.i = -1; v.pi = i; cells(-1, -1, -1);
        emit(3, `Extend to p[${i}] = ${P[i]}.`);
        while (true) {
            const go = fallback('bw', 'p[i]', P[i]!, -1, i);
            emit(4, go ? `p[${i}] = ${P[i]} ≠ p[${v.k}] = ${P[v.k]}: fall back.` : v.k ? `p[${i}] = ${P[i]} matches p[${v.k}], so stop falling back.` : 'k = 0, so there is nothing to fall back to.');
            if (!go) break;
            cells(-1, -1, -1);
            const from = v.k; v.k = v.lps[v.k - 1]!; v.tip_k = `k = ${at('lps', 'k - 1')} = ${at('lps', from - 1)} = ${v.k}`;
            emit(5, `k = lps[k − 1] = ${v.k}.`);
        }
        const eq = P[i] === P[v.k];
        v.cond_bi = `if p[i] = p[k] → ${P[i]} = ${P[v.k]} → ${bool(eq)}`; cells(-1, i, v.k);
        emit(6, `Does p[${i}] = ${P[i]} match p[${v.k}] = ${P[v.k]}? ${eq ? 'Yes.' : 'No.'}`);
        cells(-1, -1, -1);
        if (eq) { v.k++; v.tip_k = `k = ${v.k - 1} + 1 = ${v.k}`; emit(7, `k = ${v.k}.`); }
        v.lps[i] = v.k;
        emit(8, `lps[${i}] = ${v.k}.`);
    }
    v.pi = -1; v.k = 0; v.phase = 2; v.tip_k = String.raw`k = 0 \quad \text{(search starts)}`;
    emit(12, 'Phase 2: scan the text once. k counts how much of p matches so far.');
    T.forEach((ch, i) => {
        v.i = i; span(i - 1); cells(-1, -1, -1);
        emit(13, `Read text[${i}] = ${ch}.`);
        while (true) {
            const go = fallback('sw', 'text[i]', ch, i, -1);
            emit(14, go ? `${ch} ≠ p[${v.k}] = ${P[v.k]}: keep the longest border instead of restarting.` : v.k ? `${ch} matches p[${v.k}], so keep k.` : 'k = 0: nothing matched yet, so nothing to fall back to.');
            if (!go) break;
            cells(-1, -1, -1);
            const from = v.k; v.k = v.lps[v.k - 1]!; span(i - 1); v.tip_k = `k = ${at('lps', 'k - 1')} = ${at('lps', from - 1)} = ${v.k}`;
            emit(15, `k = lps[k − 1] = ${v.k}. The text pointer never moves back.`);
        }
        const eq = ch === P[v.k];
        v.cond_si = `if text[i] = p[k] → ${ch} = ${P[v.k]} → ${bool(eq)}`; cells(i, -1, v.k);
        emit(16, `Does ${ch} match p[${v.k}] = ${P[v.k]}? ${eq ? 'Yes.' : 'No.'}`);
        cells(-1, -1, -1);
        if (eq) { v.k++; span(i); v.tip_k = `k = ${v.k - 1} + 1 = ${v.k}`; emit(17, `k = ${v.k}.`); }
        const full = v.k === P.length;
        v.cond_sm = `if k = len(p) → ${v.k} = ${P.length} → ${bool(full)}`;
        emit(18, full ? 'All of p matched.' : `${v.k} of ${P.length} characters matched so far.`);
        if (full) {
            v.hits.push(i - v.k + 1);
            emit(19, `Match at index ${i - v.k + 1}.`);
            const from = v.k; v.k = v.lps[v.k - 1]!; span(i); v.tip_k = `k = ${at('lps', 'k - 1')} = ${at('lps', from - 1)} = ${v.k}`;
            emit(20, `k = lps[k − 1] = ${v.k}, so overlapping matches are still found.`);
        }
    });
    v.i = -1; v.lo = v.hi = -1;
    emit(21, `Matches at ${v.hits.join(', ') || 'none'}. O(n + m): the text pointer only moves forward.`, 'Done');
    return trace;
}
