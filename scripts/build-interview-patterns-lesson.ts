// Builds scenes/draft/interview-patterns.json from the display-only sources and
// execution traces in src/algorithms/interview-patterns.ts. Prints JSON to stdout;
// scripts/build_interview_patterns_lesson.py formats and writes it.
import {
    prefixSumTrace, PREFIX_SOURCE, twoPointersTrace, TWO_POINTERS_SOURCE, slidingWindowTrace, SLIDING_WINDOW_SOURCE,
    fastSlowTrace, FAST_SLOW_SOURCE, monotonicStackTrace, MONOTONIC_STACK_SOURCE, rotatedSearchTrace, ROTATED_SEARCH_SOURCE,
    mergeIntervalsTrace, MERGE_INTERVALS_SOURCE, houseRobberTrace, HOUSE_ROBBER_SOURCE,
} from '../src/algorithms/interview-patterns.js';
import type { Frame } from '../src/algorithms/interview-patterns.js';
import { INTERVIEW_INPUTS as IN } from '../src/algorithms/interview-pattern-inputs.js';

type Json = Record<string, unknown>;
const tr = (col: string) => `dataTable('trace', frame, '${col}')`;
const inp = (col: string) => `dataTable('input', 0, '${col}')`;
const GOLD = '#f1c65b', TEAL = '#77bfae', BLUE = '#9dbde3', PINK = '#e67db0';
const RANGE = [[-7, 10], [-5, 5], [-2, 2]];
const grid = { id: 'grid', type: 'grid', plane: 'xy', range: [[-7, 10], [-5, 5]], divisions: [17, 10], opacity: 0.09 };

const marker = (indexName: string, indexExpr: string, color = GOLD, visibleExpr?: string) =>
    ({ type: 'step_marker', indexName, indexExpr, ...(visibleExpr ? { visibleExpr } : {}), color });
function array(id: string, label: string, origin: number[], opts: Json & { from: string }) {
    const { from, ...rest } = opts;
    return {
        id, _title: label, type: 'array', itemType: 'number', origin, cellSize: 1.35, fontSize: 16, indexFontSize: 10,
        lengthExpr: `arrayCount(${from})`, valueExpr: `arrayAt(${from}, idx)`, ...rest,
    };
}
/** Expression labels at the same position merge into one draggable "Vars" box. */
const label = (id: string, textExpr: string, position: number[], connect?: [string, string]) =>
    ({ id, type: 'expression_label', position, textExpr, ...(connect ? { connectTo: { object: connect[0], indexExpr: connect[1] } } : {}) });
const unset = (col: string, name = col) => `concat('${name} = ', ${tr(col)} < 0 ? 'unset' : ${tr(col)})`;

interface PatternScene {
    id: string; title: string; description: string; markdown: string; prompt: string; file: string; source: string;
    trace: Frame[]; input: Json; elements: Json[]; cameraX?: number;
}
const scenes: Json[] = [], codeFiles: Json[] = [];
/** Array titles sit at a fixed spot left of the row; built-in titles follow a dynamic array's centre into the markers. */
function withTitle(el: Json): Json[] {
    if (!('_title' in el)) return [el];
    const { _title, ...array } = el, [x, y] = array.origin as number[];
    return [{ id: `${array.id}-title`, type: 'text', text: _title, position: [x! - (array.cellSize as number) / 2 - 0.3 - 0.16 * String(_title).length, y!, 0], color: '#b5c1cf' }, array];
}
function pattern(p: PatternScene) {
    const x = p.cameraX ?? 0;
    scenes.push({
        id: p.id, title: p.title, description: p.description, range: RANGE,
        camera: { position: [x, 0, 16], target: [x, 0, 0] },
        data: { input: [p.input], trace: p.trace }, markdown: p.markdown, prompt: p.prompt, elements: [grid],
        steps: [{
            id: 'run', title: 'Run the algorithm', description: 'Follow the highlighted code line with the execution player.',
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: p.trace.length - 1, step: 1, default: 0 }],
            add: p.elements.flatMap(withTitle),
            info: [{ id: 'current-action', title: 'Current action', content: `{{${tr('message')}}}`, position: 'top-center' }],
        }],
        stepPlayback: { slider: 'frame', intervalMs: 1200 },
    });
    codeFiles.push({
        id: p.id, path: `patterns/${p.file}`, language: 'python', source: p.source, activeLineExpr: tr('line'),
        locations: p.trace.map((f, snapshot) => ({ line: f.line, scene: p.id, step: 'run', snapshot, label: `${p.title} · ${f.message}` })),
    });
}
function placeholder(id: string, title: string, description: string, markdown: string, prompt: string) {
    scenes.push({
        id, title, description, range: RANGE, camera: { position: [1.5, 0, 15], target: [1.5, 0, 0] }, markdown, prompt,
        elements: [grid, { id: 'placeholder', type: 'text', text: `${title}: visualization coming soon`, position: [1.5, 0, 0], color: BLUE }],
    });
}

const MD_TAIL = 'Use the execution player to step through, or open **Code** to see the active Python line. The code is display-only; every view reads the same recorded execution snapshot.';

// ── Overview ──
scenes.push({
    id: 'overview', title: 'Pattern map', description: 'Recognize which pattern a problem is asking for.', range: RANGE,
    camera: { position: [1.5, 0, 15], target: [1.5, 0, 0] }, elements: [grid,
        { id: 'title', type: 'text', text: 'Interview algorithm patterns', position: [1.5, 0.6, 0], color: GOLD },
        { id: 'subtitle', type: 'text', text: 'Spot the signal, pick the plan', position: [1.5, -0.6, 0], color: BLUE }],
    markdown: `# Algorithm patterns for interviews

Most interview problems are variations on a small set of patterns. The skill is recognizing the **signal** in the problem statement and reaching for the matching plan.

| Signal in the problem | Pattern | Typical cost |
| --- | --- | --- |
| Many range-sum queries on a fixed array | Prefix sum | O(n) build, O(1) per query |
| Sorted array, find a pair or triple | Two pointers | O(n) |
| Best contiguous subarray or substring | Sliding window | O(n) |
| Cycle, or "find the duplicate" in O(1) space | Fast & slow pointers | O(n), O(1) space |
| Reverse or reorder linked-list nodes | In-place reversal | O(n), O(1) space |
| "Next greater / smaller element" | Monotonic stack | O(n) |
| k largest, k smallest, k most frequent | Top-K with a heap | O(n log k) |
| Intervals, meetings, ranges | Sort and merge | O(n log n) |
| Sorted data with a twist (rotated, 2D) | Modified binary search | O(log n) |
| Visit every tree node in a set order | Tree traversal | O(n) |
| Explore every path or component | Depth-first search | O(V + E) |
| Shortest path in steps, level by level | Breadth-first search | O(V + E) |
| Grid of cells, islands, flood fill | Matrix traversal | O(rows × cols) |
| All permutations, subsets, placements | Backtracking | Exponential, pruned |
| Optimal value from overlapping subproblems | Dynamic programming | Subproblems × work each |

Each following scene runs one pattern on a small example. Scenes marked *coming soon* are placeholders until AlgeBench has the data structure they need.`,
    prompt: 'Help the learner recognize which pattern fits a problem. Ask them to name the signal (sorted input, contiguous range, cycle, next-greater, overlapping subproblems) before naming a pattern. Encourage predicting the pattern before revealing it.',
});

// ── Prefix sum ──
pattern({
    id: 'prefix-sum', title: 'Prefix sum', file: 'prefix_sum.py', source: PREFIX_SOURCE,
    description: 'Precompute running totals so any range sum costs one subtraction.',
    input: { nums: IN.prefix.nums }, trace: prefixSumTrace(IN.prefix.nums, IN.prefix.queries),
    markdown: `# Prefix sum

**Signal:** many "sum of nums[i..j]" queries on an array that does not change.

Build \`prefix\` once, where \`prefix[m]\` is the sum of the first \`m\` numbers. Each prefix cell sits on the boundary *before* position m, so it covers everything to its left. Then

$$\\text{sum}(i..j) = \\text{prefix}[j+1] - \\text{prefix}[i]$$

because the larger prefix includes the range and the smaller one removes everything before it. Building costs O(n); every query after that costs O(1).

${MD_TAIL}

**Practice:** Range Sum Query (303), Contiguous Array (525), Subarray Sum Equals K (560).`,
    prompt: 'Explain why prefix[j+1] - prefix[i] isolates the range. Stress the off-by-one: prefix has n+1 entries and prefix[0] = 0. Ask the learner to predict a query answer before the player reveals it. Displayed Python is not executing in the browser.',
    elements: [
        array('nums', 'nums', [-5, 1.8, 0], {
            from: inp('nums'),
            highlightExpr: `${tr('querying')} == 1 ? (idx >= ${tr('qi')} and idx <= ${tr('qj')}) : idx == ${tr('k')}`,
            markers: [marker('k', tr('k')), marker('i', tr('qi'), PINK), marker('j', tr('qj'), PINK)],
        }),
        array('prefix', 'prefix', [-5.675, -0.9, 0], {
            from: tr('prefix'), color: '#b69bea',
            highlightExpr: `${tr('querying')} == 1 ? (idx == ${tr('qi')} or idx == ${tr('qj')} + 1) : false`,
            markers: [marker('i', tr('qi'), PINK), marker('j + 1', `${tr('qj')} + 1`, PINK, `${tr('querying')} == 1`)],
        }),
        label('x', unset('k', 'k'), [-4.5, -3.6, 0], ['nums', tr('k')]),
        label('last', `concat('prefix[-1] = ', arrayAt(${tr('prefix')}, ${tr('n')} - 1))`, [-4.5, -3.6, 0], ['prefix', `${tr('n')} - 1`]),
        label('answer', `concat('range sum = ', ${tr('hasAnswer')} == 1 ? ${tr('answer')} : '—')`, [4, -3.6, 0]),
    ],
});

// ── Two pointers ──
pattern({
    id: 'two-pointers', title: 'Two pointers', file: 'two_pointers.py', source: TWO_POINTERS_SOURCE,
    description: 'Walk inward from both ends of a sorted array to find a pair.',
    input: { nums: IN.twoPointers.nums, target: IN.twoPointers.target }, trace: twoPointersTrace(IN.twoPointers.nums, IN.twoPointers.target),
    markdown: `# Two pointers

**Signal:** a **sorted** array and a question about a pair (or triple) of elements.

Put \`left\` at the smallest value and \`right\` at the largest. Compare their sum with the target:

- **Too small:** \`nums[right]\` is the largest value still available, so \`nums[left]\` cannot reach the target with anything. Discard it: \`left += 1\`.
- **Too big:** \`nums[left]\` is the smallest value still available, so \`nums[right]\` overshoots with everything. Discard it: \`right -= 1\`.

Each step rules out one element for good, so the scan is O(n) with O(1) space, compared with O(n²) for checking every pair. Target here: **${IN.twoPointers.target}**.

${MD_TAIL}

**Practice:** Two Sum II (167), 3Sum (15), Container With Most Water (11).`,
    prompt: 'Explain why moving a pointer never skips a valid pair: the discarded element cannot be part of any solution. Ask the learner to predict which pointer moves before each step.',
    elements: [
        array('nums', 'nums', [-4.5, 1.2, 0], {
            from: inp('nums'), highlightExpr: `idx == ${tr('left')} or idx == ${tr('right')}`,
            markers: [marker('left', tr('left')), marker('right', tr('right'), PINK)],
        }),
        label('left', `concat('left = ', ${tr('left')})`, [-4, -2.6, 0], ['nums', tr('left')]),
        label('right', `concat('right = ', ${tr('right')})`, [-4, -2.6, 0], ['nums', tr('right')]),
        label('total', `concat('total = ', ${tr('hasTotal')} == 1 ? ${tr('total')} : '—')`, [-4, -2.6, 0]),
        label('target', `concat('target = ', ${inp('target')})`, [4, -2.6, 0]),
    ],
});

// ── Sliding window ──
pattern({
    id: 'sliding-window', title: 'Sliding window', file: 'sliding_window.py', source: SLIDING_WINDOW_SOURCE,
    description: 'Reuse the last window\'s sum: add the entering element, subtract the leaving one.',
    input: { nums: IN.slidingWindow.nums, k: IN.slidingWindow.k }, trace: slidingWindowTrace(IN.slidingWindow.nums, IN.slidingWindow.k),
    markdown: `# Sliding window

**Signal:** the best (largest, smallest, longest) **contiguous** subarray or substring.

Neighbouring windows share all but two elements. Instead of re-summing each window of size k = ${IN.slidingWindow.k}, slide it one step: add the element that enters on the right, subtract the one that leaves on the left. That turns O(n·k) into O(n).

This scene uses a fixed-size window. Variable-size windows (longest substring without repeats, minimum window substring) grow \`right\` every step and shrink \`left\` while a constraint is broken. The invariant is the same: the window state is updated incrementally, never recomputed.

${MD_TAIL}

**Practice:** Maximum Average Subarray I (643), Longest Substring Without Repeating Characters (3), Minimum Window Substring (76).`,
    prompt: 'Explain the incremental update and why it is O(1). Contrast fixed and variable windows. Ask the learner to predict the next window sum before the player shows it.',
    elements: [
        array('nums', 'nums', [-4.5, 1.2, 0], {
            from: inp('nums'), highlightExpr: `idx >= ${tr('left')} and idx <= ${tr('right')}`,
            markers: [marker('left', tr('left')), marker('right', tr('right')), marker('right − k', tr('dropped'), PINK)],
        }),
        label('window', `concat('window = ', ${tr('window')})`, [-4, -2.6, 0]),
        label('best', `concat('best = ', ${tr('best')})`, [-4, -2.6, 0]),
        label('k', `concat('k = ', ${inp('k')})`, [4, -2.6, 0]),
    ],
});

// ── Fast & slow ──
const fsNums = IN.fastSlow.nums, fsOrigin = [-4, 0.6, 0], fsPitch = 1.35;
const arcs: Json[] = [];
fsNums.forEach((to, from) => {
    const x0 = fsOrigin[0]! + from * fsPitch, x1 = fsOrigin[0]! + to * fsPitch, up = to > from ? 1 : -1;
    const y0 = fsOrigin[1]! + up * 0.45, h = up * (0.5 + 0.28 * Math.abs(to - from));
    const pts: number[][] = [];
    for (let s = 0; s <= 16; s++) { const t = s / 16; pts.push([+(x0 + (x1 - x0) * t).toFixed(3), +(y0 + h * Math.sin(Math.PI * t)).toFixed(3), 0]); }
    arcs.push({ id: `next-${from}`, type: 'line', points: pts, color: '#5f7186', width: 2 });
    arcs.push({ id: `head-${from}`, type: 'vector', from: pts[14], to: pts[16], color: '#5f7186' });
});
pattern({
    id: 'fast-slow', title: 'Fast & slow pointers', file: 'fast_slow.py', source: FAST_SLOW_SOURCE,
    description: 'Floyd\'s cycle detection finds a duplicate without extra memory.',
    input: { nums: fsNums }, trace: fastSlowTrace(fsNums),
    markdown: `# Fast & slow pointers

**Signal:** a cycle in a linked structure, or "find the duplicate" with O(1) extra space.

Here \`nums\` holds ${fsNums.length} values from 1 to ${fsNums.length - 1}, so one value repeats. Read each cell as a pointer: index i points to index \`nums[i]\` (the arcs). Following pointers from index 0 must eventually loop, and the loop's entrance is the value two indices point to: the duplicate.

**Phase 1:** \`slow\` moves one hop, \`fast\` moves two. Inside the cycle fast gains one step per move, so they must meet.

**Phase 2:** restart \`slow\` from the beginning and move both one hop at a time. The distance from the start to the entrance equals the distance from the meeting point to the entrance (mod the cycle length), so they meet exactly at the entrance.

${MD_TAIL}

**Practice:** Linked List Cycle (141), Happy Number (202), Find the Duplicate Number (287).`,
    prompt: 'Explain why fast catches slow inside the cycle and why phase 2 lands on the entrance. Use the arcs as a linked list. Ask the learner to predict where each pointer lands after the next hop.',
    elements: [
        ...arcs,
        array('nums', 'nums', fsOrigin, {
            from: inp('nums'), highlightExpr: `idx == ${tr('slow')} or idx == ${tr('fast')}`,
            markers: [marker('slow', tr('slow')), marker('fast', tr('fast'), PINK), marker('fast (mid-hop)', tr('hop'), BLUE)],
        }),
        label('slow', `concat('slow = ', ${tr('slow')})`, [-4, -3.4, 0], ['nums', tr('slow')]),
        label('fast', `concat('fast = ', ${tr('fast')})`, [-4, -3.4, 0], ['nums', tr('fast')]),
        label('phase', `concat('phase = ', ${tr('phase')})`, [4, -3.4, 0]),
    ],
});

// ── Monotonic stack ──
pattern({
    id: 'monotonic-stack', title: 'Monotonic stack', file: 'monotonic_stack.py', source: MONOTONIC_STACK_SOURCE,
    description: 'Find each day\'s next warmer day with a stack of waiting days.',
    input: { temps: IN.monotonic.temps }, trace: monotonicStackTrace(IN.monotonic.temps), cameraX: 1,
    markdown: `# Monotonic stack

**Signal:** "next greater element", "next smaller element", or "how far until…".

The stack holds the **indices** of days that have not yet seen a warmer day. Their temperatures never increase from bottom to top, so a new day only needs to compare with the top. While today is warmer than the top day, pop it: today is its answer. Then push today.

Every index is pushed once and popped at most once, so the whole scan is O(n), even though there is a loop inside a loop.

${MD_TAIL}

**Practice:** Next Greater Element I (496), Daily Temperatures (739), Largest Rectangle in Histogram (84).`,
    prompt: 'Explain the stack invariant (temperatures non-increasing bottom to top) and the amortized O(n) argument. Ask the learner to predict how many days the next temperature will pop.',
    elements: [
        array('temps', 'temps', [-5, 2.2, 0], {
            from: inp('temps'), highlightExpr: `idx == ${tr('i')}`,
            markers: [marker('i', tr('i')), marker('j', tr('j'), PINK), marker('stack[-1]', tr('top'), BLUE)],
        }),
        array('answer', 'answer', [-5, -0.8, 0], {
            from: tr('answer'), color: '#b69bea', highlightExpr: `idx == ${tr('j')} and ${tr('line')} == 7`,
            markers: [marker('j', tr('j'), PINK)],
        }),
        {
            id: 'stack', type: 'stack', itemType: 'number', origin: [6.3, -3.4, 0], cellSize: 1.1, fontSize: 15, showIndices: false,
            lengthExpr: tr('n'), valueExpr: `arrayAt(${tr('stack')}, idx)`, color: BLUE, label: 'stack (days)', containerColor: TEAL,
        },
        label('i', unset('i'), [-4.5, -3.6, 0], ['temps', tr('i')]),
        label('t', `concat('t = ', ${tr('i')} < 0 ? 'unset' : ${tr('t')})`, [-4.5, -3.6, 0], ['temps', tr('i')]),
        label('j', unset('j'), [-4.5, -3.6, 0], ['answer', tr('j')]),
    ],
});

// ── Modified binary search ──
pattern({
    id: 'rotated-search', title: 'Modified binary search', file: 'rotated_search.py', source: ROTATED_SEARCH_SOURCE,
    description: 'Binary search a rotated sorted array by finding the sorted half.',
    input: { nums: IN.rotated.nums, target: IN.rotated.target }, trace: rotatedSearchTrace(IN.rotated.nums, IN.rotated.target),
    markdown: `# Modified binary search

**Signal:** data that is sorted *with a twist* (rotated, sorted rows and columns, or a monotone yes/no condition) and an O(log n) expectation.

A rotated sorted array is two sorted runs. Cut it at \`mid\` and **at least one half is fully sorted**: if \`nums[lo] ≤ nums[mid]\` the left half is, otherwise the right half is. A sorted half lets you check in O(1) whether the target lies inside it, so you still discard half the candidates each step. Highlighted cells are the candidates still in play. Target here: **${IN.rotated.target}**.

${MD_TAIL}

**Practice:** Search in Rotated Sorted Array (33), Find Minimum in Rotated Sorted Array (153), Search a 2D Matrix II (240).`,
    prompt: 'Explain why one half is always sorted and how that keeps O(log n). Ask the learner to predict which half survives before each step.',
    elements: [
        array('nums', 'nums', [-5.5, 1.2, 0], {
            from: inp('nums'), cellSize: 1.25, fontSize: 15,
            highlightExpr: `idx >= ${tr('lo')} and idx <= ${tr('hi')}`,
            markers: [marker('lo', tr('lo')), marker('mid', tr('mid'), PINK), marker('hi', tr('hi'))],
        }),
        label('lo', `concat('lo = ', ${tr('lo')})`, [-4.5, -2.6, 0], ['nums', tr('lo')]),
        label('mid', unset('mid'), [-4.5, -2.6, 0], ['nums', tr('mid')]),
        label('hi', `concat('hi = ', ${tr('hi')})`, [-4.5, -2.6, 0], ['nums', tr('hi')]),
        label('half', `concat('sorted half = ', ${tr('half')} == 1 ? 'left' : (${tr('half')} == 2 ? 'right' : '—'))`, [4, -2.6, 0]),
        label('target', `concat('target = ', ${inp('target')})`, [4, -2.6, 0]),
    ],
});

// ── Merge intervals ──
const ivs = IN.intervals.input, ivSorted = ivs.slice().sort((a, b) => a[0] - b[0]);
const tl = { x0: -5, scale: 0.6, y: -2.9 };
const timeline: Json[] = [{ id: 'axis', type: 'line', points: [[tl.x0, tl.y - 0.4, 0], [tl.x0 + 19 * tl.scale, tl.y - 0.4, 0]], color: '#5f7186', width: 1.5 }];
for (const t of [0, 5, 10, 15]) timeline.push({ id: `tick-${t}`, type: 'text', text: String(t), position: [tl.x0 + t * tl.scale, tl.y - 0.8, 0], color: '#8793a6' });
ivSorted.forEach(([s, e], k) => timeline.push({
    id: `bar-${k}`, type: 'line', points: [[tl.x0 + s * tl.scale, tl.y + (k % 2) * 0.35, 0], [tl.x0 + e * tl.scale, tl.y + (k % 2) * 0.35, 0]], color: '#74d0c2', width: 6,
}));
pattern({
    id: 'merge-intervals', title: 'Overlapping intervals', file: 'merge_intervals.py', source: MERGE_INTERVALS_SOURCE,
    description: 'Sort by start, then sweep once and merge into the last group.',
    input: { intervals: ivs.map(([s, e]) => `[${s},${e}]`) }, trace: mergeIntervalsTrace(ivs),
    markdown: `# Overlapping intervals

**Signal:** meetings, bookings, ranges, or anything with a start and an end.

Sort by start time. After sorting, an interval can only overlap the group immediately before it, so a single sweep suffices: if the next interval starts at or before the last merged end, extend that end; otherwise start a new group. The bars below show the intervals on a number line.

Sorting dominates: O(n log n) time.

${MD_TAIL}

**Practice:** Merge Intervals (56), Insert Interval (57), Non-overlapping Intervals (435).`,
    prompt: 'Explain why sorting by start means only the last merged interval can overlap the next one. Ask the learner to predict whether the next interval extends the last group or starts a new one.',
    elements: [
        ...timeline,
        array('starts', 'start', [-4, 3.0, 0], {
            from: tr('starts'), showIndices: false, highlightExpr: `idx == ${tr('k')}`, markers: [marker('k', tr('k'))],
        }),
        array('ends', 'end', [-4, 2.15, 0], { from: tr('ends'), highlightExpr: `idx == ${tr('k')}` }),
        array('merged-starts', 'merged start', [-4, 0.05, 0], { from: tr('mStarts'), color: '#b69bea', showIndices: false, markers: [marker('merged[-1]', `${tr('m')} - 1`, PINK)] }),
        array('merged-ends', 'merged end', [-4, -0.8, 0], {
            from: tr('mEnds'), showIndices: true, color: '#b69bea', highlightExpr: `idx == ${tr('m')} - 1 and (${tr('line')} == 6 or ${tr('line')} == 5)`,
        }),
        label('k', unset('k'), [5, 0.6, 0], ['starts', tr('k')]),
        label('m', `concat('len(merged) = ', ${tr('m')})`, [5, 0.6, 0], ['merged-ends', `${tr('m')} - 1`]),
    ],
});

// ── Dynamic programming ──
pattern({
    id: 'dynamic-programming', title: 'Dynamic programming', file: 'house_robber.py', source: HOUSE_ROBBER_SOURCE,
    description: 'House robber: build each answer from the two before it.',
    input: { houses: IN.dp.houses }, trace: houseRobberTrace(IN.dp.houses),
    markdown: `# Dynamic programming

**Signal:** "maximum / minimum / number of ways", where a choice now affects which choices remain, and the same subproblems recur.

House robber: you cannot rob two adjacent houses. Let \`dp[i]\` be the most you can steal from the first \`i\` houses. For house \`i − 1\` there are only two options:

$$dp[i] = \\max(\\underbrace{dp[i-1]}_{\\text{skip}},\\; \\underbrace{dp[i-2] + \\text{houses}[i-1]}_{\\text{take}})$$

Like a prefix sum, \`dp[i]\` sits on the boundary after the first i houses. Each cell is computed once from cells already filled, giving O(n) time instead of the 2ⁿ subsets a brute force would try.

The same recipe (define the state, write the recurrence, fill in order) drives the classic families: Fibonacci-style, 0/1 knapsack, longest common subsequence, longest increasing subsequence, subset sum.

${MD_TAIL}

**Practice:** Climbing Stairs (70), House Robber (198), Coin Change (322), Longest Common Subsequence (1143), Longest Increasing Subsequence (300), Partition Equal Subset Sum (416).`,
    prompt: 'Explain state, recurrence, and fill order. Ask the learner to predict dp[i] from the two cells before it before the player reveals it. Note dp only needs the last two values, so space can drop to O(1).',
    elements: [
        array('houses', 'houses', [-4.5, 1.8, 0], {
            from: inp('houses'), highlightExpr: `idx == ${tr('house')}`, markers: [marker('i − 1', tr('house'), PINK)],
        }),
        array('dp', 'dp', [-5.175, -0.9, 0], {
            from: tr('dp'), color: '#b69bea', highlightExpr: `idx == ${tr('read')} or (idx == ${tr('i')} and (${tr('line')} == 7 or ${tr('line')} == 3))`,
            markers: [marker('i', tr('i')), marker('read', tr('read'), PINK)],
        }),
        label('skip', `concat('skip = ', ${tr('hasSkip')} == 1 ? ${tr('skip')} : '—')`, [-4, -3.6, 0]),
        label('take', `concat('take = ', ${tr('hasTake')} == 1 ? ${tr('take')} : '—')`, [-4, -3.6, 0]),
    ],
});

// ── Placeholders for patterns that need data structures AlgeBench does not render yet ──
const SOON = 'This pattern needs a data structure AlgeBench cannot draw yet, so this scene is a placeholder.';
placeholder('linked-list-reversal', 'Linked list reversal', 'Rewire next pointers in place.', `# Linked list in-place reversal

**Signal:** reverse a list or a sublist, swap pairs, or reorder nodes, with O(1) extra space.

Walk the list with three pointers, \`prev\`, \`curr\` and \`next\`. Save \`curr.next\`, point \`curr.next\` back at \`prev\`, then advance both. Each node is rewired once: O(n) time, O(1) space.

${SOON} *(Needs a linked-list object with nodes and pointer arrows.)*

**Practice:** Reverse Linked List (206), Reverse Linked List II (92), Swap Nodes in Pairs (24).`,
    'Explain the prev/curr/next dance and why saving next first matters. This scene has no visualization yet.');
placeholder('top-k', 'Top K elements', 'Keep a size-k heap of the best candidates.', `# Top K elements

**Signal:** the k largest, k smallest, or k most frequent items.

Keep a **min-heap of size k**. Push each item; when the heap grows past k, pop its smallest. The heap then holds the k largest, and its root is the k-th largest. O(n log k) time, which beats sorting when k is small.

${SOON} *(Needs a general heap view with push and pop.)*

**Practice:** Kth Largest Element in an Array (215), Top K Frequent Elements (347), Find K Pairs with Smallest Sums (373).`,
    'Explain why a min-heap (not a max-heap) keeps the k largest. This scene has no visualization yet.');
placeholder('tree-traversal', 'Binary tree traversal', 'Preorder, inorder, postorder.', `# Binary tree traversal

**Signal:** process every node of a tree in a specific order.

- **Preorder** (node, left, right): copy or serialize a tree, print root-to-leaf paths.
- **Inorder** (left, node, right): visits a binary search tree in sorted order.
- **Postorder** (left, right, node): compute something from both children first, such as height or the maximum path sum.

${SOON} *(Needs a binary-tree object.)*

**Practice:** Binary Tree Paths (257, preorder), Kth Smallest Element in a BST (230, inorder), Binary Tree Maximum Path Sum (124, postorder).`,
    'Explain the three orders and what each is good for. This scene has no visualization yet.');
placeholder('dfs', 'Depth-first search', 'Go deep, then backtrack.', `# Depth-first search

**Signal:** explore every path, find connected components, detect cycles, or order dependencies.

Follow one branch as far as it goes before backing up, using recursion or an explicit stack. Mark nodes as visited so cycles do not loop forever. O(V + E).

${SOON} *(Needs a graph object.)*

**Practice:** Clone Graph (133), Path Sum II (113), Course Schedule II (210).`,
    'Explain recursion vs an explicit stack, and the visited set. This scene has no visualization yet.');
placeholder('bfs', 'Breadth-first search', 'Explore level by level with a queue.', `# Breadth-first search

**Signal:** shortest path in an unweighted graph, or anything "level by level".

Start from the source, push it on a **queue**, and repeatedly pop the front and push its unvisited neighbours. Nodes come out in order of distance, so the first time you reach a node is along a shortest path. O(V + E).

${SOON} *(Needs a graph or tree object and a queue.)*

**Practice:** Binary Tree Level Order Traversal (102), Rotting Oranges (994), Word Ladder (127).`,
    'Explain why a queue gives shortest paths in unweighted graphs. This scene has no visualization yet.');
placeholder('matrix-traversal', 'Matrix traversal', 'DFS or BFS on a grid.', `# Matrix traversal

**Signal:** a 2D grid: islands, flood fill, regions, shortest moves.

Treat each cell as a node whose neighbours are the cells up, down, left and right, then run DFS or BFS. Check bounds before moving and mark cells as visited (often by overwriting them). O(rows × cols).

${SOON} *(Needs a 2D grid object with per-cell state.)*

**Practice:** Flood Fill (733), Number of Islands (200), Surrounded Regions (130).`,
    'Explain the grid-as-graph view and neighbour iteration. This scene has no visualization yet.');
placeholder('backtracking', 'Backtracking', 'Choose, explore, un-choose.', `# Backtracking

**Signal:** generate all permutations, subsets or combinations, or place pieces under constraints.

Build a candidate one choice at a time. After exploring a choice, **undo it** and try the next. Prune any branch that already breaks a constraint. The search is exponential in the worst case; pruning is what makes it practical.

${SOON} *(Needs a recursion-tree view.)*

**Practice:** Permutations (46), Subsets (78), N-Queens (51).`,
    'Explain choose / explore / un-choose and pruning. This scene has no visualization yet.');

// Placeholders sit next to their neighbours in the overview table's order.
const ORDER = ['overview', 'prefix-sum', 'two-pointers', 'sliding-window', 'fast-slow', 'linked-list-reversal', 'monotonic-stack', 'top-k',
    'merge-intervals', 'rotated-search', 'tree-traversal', 'dfs', 'bfs', 'matrix-traversal', 'backtracking', 'dynamic-programming'];
scenes.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
codeFiles.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
process.stdout.write(JSON.stringify({ title: 'Algorithm patterns for interviews', codeFiles, scenes }));
