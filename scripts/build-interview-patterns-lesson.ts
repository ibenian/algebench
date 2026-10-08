// Builds scenes/draft/interview-patterns.json from the display-only sources and
// execution traces in src/algorithms/interview-patterns.ts. Prints JSON to stdout;
// scripts/build_interview_patterns_lesson.py formats and writes it.
import {
    prefixSumTrace, PREFIX_SOURCE, twoPointersTrace, TWO_POINTERS_SOURCE, slidingWindowTrace, SLIDING_WINDOW_SOURCE,
    fastSlowTrace, FAST_SLOW_SOURCE, monotonicStackTrace, MONOTONIC_STACK_SOURCE, rotatedSearchTrace, ROTATED_SEARCH_SOURCE,
    mergeIntervalsTrace, MERGE_INTERVALS_SOURCE, houseRobberTrace, HOUSE_ROBBER_SOURCE,
    monotonicQueueTrace, MONOTONIC_QUEUE_SOURCE, greedyTrace, GREEDY_SOURCE, bitsTrace, BITS_SOURCE,
    unionFindTrace, UNION_FIND_SOURCE, kmpTrace, KMP_SOURCE,
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
const label = (id: string, textExpr: string, position: number[], connect?: [string, string], highlightExpr?: string) =>
    ({ id, type: 'expression_label', position, textExpr, ...(connect ? { connectTo: { object: connect[0], indexExpr: connect[1] } } : {}), ...(highlightExpr ? { highlightExpr } : {}) });
/** LaTeX inside a single-quoted lesson string: the app keeps its contents literally, so backslashes stay single. */
const TEX = (latex: string) => latex;
const unset = (col: string, name = col) => `concat('${name} = ', ${tr(col)} < 0 ? 'unset' : ${tr(col)})`;

// ── The problem each scene solves. It is the scene's caption on entry (step 0) and
// opens its doc, before the technique. Example answers come from the traces, so
// the doc always states what the player will show. ──
const end = (trace: Frame[]) => trace.at(-1)!;
const list = (v: unknown) => `[${(v as unknown[]).join(', ')}]`;
const PROBLEMS: Record<string, { problem: string; example?: string }> = {
    'prefix-sum': { problem: 'Given an array, answer many queries of the form "what is the sum of nums[i..j]?"',
        example: `nums = ${list(IN.prefix.nums)}: ${IN.prefix.queries.map(([i, j]) => `sum(${i}..${j}) = ${IN.prefix.nums.slice(i, j + 1).reduce((a, b) => a + b, 0)}`).join(', ')}.` },
    'two-pointers': { problem: 'Given a sorted array and a target, find two numbers that add up to the target, and return their indices.',
        example: (() => { const f = end(twoPointersTrace(IN.twoPointers.nums, IN.twoPointers.target)); return `nums = ${list(IN.twoPointers.nums)}, target = ${IN.twoPointers.target} → indices ${f.left} and ${f.right} (${IN.twoPointers.nums[f.left as number]} + ${IN.twoPointers.nums[f.right as number]}).`; })() },
    'sliding-window': { problem: 'Find the largest sum of any k consecutive numbers in an array.',
        example: (() => { const f = end(slidingWindowTrace(IN.slidingWindow.nums, IN.slidingWindow.k)); return `nums = ${list(IN.slidingWindow.nums)}, k = ${IN.slidingWindow.k} → ${f.best}, from nums[${f.left}..${f.right}].`; })() },
    'rotated-search': { problem: 'A sorted array was rotated at an unknown point. Find the index of a target value in O(log n) time.',
        example: `nums = ${list(IN.rotated.nums)}, target = ${IN.rotated.target} → index ${end(rotatedSearchTrace(IN.rotated.nums, IN.rotated.target)).found}.` },
    'merge-intervals': { problem: 'Given a list of [start, end] intervals, merge every group that overlaps and return the result.',
        example: (() => { const f = end(mergeIntervalsTrace(IN.intervals.input)); return `${IN.intervals.input.map(iv => `[${iv}]`).join(' ')} → ${(f.mStarts as number[]).map((st, k) => `[${st},${(f.mEnds as number[])[k]}]`).join(' ')}.`; })() },
    'greedy': { problem: 'Each value is the longest jump allowed from that index. Starting at index 0, can you reach the last index?',
        example: `nums = ${list(IN.greedy.nums)} → ${end(greedyTrace(IN.greedy.nums)).ok ? 'True' : 'False'}: every path gets stuck on the 0.` },
    'bit-manipulation': { problem: 'Every number appears exactly twice except one. Find it, using O(1) extra space.',
        example: `nums = ${list(IN.bits.nums)} → ${end(bitsTrace(IN.bits.nums)).result}.` },
    'string-matching': { problem: 'Find every index where a pattern occurs in a text, overlaps included.',
        example: `text = "${IN.kmp.text}", p = "${IN.kmp.pattern}" → ${list(end(kmpTrace(IN.kmp.text, IN.kmp.pattern)).hits)}.` },
    'trie': { problem: 'Store a set of words so you can quickly answer "is this a word?" and "does any word start with this prefix?"' },
    'monotonic-stack': { problem: 'Given daily temperatures, find for each day how many days you must wait for a warmer one (0 if never).',
        example: `temps = ${list(IN.monotonic.temps)} → ${list(end(monotonicStackTrace(IN.monotonic.temps)).answer)}.` },
    'monotonic-queue': { problem: 'Return the maximum of every window of k consecutive numbers.',
        example: `nums = ${list(IN.monoQueue.nums)}, k = ${IN.monoQueue.k} → ${list(end(monotonicQueueTrace(IN.monoQueue.nums, IN.monoQueue.k)).out)}.` },
    'top-k': { problem: 'Find the k-th largest element of an unsorted array.' },
    'fast-slow': { problem: 'An array holds n + 1 values from 1 to n, so one value repeats. Find it without changing the array and with O(1) extra space.',
        example: `nums = ${list(IN.fastSlow.nums)} → ${end(fastSlowTrace(IN.fastSlow.nums)).slow}.` },
    'linked-list-reversal': { problem: 'Reverse a singly linked list in place and return its new head.' },
    'tree-traversal': { problem: 'Visit every node of a binary tree in a chosen order: preorder, inorder or postorder.' },
    'dfs': { problem: 'List every root-to-leaf path in a binary tree.' },
    'bfs': { problem: "Return a binary tree's values level by level, top to bottom." },
    'matrix-traversal': { problem: 'In a grid of land (1) and water (0), count the islands: groups of land cells joined up, down, left or right.' },
    'topological-sort': { problem: 'Courses have prerequisites. Find an order in which to take every course, or report that none exists.' },
    'shortest-path': { problem: 'A network has directed edges with travel times. How long does a signal from one node take to reach every node?' },
    'union-find': { problem: 'Given n nodes and a list of undirected edges, count the connected components.',
        example: `n = ${IN.unionFind.n}, edges = ${IN.unionFind.edges.map(e => `${e[0]}–${e[1]}`).join(', ')} → ${end(unionFindTrace(IN.unionFind.n, IN.unionFind.edges)).count}.` },
    'recursion': { problem: 'Compute x to the power n using O(log n) multiplications.' },
    'backtracking': { problem: 'Generate every permutation of a list of distinct numbers.' },
    'dynamic-programming': { problem: 'Houses in a row each hold some money, and you cannot rob two neighbours. What is the most you can rob?',
        example: `houses = ${list(IN.dp.houses)} → ${(end(houseRobberTrace(IN.dp.houses)).dp as number[]).at(-1)}.` },
};
/** Put the problem (and its worked example) right under the title, before the technique. */
function withProblem(id: string, markdown: string): string {
    const pr = PROBLEMS[id];
    if (!pr) throw new Error(`no problem statement for scene ${id}`);
    const block = `**Problem:** ${pr.problem}\n\n${pr.example ? `**Example:** ${pr.example}\n\n` : ''}`;
    return markdown.replace(/^(# [^\n]*\n\n)/, `$1${block}`);
}

interface PatternScene {
    id: string; title: string; markdown: string; prompt: string; file: string; source: string;
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
        id: p.id, title: p.title, description: PROBLEMS[p.id]!.problem, range: RANGE,
        camera: { position: [x, 0, 16], target: [x, 0, 0] },
        data: { input: [p.input], trace: p.trace }, markdown: withProblem(p.id, p.markdown), prompt: p.prompt, elements: [grid],
        steps: [{
            id: 'run', title: 'Run the algorithm', description: 'Follow the highlighted code line with the execution player.',
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: p.trace.length - 1, step: 1, default: 0 }],
            add: p.elements.flatMap(withTitle),
            info: [{ id: 'current-action', title: 'Current action', content: `{{${tr('message')}}}`, position: 'top-center' }],
        }],
        stepPlayback: { slider: 'frame', intervalMs: 1200 },
        codeRef: { file: p.id, lineExpr: tr('line') },
    });
    codeFiles.push({
        id: p.id, path: `patterns/${p.file}`, language: 'python', source: p.source,
        locations: p.trace.map((f, snapshot) => ({ line: f.line, scene: p.id, step: 'run', snapshot, label: `${p.title} · ${f.message}` })),
    });
}
function placeholder(id: string, title: string, markdown: string, prompt: string) {
    scenes.push({
        id, title, description: PROBLEMS[id]!.problem, range: RANGE, camera: { position: [1.5, 0, 15], target: [1.5, 0, 0] },
        markdown: withProblem(id, markdown), prompt,
        elements: [grid, { id: 'placeholder', type: 'text', text: 'Visualization coming soon', position: [1.5, 0, 0], color: BLUE }],
    });
}

const MD_TAIL = 'Use the execution player to step through, or open **Code** to see the active Python line. The code is display-only; every view reads the same recorded execution snapshot.';

// ── Overview ──
scenes.push({
    id: 'overview', title: 'Which pattern fits?', description: 'Recognize which pattern a problem is asking for.', range: RANGE,
    camera: { position: [1.5, 0, 15], target: [1.5, 0, 0] }, elements: [grid,
        { id: 'title', type: 'text', text: 'Interview algorithm patterns', position: [1.5, 0.6, 0], color: GOLD },
        { id: 'subtitle', type: 'text', text: 'Spot the signal, pick the plan', position: [1.5, -0.6, 0], color: BLUE }],
    markdown: `# Which pattern fits?

Most interview problems are variations on a small set of patterns. The skill is recognizing the **signal** in the problem statement and reaching for the matching plan.

| Signal in the problem | Pattern | Typical cost |
| --- | --- | --- |
| Many range-sum queries on a fixed array | Running totals (prefix sum) | O(n) build, O(1) per query |
| Sorted array, find a pair or triple | Squeeze from both ends (two pointers) | O(n) |
| Best contiguous subarray or substring | Slide a window (sliding window) | O(n) |
| Sorted data with a twist (rotated, 2D) | Halve the search (binary search) | O(log n) |
| Intervals, meetings, ranges | Merge overlapping ranges (intervals) | O(n log n) |
| Choices where the locally best step is always safe | Take the best step now (greedy) | Often O(n) or O(n log n) |
| Pairs cancelling, parity, bitmask subsets | Flip bits (bit manipulation) | O(n), O(1) space |
| Find a pattern inside a long text | Find a word fast (KMP string matching) | O(n + m) |
| Prefix lookups over many words | Share prefixes (trie) | O(word length) |
| "Next greater / smaller element" | Next bigger value (monotonic stack) | O(n) |
| Max or min of every window | Max of every window (monotonic queue) | O(n) |
| k largest, k smallest, k most frequent | Keep the best k (heap) | O(n log k) |
| Cycle, or "find the duplicate" in O(1) space | Tortoise and hare (fast & slow pointers) | O(n), O(1) space |
| Reverse or reorder linked-list nodes | Flip the links (linked list reversal) | O(n), O(1) space |
| Visit every tree node in a set order | Walk a tree (traversal orders) | O(n) |
| Explore every path or component | Go deep first (DFS) | O(V + E) |
| Shortest path in steps, level by level | Go wide first (BFS) | O(V + E) |
| Grid of cells, islands, flood fill | Explore a grid (matrix traversal) | O(rows × cols) |
| Prerequisites, build order | Order by dependencies (topological sort) | O(V + E) |
| Cheapest path with weighted edges | Cheapest route (Dijkstra) | O((V + E) log V) |
| Connectivity as edges arrive, counting groups | Group connected items (union-find) | ≈ O(1) per operation |
| A problem built from smaller copies of itself | Solve smaller copies (recursion) | Depends on the recurrence |
| All permutations, subsets, placements | Try, undo, retry (backtracking) | Exponential, pruned |
| Optimal value from overlapping subproblems | Reuse answers (dynamic programming) | Subproblems × work each |

Each following scene runs one pattern on a small example. Scenes marked *coming soon* are placeholders until AlgeBench has the data structure they need.`,
    prompt: 'Help the learner recognize which pattern fits a problem. Ask them to name the signal (sorted input, contiguous range, cycle, next-greater, overlapping subproblems) before naming a pattern. Encourage predicting the pattern before revealing it.',
});

// ── Prefix sum ──
pattern({
    id: 'prefix-sum', title: 'Running totals (prefix sum)', file: 'prefix_sum.py', source: PREFIX_SOURCE,
    input: { nums: IN.prefix.nums }, trace: prefixSumTrace(IN.prefix.nums, IN.prefix.queries),
    markdown: `# Running totals (prefix sum)

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
    id: 'two-pointers', title: 'Squeeze from both ends (two pointers)', file: 'two_pointers.py', source: TWO_POINTERS_SOURCE,
    input: { nums: IN.twoPointers.nums, target: IN.twoPointers.target }, trace: twoPointersTrace(IN.twoPointers.nums, IN.twoPointers.target),
    markdown: `# Squeeze from both ends (two pointers)

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
        // total is linked to target; both, and the comparison, light up on a match.
        ...((hit: string) => [
            { ...label('total', `concat('total = ', ${tr('hasTotal')} == 1 ? ${tr('total')} : '—')`, [-4, -2.6, 0], undefined, hit), connectTo: { object: 'target', pinned: true },
              tooltipExpr: `${tr('hasTotal')} == 1 ? concat('${TEX(String.raw`\text{total} = \text{nums}[\text{left}] + \text{nums}[\text{right}] = `)}', arrayAt(${inp('nums')}, ${tr('left')}), ' + ', arrayAt(${inp('nums')}, ${tr('right')}), ' = ', ${tr('total')}) : '${TEX(String.raw`\text{total} = \text{nums}[\text{left}] + \text{nums}[\text{right}]`)}'` },
            label('target', `concat('target = ', ${inp('target')})`, [4, -2.6, 0], undefined, hit),
            { ...label('compare', `${tr('hasTotal')} == 1 ? concat(${tr('total')}, ${tr('total')} < ${inp('target')} ? ' < ' : (${tr('total')} > ${inp('target')} ? ' > ' : ' = '), ${inp('target')}, ${tr('total')} < ${inp('target')} ? ': move left' : (${tr('total')} > ${inp('target')} ? ': move right' : ': found')) : 'compare: —'`, [4, -2.6, 0], undefined, hit),
              tooltipExpr: `${tr('hasTotal')} == 1 ? (${tr('total')} < ${inp('target')} ? concat(${tr('total')}, '${TEX(String.raw` < `)}', ${inp('target')}, '${TEX(String.raw` \;\Rightarrow\; \text{left} \mathrel{+}= 1`)}') : (${tr('total')} > ${inp('target')} ? concat(${tr('total')}, '${TEX(String.raw` > `)}', ${inp('target')}, '${TEX(String.raw` \;\Rightarrow\; \text{right} \mathrel{-}= 1`)}') : concat(${tr('total')}, ' = ', ${inp('target')}, '${TEX(String.raw` \;\Rightarrow\; \text{found at } (`)}', ${tr('left')}, ', ', ${tr('right')}, ')'))) : '${TEX(String.raw`\text{compare total with target}`)}'` },
        ])(`${tr('hasTotal')} == 1 and ${tr('total')} == ${inp('target')}`),
    ],
});

// ── Sliding window ──
pattern({
    id: 'sliding-window', title: 'Slide a window (sliding window)', file: 'sliding_window.py', source: SLIDING_WINDOW_SOURCE,
    input: { nums: IN.slidingWindow.nums, k: IN.slidingWindow.k }, trace: slidingWindowTrace(IN.slidingWindow.nums, IN.slidingWindow.k),
    markdown: `# Slide a window (sliding window)

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
    id: 'fast-slow', title: 'Tortoise and hare (fast & slow pointers)', file: 'fast_slow.py', source: FAST_SLOW_SOURCE,
    input: { nums: fsNums }, trace: fastSlowTrace(fsNums),
    markdown: `# Tortoise and hare (fast & slow pointers)

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
    id: 'monotonic-stack', title: 'Next bigger value (monotonic stack)', file: 'monotonic_stack.py', source: MONOTONIC_STACK_SOURCE,
    input: { temps: IN.monotonic.temps }, trace: monotonicStackTrace(IN.monotonic.temps), cameraX: 1,
    markdown: `# Next bigger value (monotonic stack)

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
    id: 'rotated-search', title: 'Halve the search (binary search)', file: 'rotated_search.py', source: ROTATED_SEARCH_SOURCE,
    input: { nums: IN.rotated.nums, target: IN.rotated.target }, trace: rotatedSearchTrace(IN.rotated.nums, IN.rotated.target),
    markdown: `# Halve the search (binary search)

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
const ivs = IN.intervals.input;
/** Gantt view of the same state: input spans on two staggered lanes, the merged result growing on lane 0. */
const intervalChart = {
    id: 'timeline', type: 'chart', origin: [-5, -4.5, 0], size: [11, 2.2], xDomain: [0, 24], yDomain: [-0.6, 3.6],
    axes: [{ ticks: 5 }, { labels: [] }],
    intervals: [
        {
            label: 'input', color: '#74d0c2', countExpr: `arrayCount(${tr('starts')})`,
            startExpr: `arrayAt(${tr('starts')}, i)`, endExpr: `arrayAt(${tr('ends')}, i)`, laneExpr: '2 + mod(i, 2)',
            highlightExpr: `i == ${tr('k')}`,
        },
        {
            label: 'merged', color: '#b69bea', countExpr: tr('m'),
            startExpr: `arrayAt(${tr('mStarts')}, i)`, endExpr: `arrayAt(${tr('mEnds')}, i)`, lane: 0,
            highlightExpr: `i == ${tr('m')} - 1 and (${tr('line')} == 6 or ${tr('line')} == 5)`,
            labelExpr: `concat(arrayAt(${tr('mStarts')}, i), '–', arrayAt(${tr('mEnds')}, i))`,
        },
    ],
};
pattern({
    id: 'merge-intervals', title: 'Merge overlapping ranges (intervals)', file: 'merge_intervals.py', source: MERGE_INTERVALS_SOURCE,
    input: { intervals: ivs.map(([s, e]) => `[${s},${e}]`) }, trace: mergeIntervalsTrace(ivs),
    markdown: `# Merge overlapping ranges (intervals)

**Signal:** meetings, bookings, ranges, or anything with a start and an end.

Sort by start time. After sorting, an interval can only overlap the group immediately before it, so a single sweep suffices: if the next interval starts at or before the last merged end, extend that end; otherwise start a new group. The chart below draws the same state as bars: input intervals on the upper lanes, and the merged groups growing on the bottom lane as the sweep runs.

Sorting dominates: O(n log n) time.

${MD_TAIL}

**Practice:** Merge Intervals (56), Insert Interval (57), Non-overlapping Intervals (435).`,
    prompt: 'Explain why sorting by start means only the last merged interval can overlap the next one. Ask the learner to predict whether the next interval extends the last group or starts a new one.',
    elements: [
        intervalChart,
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
    id: 'dynamic-programming', title: 'Reuse answers (dynamic programming)', file: 'house_robber.py', source: HOUSE_ROBBER_SOURCE,
    input: { houses: IN.dp.houses }, trace: houseRobberTrace(IN.dp.houses),
    markdown: `# Reuse answers (dynamic programming)

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


// ── Monotonic queue ──
pattern({
    id: 'monotonic-queue', title: 'Max of every window (monotonic queue)', file: 'monotonic_queue.py', source: MONOTONIC_QUEUE_SOURCE,
    input: { nums: IN.monoQueue.nums, k: IN.monoQueue.k }, trace: monotonicQueueTrace(IN.monoQueue.nums, IN.monoQueue.k),
    markdown: `# Max of every window (monotonic queue)

**Signal:** the maximum (or minimum) of every window of size k, or "the best value within the last k steps".

Keep a **deque of indices** whose values decrease from front to back. A new value first evicts every smaller value from the back: those can never be a maximum while the new one is in the window. The front is then the window maximum, once indices that slid out of the window are dropped from the front.

Each index enters and leaves the deque at most once, so all windows cost O(n) instead of O(n·k). It is the monotonic stack's idea with an exit at both ends. Window size here: **${IN.monoQueue.k}**.

${MD_TAIL}

**Practice:** Sliding Window Maximum (239), Shortest Subarray with Sum at Least K (862), Constrained Subsequence Sum (1425).`,
    prompt: 'Explain why smaller values behind a new value can be discarded, and why the front is the maximum. Ask the learner to predict which indices the next value evicts.',
    elements: [
        array('nums', 'nums', [-4.5, 2.3, 0], {
            from: inp('nums'), highlightExpr: `idx >= ${tr('left')} and idx <= ${tr('i')}`,
            markers: [marker('i', tr('i')), marker('dq[0]', tr('front'), PINK)],
        }),
        array('deque', 'deque', [-4.5, -0.2, 0], { from: tr('dq'), color: BLUE, showIndices: false }),
        array('out', 'out', [-4.5, -2.4, 0], { from: tr('out'), color: '#b69bea' }),
        label('i', unset('i'), [5, -3.9, 0], ['nums', tr('i')]),
        label('k', `concat('k = ', ${inp('k')})`, [5, -3.9, 0]),
    ],
});

// ── Greedy ──
pattern({
    id: 'greedy', title: 'Take the best step now (greedy)', file: 'greedy.py', source: GREEDY_SOURCE,
    input: { nums: IN.greedy.nums }, trace: greedyTrace(IN.greedy.nums),
    markdown: `# Take the best step now (greedy)

**Signal:** a sequence of choices where the locally best choice never hurts later ones, often "can you reach…", "minimum number of…", or scheduling.

Jump game: each value is the longest jump allowed from that index. Instead of exploring every path, keep one number, **reach**: the farthest index any path found so far can get to. Walking left to right, every index up to reach is reachable (gold), and each one may push reach farther. If the walk ever steps past reach, the rest is cut off.

A greedy solution needs an argument for why the local choice is safe; here, any index within reach is as good as any other for extending it. O(n) time, O(1) space.

${MD_TAIL}

**Practice:** Jump Game (55), Jump Game II (45), Gas Station (134), Non-overlapping Intervals (435).`,
    prompt: 'Explain why tracking only the farthest reach is enough, and why greedy needs a safety argument. Ask the learner to predict whether the walk will get stuck before it does.',
    elements: [
        array('nums', 'nums', [-4.5, 1.2, 0], {
            from: inp('nums'), highlightExpr: `idx <= ${tr('reach')}`,
            markers: [marker('i', tr('i')), marker('reach', tr('reach'), PINK)],
        }),
        label('i', unset('i'), [-4, -2.6, 0], ['nums', tr('i')]),
        label('reach', `concat('reach = ', ${tr('reach')})`, [-4, -2.6, 0], ['nums', tr('reach')]),
        label('verdict', `concat('can reach end = ', ${tr('ok')} < 0 ? '?' : (${tr('ok')} == 1 ? 'True' : 'False'))`, [4, -2.6, 0]),
    ],
});

// ── Bit manipulation ──
pattern({
    id: 'bit-manipulation', title: 'Flip bits (bit manipulation)', file: 'single_number.py', source: BITS_SOURCE,
    input: { nums: IN.bits.nums }, trace: bitsTrace(IN.bits.nums),
    markdown: `# Flip bits (bit manipulation)

**Signal:** "appears once / twice", parity, subsets as bitmasks, powers of two, or an O(1)-space requirement on integers.

XOR has two facts that do all the work: \`a ^ a = 0\` and \`a ^ 0 = a\`, and it does not care about order. XOR every number together and each pair cancels, leaving the number that appears once. Watch the result's bits: each step flips exactly the bits where x has a 1 (gold).

Other everyday tricks: \`x & (x − 1)\` clears the lowest set bit, \`x & −x\` isolates it, and the bits of a counter from 0 to 2ⁿ − 1 enumerate every subset.

${MD_TAIL}

**Practice:** Single Number (136), Number of 1 Bits (191), Counting Bits (338), Missing Number (268), Subsets (78, as bitmasks).`,
    prompt: 'Explain XOR cancellation bit by bit. Ask the learner to predict the result bits before each step.',
    elements: [
        array('nums', 'nums', [-4.5, 2.5, 0], { from: inp('nums'), highlightExpr: `idx == ${tr('k')}`, markers: [marker('k', tr('k'))] }),
        array('x-bits', 'x bits', [-2, 0.3, 0], { from: tr('xBits'), showIndices: false, highlightExpr: 'value == 1' }),
        array('result-bits', 'result bits', [-2, -1.2, 0], { from: tr('rBits'), color: '#b69bea', showIndices: false }),
        label('x', `concat('x = ', ${tr('k')} < 0 ? 'unset' : ${tr('x')})`, [4, -0.4, 0], ['nums', tr('k')]),
        label('result', `concat('result = ', ${tr('result')})`, [4, -0.4, 0]),
    ],
});

// ── String matching ──
pattern({
    id: 'string-matching', title: 'Find a word fast (KMP string matching)', file: 'kmp.py', source: KMP_SOURCE,
    input: { text: [...IN.kmp.text], pattern: [...IN.kmp.pattern] }, trace: kmpTrace(IN.kmp.text, IN.kmp.pattern),
    markdown: `# Find a word fast (KMP string matching)

**Signal:** find every occurrence of a pattern in a text, repeated-substring questions, or "longest prefix that is also a suffix".

The naive search restarts one character later after every mismatch: O(n·m). KMP first precomputes, for every prefix of the pattern, the length of its longest proper **border** (a prefix that is also a suffix): the \`lps\` table. On a mismatch it keeps that border as already matched instead of starting over, so the text pointer **never moves backwards**. Total cost O(n + m).

Phase 1 builds \`lps\` from the pattern itself; phase 2 scans the text. Gold text cells are the stretch currently matched by the pattern's prefix.

${MD_TAIL}

**Practice:** Find the Index of the First Occurrence in a String (28), Repeated Substring Pattern (459), Shortest Palindrome (214).`,
    prompt: 'Explain borders and the lps table, and why the text pointer never moves back. Ask the learner to predict k after each fallback.',
    elements: [
        array('text', 'text', [-5.6, 2.6, 0], {
            from: inp('text'), itemType: 'character', cellSize: 0.8, fontSize: 13, indexFontSize: 8,
            highlightExpr: `idx >= ${tr('lo')} and idx <= ${tr('hi')}`, markers: [marker('i', tr('i'))],
        }),
        array('pattern', 'p', [-5.6, 0.3, 0], {
            from: inp('pattern'), itemType: 'character', cellSize: 0.8, fontSize: 13, indexFontSize: 8,
            highlightExpr: `${tr('phase')} == 2 ? idx < ${tr('k')} : (idx == ${tr('pi')} or idx == ${tr('k')})`,
            markers: [marker('i', tr('pi'), BLUE), marker('k', tr('k'), PINK, `${tr('phase')} == 1 or ${tr('k')} < arrayCount(${inp('pattern')})`)],
        }),
        array('lps', 'lps', [-5.6, -1.1, 0], { from: tr('lps'), cellSize: 0.8, fontSize: 13, color: '#b69bea', showIndices: false }),
        array('hits', 'hits', [-5.6, -3.0, 0], { from: tr('hits'), cellSize: 0.8, fontSize: 13, color: TEAL, showIndices: false }),
        label('k', `concat('k = ', ${tr('k')})`, [4.5, -0.4, 0], ['pattern', tr('k')]),
        label('phase', `concat('phase = ', ${tr('phase')} == 1 ? 'build lps' : 'search')`, [4.5, -0.4, 0]),
    ],
});

// ── Union-find ──
pattern({
    id: 'union-find', title: 'Group connected items (union-find)', file: 'union_find.py', source: UNION_FIND_SOURCE,
    input: { from: IN.unionFind.edges.map(e => e[0]), to: IN.unionFind.edges.map(e => e[1]) }, trace: unionFindTrace(IN.unionFind.n, IN.unionFind.edges),
    markdown: `# Group connected items (union-find)

**Signal:** "are these connected?", counting groups or islands as edges arrive, detecting a cycle in an undirected graph, or Kruskal's minimum spanning tree.

Each node points to a **parent**; a node that points to itself is a **root** (gold) and names its group. \`find\` climbs parent pointers to the root. Joining an edge's two groups is one assignment: point one root at the other. If both ends already share a root, the edge adds nothing, which is exactly how a redundant edge or cycle is detected.

The parent array *is* the forest: each column is a node, its value is the node it points to. This version climbs without shortcuts; adding **path compression** (point every visited node straight at the root) and **union by rank** makes each operation nearly O(1).

${MD_TAIL}

**Practice:** Number of Provinces (547), Redundant Connection (684), Accounts Merge (721), Number of Connected Components in an Undirected Graph (323).`,
    prompt: 'Explain the parent array as a forest, find as climbing to the root, and union as linking roots. Ask the learner to predict each find result before the climb.',
    elements: [
        array('edge-from', 'edge a', [-4.5, 2.9, 0], { from: inp('from'), showIndices: false, highlightExpr: `idx == ${tr('e')}`, markers: [marker('edge', tr('e'))] }),
        array('edge-to', 'edge b', [-4.5, 2.05, 0], { from: inp('to'), highlightExpr: `idx == ${tr('e')}` }),
        array('parent', 'parent', [-4.5, -0.4, 0], {
            from: tr('parent'), color: BLUE, highlightExpr: 'value == idx',
            markers: [marker('x', tr('x'), PINK), marker('ra', tr('ra')), marker('rb', tr('rb'))],
        }),
        label('a', unset('a'), [-4, -3.2, 0], ['parent', tr('a')]),
        label('b', unset('b'), [-4, -3.2, 0], ['parent', tr('b')]),
        label('count', `concat('components = ', ${tr('count')})`, [4, -3.2, 0]),
    ],
});

// ── Placeholders for patterns that need data structures AlgeBench does not render yet ──
const SOON = 'This pattern needs a data structure AlgeBench cannot draw yet, so this scene is a placeholder.';
placeholder('linked-list-reversal', 'Flip the links (linked list reversal)', `# Flip the links (linked list reversal)

**Signal:** reverse a list or a sublist, swap pairs, or reorder nodes, with O(1) extra space.

Walk the list with three pointers, \`prev\`, \`curr\` and \`next\`. Save \`curr.next\`, point \`curr.next\` back at \`prev\`, then advance both. Each node is rewired once: O(n) time, O(1) space.

${SOON} *(Needs a linked-list object with nodes and pointer arrows.)*

**Practice:** Reverse Linked List (206), Reverse Linked List II (92), Swap Nodes in Pairs (24).`,
    'Explain the prev/curr/next dance and why saving next first matters. This scene has no visualization yet.');
placeholder('top-k', 'Keep the best k (heap)', `# Keep the best k (heap)

**Signal:** the k largest, k smallest, or k most frequent items.

Keep a **min-heap of size k**. Push each item; when the heap grows past k, pop its smallest. The heap then holds the k largest, and its root is the k-th largest. O(n log k) time, which beats sorting when k is small.

${SOON} *(Needs a general heap view with push and pop.)*

**Practice:** Kth Largest Element in an Array (215), Top K Frequent Elements (347), Find K Pairs with Smallest Sums (373).`,
    'Explain why a min-heap (not a max-heap) keeps the k largest. This scene has no visualization yet.');
placeholder('tree-traversal', 'Walk a tree (traversal orders)', `# Walk a tree (traversal orders)

**Signal:** process every node of a tree in a specific order.

- **Preorder** (node, left, right): copy or serialize a tree, print root-to-leaf paths.
- **Inorder** (left, node, right): visits a binary search tree in sorted order.
- **Postorder** (left, right, node): compute something from both children first, such as height or the maximum path sum.

${SOON} *(Needs a binary-tree object.)*

**Practice:** Binary Tree Paths (257, preorder), Kth Smallest Element in a BST (230, inorder), Binary Tree Maximum Path Sum (124, postorder).`,
    'Explain the three orders and what each is good for. This scene has no visualization yet.');
placeholder('dfs', 'Go deep first (DFS)', `# Go deep first (DFS)

**Signal:** explore every path, find connected components, detect cycles, or order dependencies.

Follow one branch as far as it goes before backing up, using recursion or an explicit stack. Mark nodes as visited so cycles do not loop forever. O(V + E).

${SOON} *(Needs a graph object.)*

**Practice:** Clone Graph (133), Path Sum II (113), Course Schedule II (210).`,
    'Explain recursion vs an explicit stack, and the visited set. This scene has no visualization yet.');
placeholder('bfs', 'Go wide first (BFS)', `# Go wide first (BFS)

**Signal:** shortest path in an unweighted graph, or anything "level by level".

Start from the source, push it on a **queue**, and repeatedly pop the front and push its unvisited neighbours. Nodes come out in order of distance, so the first time you reach a node is along a shortest path. O(V + E).

${SOON} *(Needs a graph or tree object and a queue.)*

**Practice:** Binary Tree Level Order Traversal (102), Rotting Oranges (994), Word Ladder (127).`,
    'Explain why a queue gives shortest paths in unweighted graphs. This scene has no visualization yet.');
placeholder('matrix-traversal', 'Explore a grid (matrix traversal)', `# Explore a grid (matrix traversal)

**Signal:** a 2D grid: islands, flood fill, regions, shortest moves.

Treat each cell as a node whose neighbours are the cells up, down, left and right, then run DFS or BFS. Check bounds before moving and mark cells as visited (often by overwriting them). O(rows × cols).

${SOON} *(Needs a 2D grid object with per-cell state.)*

**Practice:** Flood Fill (733), Number of Islands (200), Surrounded Regions (130).`,
    'Explain the grid-as-graph view and neighbour iteration. This scene has no visualization yet.');
placeholder('backtracking', 'Try, undo, retry (backtracking)', `# Try, undo, retry (backtracking)

**Signal:** generate all permutations, subsets or combinations, or place pieces under constraints.

Build a candidate one choice at a time. After exploring a choice, **undo it** and try the next. Prune any branch that already breaks a constraint. The search is exponential in the worst case; pruning is what makes it practical.

${SOON} *(Needs a recursion-tree view.)*

**Practice:** Permutations (46), Subsets (78), N-Queens (51).`,
    'Explain choose / explore / un-choose and pruning. This scene has no visualization yet.');

placeholder('trie', 'Share prefixes (trie)', `# Share prefixes (trie)

**Signal:** autocomplete, "starts with", word search over many words, or longest common prefix.

A **trie** stores words character by character down a tree, so words that share a prefix share a path. Insert and lookup cost O(length of the word), independent of how many words are stored.

${SOON} *(Needs a tree object with labelled edges.)*

**Practice:** Implement Trie (208), Design Add and Search Words Data Structure (211), Word Search II (212).`,
    'Explain shared prefixes and the end-of-word marker. This scene has no visualization yet.');
placeholder('topological-sort', 'Order by dependencies (topological sort)', `# Order by dependencies (topological sort)

**Signal:** prerequisites, build order, course schedules: "what order satisfies every dependency?", or "is there a cycle?".

Kahn's algorithm counts each node's incoming edges, starts a queue with every node that has none, and repeatedly removes a node and decrements its neighbours' counts, enqueuing any that reach zero. If some nodes never reach zero, the graph has a cycle. O(V + E).

${SOON} *(Needs a directed graph object.)*

**Practice:** Course Schedule (207), Course Schedule II (210), Alien Dictionary (269).`,
    'Explain in-degrees and why leftover nodes mean a cycle. This scene has no visualization yet.');
placeholder('shortest-path', 'Cheapest route (Dijkstra)', `# Cheapest route (Dijkstra)

**Signal:** shortest or cheapest path when edges have non-negative weights: network delay, cheapest flights, minimum effort.

Dijkstra keeps a **min-heap** of (distance, node). It repeatedly takes the closest unsettled node, which is final, and relaxes its edges. It is BFS with a priority queue in place of a plain queue. O((V + E) log V).

${SOON} *(Needs a weighted graph object and a heap view.)*

**Practice:** Network Delay Time (743), Path with Minimum Effort (1631), Cheapest Flights Within K Stops (787).`,
    'Explain why the closest unsettled node is final with non-negative weights. This scene has no visualization yet.');
placeholder('recursion', 'Solve smaller copies (recursion)', `# Solve smaller copies (recursion)

**Signal:** the problem contains smaller copies of itself: trees, nested structures, divide and conquer (merge sort, fast power).

Write the **base case** first, then assume the recursive call already solves the smaller problem and combine its answer. Each call gets its own frame on the call stack, so recursion depth costs memory. Memoizing repeated calls turns it into dynamic programming.

${SOON} *(Needs a recursion-tree view alongside the call stack.)*

**Practice:** Pow(x, n) (50), Merge Two Sorted Lists (21), Sort an Array (912, merge sort).`,
    'Explain base case, trusting the recursive call, and the call stack. This scene has no visualization yet.');

// Simplest first: arrays, strings, stack/queue/heap, linked structures, trees and graphs, then search over choices.
const ORDER = ['overview',
    'prefix-sum', 'two-pointers', 'sliding-window', 'rotated-search', 'merge-intervals', 'greedy', 'bit-manipulation',   // arrays
    'string-matching', 'trie',                                                                                        // strings
    'monotonic-stack', 'monotonic-queue', 'top-k',                                                                    // stack, queue, heap
    'fast-slow', 'linked-list-reversal',                                                                              // linked structures
    'tree-traversal', 'dfs', 'bfs', 'matrix-traversal', 'topological-sort', 'shortest-path', 'union-find',            // trees and graphs
    'recursion', 'backtracking', 'dynamic-programming'];                                                              // searching over choices                                                // searching over choices
scenes.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
codeFiles.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
process.stdout.write(JSON.stringify({ title: 'Algorithm patterns for interviews', codeFiles, scenes }));
