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

export const PREFIX_SOURCE = `def build_prefix(nums):
    prefix = [0]
    for k, x in enumerate(nums):
        prefix.append(prefix[-1] + x)
    return prefix

def range_sum(prefix, i, j):
    return prefix[j + 1] - prefix[i]`;
export function prefixSumTrace(nums: number[], queries: [number, number][]) {
    const v = { k: -1, x: 0, prefix: [0] as number[], n: 1, qi: -1, qj: -1, querying: 0, answer: 0, hasAnswer: 0 };
    const { trace, emit } = recorder(v);
    emit(2, 'Start the prefix array with 0, the sum of no elements.');
    nums.forEach((x, k) => {
        v.k = k; v.x = x;
        emit(3, `Read nums[${k}] = ${x}.`);
        const last = v.prefix.at(-1)!;
        v.prefix.push(last + x); v.n = v.prefix.length;
        emit(4, `prefix[${k + 1}] = prefix[${k}] + ${x} = ${last} + ${x} = ${last + x}, the sum of the first ${k + 1} numbers.`);
    });
    v.k = -1; v.x = 0;
    emit(5, `Built in one O(n) pass. prefix[m] is the sum of everything left of position m.`);
    queries.forEach(([i, j], q) => {
        v.querying = 1; v.qi = i; v.qj = j; v.hasAnswer = 0; v.answer = 0;
        emit(7, `Query: the sum of nums[${i}..${j}].`);
        const hi = v.prefix[j + 1]!, lo = v.prefix[i]!;
        v.answer = hi - lo; v.hasAnswer = 1;
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
    const v = { left: 0, right: nums.length - 1, total: 0, hasTotal: 0, found: 0 };
    const { trace, emit } = recorder(v);
    emit(2, `Start at both ends: left = 0, right = ${v.right}.`);
    while (true) {
        emit(3, v.left < v.right ? 'left < right, so candidate pairs remain.' : 'The pointers met, so no pair remains.');
        if (v.left >= v.right) break;
        const a = nums[v.left]!, b = nums[v.right]!;
        v.total = a + b; v.hasTotal = 1;
        emit(4, `nums[${v.left}] + nums[${v.right}] = ${a} + ${b} = ${v.total}.`);
        emit(5, `Is ${v.total} equal to the target ${target}?`);
        if (v.total === target) { v.found = 1; emit(6, `Found it: indices ${v.left} and ${v.right}.`, 'Done'); return trace; }
        emit(7, `Is ${v.total} less than ${target}?`);
        if (v.total < target) {
            v.left++;
            emit(8, `Too small. nums[right] is the largest value left, so ${a} cannot reach the target with anything. Drop it: left = ${v.left}.`);
        } else {
            v.right--;
            emit(10, `Too big. nums[left] is the smallest value left, so ${b} overshoots with everything. Drop it: right = ${v.right}.`);
        }
    }
    v.hasTotal = 0;
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
    const v = { left: 0, right: k - 1, dropped: -1, window: 0, best: 0, bestLeft: 0 };
    const { trace, emit } = recorder(v);
    v.window = nums.slice(0, k).reduce((s, x) => s + x, 0);
    emit(2, `Sum the first window, nums[0..${k - 1}]: ${v.window}.`);
    v.best = v.window;
    emit(3, `best = ${v.best}.`);
    for (let right = k; right < nums.length; right++) {
        v.right = right; v.left = right - k + 1; v.dropped = right - k;
        const enter = nums[right]!, leave = nums[right - k]!, old = v.window;
        emit(4, `Slide right: nums[${right}] = ${enter} enters, nums[${right - k}] = ${leave} leaves.`);
        v.window += enter - leave;
        emit(5, `window = ${old} + ${enter} − ${leave} = ${v.window}. An O(1) update instead of re-summing ${k} numbers.`);
        v.dropped = -1;
        if (v.window > v.best) { v.best = v.window; v.bestLeft = v.left; emit(6, `${v.window} beats the old best: best = ${v.best}.`); }
        else emit(6, `${v.window} does not beat best = ${v.best}.`);
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
    const v = { slow: nums[0]!, fast: nums[0]!, phase: 1, hop: -1 };
    const { trace, emit } = recorder(v);
    emit(2, `Both pointers start at nums[0] = ${v.slow}. Read each value as a pointer to the index it names.`);
    while (true) {
        emit(3, 'Phase 1: slow moves one hop, fast moves two, until they meet.');
        const s = v.slow; v.slow = nums[s]!;
        emit(4, `slow takes one hop: nums[${s}] = ${v.slow}.`);
        const f = v.fast; v.hop = nums[f]!; v.fast = nums[v.hop]!;
        emit(5, `fast takes two hops: nums[${f}] = ${v.hop}, then nums[${v.hop}] = ${v.fast}.`);
        v.hop = -1;
        emit(6, `Do they meet? slow = ${v.slow}, fast = ${v.fast}.`);
        if (v.slow === v.fast) { emit(7, `They meet at index ${v.slow}, somewhere inside the cycle.`); break; }
    }
    v.phase = 2; v.slow = nums[0]!;
    emit(8, `Phase 2: restart slow at nums[0] = ${v.slow}; fast stays put. Both now move one hop at a time.`);
    while (true) {
        emit(9, v.slow !== v.fast ? `slow = ${v.slow}, fast = ${v.fast}: not yet equal.` : `slow = fast = ${v.slow}.`);
        if (v.slow === v.fast) break;
        const s = v.slow; v.slow = nums[s]!;
        emit(10, `slow: nums[${s}] = ${v.slow}.`);
        const f = v.fast; v.fast = nums[f]!;
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
    const v = { i: -1, t: 0, j: -1, top: -1, stack: [] as number[], n: 0, answer: temps.map(() => 0) };
    const { trace, emit } = recorder(v);
    emit(2, 'Every answer starts at 0, meaning no warmer day yet.');
    emit(3, 'The stack holds days still waiting for a warmer day. Their temperatures never increase from bottom to top.');
    temps.forEach((t, i) => {
        v.i = i; v.t = t; v.j = -1;
        emit(4, `Day ${i}: ${t}°.`);
        while (true) {
            v.top = v.stack.at(-1) ?? -1;
            if (v.top < 0) { emit(5, 'The stack is empty, so nobody is waiting.'); break; }
            const warmer = temps[v.top]! < t;
            emit(5, `Is day ${v.top}'s ${temps[v.top]}° below ${t}°? ${warmer ? 'Yes.' : 'No, so the stack stays as it is.'}`);
            if (!warmer) break;
            v.j = v.stack.pop()!; v.n = v.stack.length; v.top = -1;
            emit(6, `Pop day ${v.j}: day ${i} is its first warmer day.`);
            v.answer[v.j] = i - v.j;
            emit(7, `answer[${v.j}] = ${i} − ${v.j} = ${i - v.j}.`);
        }
        v.j = -1; v.top = -1;
        v.stack.push(i); v.n = v.stack.length;
        emit(8, `Push day ${i}. It waits for a warmer day.`);
    });
    v.i = -1; v.t = 0;
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
    const v = { lo: 0, hi: nums.length - 1, mid: -1, half: 0, found: -1 };
    const { trace, emit } = recorder(v);
    emit(2, `Search all of nums: lo = 0, hi = ${v.hi}.`);
    while (true) {
        v.half = 0;
        emit(3, v.lo <= v.hi ? `lo ≤ hi, so ${v.hi - v.lo + 1} candidates remain.` : 'lo passed hi, so no candidates remain.');
        if (v.lo > v.hi) break;
        v.mid = Math.floor((v.lo + v.hi) / 2);
        emit(4, `mid = (${v.lo} + ${v.hi}) // 2 = ${v.mid}.`);
        const m = nums[v.mid]!, l = nums[v.lo]!, h = nums[v.hi]!;
        emit(5, `Is nums[${v.mid}] = ${m} the target ${target}?`);
        if (m === target) { v.found = v.mid; emit(6, `Found ${target} at index ${v.mid}.`, 'Done'); return trace; }
        emit(7, `At least one half is sorted. Is nums[lo] = ${l} ≤ nums[mid] = ${m}?`);
        if (l <= m) {
            v.half = 1;
            emit(8, `Yes: nums[${v.lo}..${v.mid}] runs ${l} to ${m} in order. Is ${target} inside that range?`);
            if (l <= target && target < m) { v.hi = v.mid - 1; emit(9, `Yes: keep the left half. hi = ${v.hi}.`); }
            else { v.lo = v.mid + 1; emit(11, `No: the target can only be right of mid. lo = ${v.lo}.`); }
        } else {
            v.half = 2;
            emit(13, `No, so nums[${v.mid}..${v.hi}] runs ${m} to ${h} in order. Is ${target} inside that range?`);
            if (m < target && target <= h) { v.lo = v.mid + 1; emit(14, `Yes: keep the right half. lo = ${v.lo}.`); }
            else { v.hi = v.mid - 1; emit(16, `No: the target can only be left of mid. hi = ${v.hi}.`); }
        }
    }
    v.mid = -1;
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
    const v = { k: -1, starts: input.map(iv => iv[0]), ends: input.map(iv => iv[1]), mStarts: [] as number[], mEnds: [] as number[], m: 0 };
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
            last![1] = Math.max(last![1], end); sync(merged);
            emit(6, `Overlap: extend the last interval to ${showInterval(last!)}.`);
        } else {
            merged.push([start, end]); sync(merged);
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
    const v = { i: -1, house: -1, read: -1, skip: 0, take: 0, hasSkip: 0, hasTake: 0, dp: [0, ...houses.map(() => 0)] };
    const { trace, emit } = recorder(v);
    emit(2, 'dp[i] will hold the most you can steal from the first i houses. dp[0] = 0: no houses, no loot.');
    v.i = 1; v.house = 0; v.dp[1] = houses[0]!;
    emit(3, `With one house, take it: dp[1] = ${houses[0]}.`);
    for (let i = 2; i <= houses.length; i++) {
        v.i = i; v.house = -1; v.read = -1; v.hasSkip = v.hasTake = 0;
        emit(4, `Decide house ${i - 1} (value ${houses[i - 1]}), using answers already computed.`);
        v.read = i - 1; v.skip = v.dp[i - 1]!; v.hasSkip = 1;
        emit(5, `Skip house ${i - 1}: keep the best from ${i - 1} houses, dp[${i - 1}] = ${v.skip}.`);
        v.read = i - 2; v.house = i - 1; v.take = v.dp[i - 2]! + houses[i - 1]!; v.hasTake = 1;
        emit(6, `Take house ${i - 1}: its neighbour is off limits, so add ${houses[i - 1]} to dp[${i - 2}] = ${v.dp[i - 2]}: ${v.take}.`);
        v.read = -1; v.house = -1; v.dp[i] = Math.max(v.skip, v.take);
        emit(7, `dp[${i}] = max(${v.skip}, ${v.take}) = ${v.dp[i]}.`);
    }
    v.hasSkip = v.hasTake = 0; v.i = houses.length;
    emit(8, `Answer: dp[${houses.length}] = ${v.dp[houses.length]}. Each subproblem was solved once: O(n).`, 'Done');
    return trace;
}
