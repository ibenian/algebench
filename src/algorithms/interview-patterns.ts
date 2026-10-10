/** Display-only Python sources and complete, immutable execution snapshots for the interview-patterns draft. */
export type Cell = number | string;
export type Value = number | string | Cell[];
/** One execution snapshot: every key is present in every frame of a trace, so bindings never miss a column. */
export type Frame = Record<string, Value> & { line: number; message: string; status: 'Running' | 'Done'; running: number };

/** Records full copies of `vars` (arrays sliced) with the active one-based source line. */
function recorder<V extends Record<string, Value>>(vars: V) {
    const trace: (V & Frame)[] = [];
    const emit = (line: number, message: string, status: Frame['status'] = 'Running') => {
        const copy = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : v]));
        trace.push({ ...copy, line, message, status, running: status === 'Running' ? 1 : 0 } as V & Frame);
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
    slow = fast = nums[0]
    while True:
        slow = nums[slow]
        fast = nums[nums[fast]]
        if slow == fast:
            break
    slow = nums[0]
    while slow != fast:
        slow = nums[slow]
        fast = nums[fast]
    return slow`;
export function fastSlowTrace(nums: number[]) {
    const v = { slow: nums[0]!, fast: nums[0]!, phase: 1, hop: -1, tip_slow: `${tt('slow')} = ${at('nums', 0)} = ${nums[0]}`, tip_fast: `${tt('fast')} = ${at('nums', 0)} = ${nums[0]}` };
    const { trace, emit } = recorder(v);
    emit(2, `Both pointers start at nums[0] = ${v.slow}. Read each value as a pointer to the index it names.`);
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
    v.phase = 2; v.slow = nums[0]!; v.tip_slow = `${tt('slow')} = ${at('nums', 0)} = ${v.slow}`;
    emit(8, `Phase 2: restart slow at nums[0] = ${v.slow}; fast stays put. Both now move one hop at a time.`);
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
        tip_lo: `${tt('lo')} = 0`, tip_hi: String.raw`${tt('hi')} = \text{len}(${tt('nums')}) - 1 = ${nums.length - 1}`, tip_mid: '', tip_half: '' };
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
        emit(5, `Is nums[${v.mid}] = ${m} the target ${target}?`);
        if (m === target) { v.found = v.mid; emit(6, `Found ${target} at index ${v.mid}.`, 'Done'); return trace; }
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
export function mergeIntervalsTrace(input: [number, number][]) {
    const v = { k: -1, starts: input.map(iv => iv[0]), ends: input.map(iv => iv[1]), mStarts: [] as number[], mEnds: [] as number[], m: 0, tip_m: String.raw`\text{len}(${tt('merged')}) = 0` };
    const { trace, emit } = recorder(v);
    const sync = (merged: [number, number][]) => { v.mStarts = merged.map(iv => iv[0]); v.mEnds = merged.map(iv => iv[1]); v.m = merged.length; };
    emit(1, 'The input intervals, in the order given. Each column is one interval.');
    const sorted = input.slice().sort((a, b) => a[0] - b[0]);
    v.starts = sorted.map(iv => iv[0]); v.ends = sorted.map(iv => iv[1]);
    emit(2, 'Sort by start. Now any interval that overlaps the current group must come right after it.');
    const merged: [number, number][] = [];
    emit(3, 'merged starts empty.');
    sorted.forEach(([start, end], k) => {
        v.k = k;
        emit(4, `Next interval: [${start},${end}].`);
        const last = merged.at(-1);
        const overlaps = !!last && start <= last[1];
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
    v.k = -1;
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
    const v = { i: -1, x: 0, left: -1, dq: [] as number[], out: [] as number[], popped: -1 };
    const { trace, emit } = recorder(v);
    emit(4, 'The deque holds indices whose values decrease from front to back. The front is always the window maximum.');
    nums.forEach((x, i) => {
        v.i = i; v.x = x; v.left = Math.max(0, i - k + 1); v.popped = -1;
        emit(5, `Index ${i}: ${x} enters the window nums[${v.left}..${i}].`);
        while (true) {
            const back = v.dq.at(-1);
            if (back === undefined) { emit(6, 'The deque is empty.'); break; }
            const smaller = nums[back]! <= x;
            emit(6, `Is nums[${back}] = ${nums[back]} ≤ ${x}? ${smaller ? 'Yes: it can never be a maximum again.' : 'No: keep it.'}`);
            if (!smaller) break;
            v.popped = v.dq.pop()!;
            emit(7, `Drop index ${v.popped} from the back.`);
        }
        v.popped = -1; v.dq.push(i);
        emit(8, `Append index ${i} at the back.`);
        const expired = v.dq[0]! <= i - k;
        emit(9, expired ? `Front index ${v.dq[0]} has left the window.` : `Front index ${v.dq[0]} is still inside the window.`);
        if (expired) { v.popped = v.dq.shift()!; emit(10, `Drop index ${v.popped} from the front.`); v.popped = -1; }
        if (i >= k - 1) {
            v.out.push(nums[v.dq[0]!]!);
            emit(12, `Window nums[${v.left}..${i}] is full: its maximum is nums[${v.dq[0]}] = ${nums[v.dq[0]!]}.`);
        } else emit(11, `The first window is not full yet (${i + 1} of ${k}).`);
    });
    v.i = -1; v.left = -1;
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
    const v = { k: -1, x: 0, result: 0, xBits: bitsOf(0, width), rBits: bitsOf(0, width), tip_x: '', tip_result: `${tt('result')} = 0` };
    const { trace, emit } = recorder(v);
    emit(2, 'result starts at 0. XOR rules: a ^ a = 0 and a ^ 0 = a, in any order.');
    nums.forEach((x, k) => {
        v.k = k; v.x = x; v.xBits = bitsOf(x, width);
        v.tip_x = String.raw`x = ${at('nums', k)} = ${x} = ${v.xBits.join('')}_2`;
        emit(3, `Take nums[${k}] = ${x}, binary ${v.xBits.join('')}.`);
        const old = v.result; v.result ^= x; v.rBits = bitsOf(v.result, width);
        v.tip_result = String.raw`${tt('result')} = ${old} \oplus ${x} = ${v.result} \quad (${bitsOf(old, width).join('')} \oplus ${v.xBits.join('')} = ${v.rBits.join('')})`;
        emit(4, `${old} ^ ${x} = ${v.result}: each bit flips where x has a 1.`);
    });
    v.k = -1; v.tip_x = '';
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
    const v = { phase: 1, i: -1, k: 0, pi: -1, lps: [...p].map(() => 0), hits: [] as number[], lo: -1, hi: -1, tip_k: 'k = 0' };
    const { trace, emit } = recorder(v);
    const T = [...text], P = [...p];
    // lo..hi is the stretch of text currently matched by p[0..k-1].
    const span = (end: number) => { v.lo = v.k ? end - v.k + 1 : -1; v.hi = v.k ? end : -1; };
    emit(2, 'Phase 1: lps[i] = length of the longest proper prefix of p that is also a suffix of p[0..i].');
    for (let i = 1; i < P.length; i++) {
        v.i = -1; v.pi = i;
        emit(3, `Extend to p[${i}] = ${P[i]}.`);
        while (v.k && P[i] !== P[v.k]) {
            emit(4, `p[${i}] = ${P[i]} ≠ p[${v.k}] = ${P[v.k]}: fall back.`);
            const from = v.k; v.k = v.lps[v.k - 1]!; v.tip_k = `k = ${at('lps', 'k - 1')} = ${at('lps', from - 1)} = ${v.k}`;
            emit(5, `k = lps[k − 1] = ${v.k}.`);
        }
        const eq = P[i] === P[v.k];
        emit(6, `Does p[${i}] = ${P[i]} match p[${v.k}] = ${P[v.k]}? ${eq ? 'Yes.' : 'No.'}`);
        if (eq) { v.k++; v.tip_k = `k = ${v.k - 1} + 1 = ${v.k}`; emit(7, `k = ${v.k}.`); }
        v.lps[i] = v.k;
        emit(8, `lps[${i}] = ${v.k}.`);
    }
    v.pi = -1; v.k = 0; v.phase = 2; v.tip_k = String.raw`k = 0 \quad \text{(search starts)}`;
    emit(12, 'Phase 2: scan the text once. k counts how much of p matches so far.');
    T.forEach((ch, i) => {
        v.i = i; span(i - 1);
        emit(13, `Read text[${i}] = ${ch}.`);
        while (v.k && ch !== P[v.k]) {
            emit(14, `${ch} ≠ p[${v.k}] = ${P[v.k]}: keep the longest border instead of restarting.`);
            const from = v.k; v.k = v.lps[v.k - 1]!; span(i - 1); v.tip_k = `k = ${at('lps', 'k - 1')} = ${at('lps', from - 1)} = ${v.k}`;
            emit(15, `k = lps[k − 1] = ${v.k}. The text pointer never moves back.`);
        }
        const eq = ch === P[v.k];
        emit(16, `Does ${ch} match p[${v.k}] = ${P[v.k]}? ${eq ? 'Yes.' : 'No.'}`);
        if (eq) { v.k++; span(i); v.tip_k = `k = ${v.k - 1} + 1 = ${v.k}`; emit(17, `k = ${v.k}.`); }
        if (v.k === P.length) {
            emit(18, 'All of p matched.');
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
