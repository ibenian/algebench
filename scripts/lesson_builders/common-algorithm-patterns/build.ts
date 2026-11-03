// Builds scenes/draft/common-algorithm-patterns.json from the display-only sources and
// execution traces in algorithms.ts (beside this file). Prints JSON to stdout;
// build.py (beside this file) formats and writes it.
import {
    prefixSumTrace, PREFIX_SOURCE, twoPointersTrace, TWO_POINTERS_SOURCE, slidingWindowTrace, SLIDING_WINDOW_SOURCE,
    fastSlowTrace, fastSlowProofTrace, rhoShape, FAST_SLOW_SOURCE, monotonicStackTrace, MONOTONIC_STACK_SOURCE, rotatedSearchTrace, ROTATED_SEARCH_SOURCE,
    mergeIntervalsTrace, MERGE_INTERVALS_SOURCE, houseRobberTrace, HOUSE_ROBBER_SOURCE, kadaneTrace, KADANE_SOURCE, lcsTrace, LCS_SOURCE, topKTrace, TOP_K_SOURCE, trieTrace, trieSearchTrace, TRIE_SOURCE, linkedListTrace, LINKED_LIST_SOURCE, treeTraversalTrace, TREE_TRAVERSAL_SOURCE, islandsTrace, ISLANDS_SOURCE, powerTrace, fibTrace, RECURSION_SOURCE, subsetsTrace, SUBSETS_SOURCE, topoTrace, topoDfsTrace, TOPO_SOURCE, topoLine, twoSumTrace, subarraySumTrace, HASH_MAP_SOURCE, hashLine,
    monotonicQueueTrace, MONOTONIC_QUEUE_SOURCE, greedyTrace, GREEDY_SOURCE, bitsTrace, BITS_SOURCE,
    unionFindTrace, UNION_FIND_SOURCE, kmpTrace, KMP_SOURCE,
} from './algorithms.js';
import type { Frame } from './algorithms.js';
import { PATTERN_INPUTS as IN } from './inputs.js';

type Json = Record<string, unknown>;
/**
 * How every array draws its cell text, index tags and title: 'screen' labels face the camera; 'plane'
 * draws them on the array's face, so they tilt, scale and occlude with it. One switch for the lesson:
 * plane by default; ARRAY_TEXT=screen ./run.sh scripts/lesson_builders/common-algorithm-patterns/build.py builds the other.
 */
const ARRAY_TEXT: 'screen' | 'plane' = (process.env.ARRAY_TEXT === 'screen' ? 'screen' : 'plane');
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
        // The array draws its own row title just left of cell 0, so titles stay attached to their rows and consistent.
        id, type: 'array', itemType: 'number', origin, cellSize: 1.35, fontSize: 16, indexFontSize: 10, label, labelSide: 'left', axisLabels: ARRAY_TEXT,
        lengthExpr: `arrayCount(${from})`, valueExpr: `arrayAt(${from}, idx)`, ...rest,
    };
}
/** Expression labels at the same position merge into one draggable "Vars" box. */
const label = (id: string, textExpr: string, position: number[], connect?: [string, string], highlightExpr?: string) =>
    ({ id, type: 'expression_label', position, textExpr, ...(connect ? { connectTo: { object: connect[0], indexExpr: connect[1] } } : {}), ...(highlightExpr ? { highlightExpr } : {}) });
const unset = (col: string, name = col) => `concat('${name} = ', ${tr(col)} < 0 ? 'unset' : ${tr(col)})`;

// ── The problem each scene solves. It is the scene's caption on entry (step 0) and
// opens its doc, before the technique. Example answers come from the traces, so
// the doc always states what the player will show. ──
const end = (trace: Frame[]) => trace.at(-1)!;
const list = (v: unknown) => `[${(v as unknown[]).join(', ')}]`;
const PROBLEMS: Record<string, { problem: string; example?: string }> = {
    'prefix-sum': { problem: 'Given an array, answer many queries of the form "what is the sum of nums[i..j]?"',
        example: `nums = ${list(IN.prefix.nums)}: ${IN.prefix.queries.map(([i, j]) => `sum(${i}..${j}) = ${IN.prefix.nums.slice(i, j + 1).reduce((a, b) => a + b, 0)}`).join(', ')}.` },
    'hash-map': { problem: 'Given an unsorted list and a target, find two numbers that add up to the target, and return their indices.',
        example: `nums = ${list(IN.hashMap.nums)}, target = ${IN.hashMap.target} → ${end(twoSumTrace(IN.hashMap.nums, IN.hashMap.target)).result}.` },
    'two-pointers': { problem: 'Two Sum on a sorted array: given a sorted array and a target, find two numbers that add up to the target, and return their indices.',
        example: (() => { const f = end(twoPointersTrace(IN.twoPointers.nums, IN.twoPointers.target)); return `nums = ${list(IN.twoPointers.nums)}, target = ${IN.twoPointers.target} → indices ${f.left} and ${f.right} (${IN.twoPointers.nums[f.left as number]} + ${IN.twoPointers.nums[f.right as number]}).`; })() },
    'dp-2d': { problem: 'Given two strings, find the length of their longest common subsequence: letters in the same order, not necessarily adjacent.',
        example: `a = "${IN.lcs.a}", b = "${IN.lcs.b}" → ${(end(lcsTrace(IN.lcs.a, IN.lcs.b))[`r${IN.lcs.b.length}`] as number[])[IN.lcs.a.length]}.` },
    'kadane': { problem: 'Find the largest sum of any contiguous subarray (of any length) in an array of positive and negative numbers.',
        example: (() => { const f = end(kadaneTrace(IN.kadane.nums)); return `nums = ${list(IN.kadane.nums)} → ${f.best}, from nums[${f.bs}..${f.be}].`; })() },
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
    'trie': { problem: 'Build a trie from a list of words, then check which prefixes and which whole words it contains.',
        example: `words = ${IN.trie.words.map(w => `"${w}"`).join(', ')}: ${IN.trie.queries.map(q => `starts_with("${q}") → ${IN.trie.words.some(w => w.startsWith(q)) ? 'True' : 'False'}`).join(', ')}; ${IN.trie.searches.map(q => `search("${q}") → ${IN.trie.words.includes(q) ? 'True' : 'False'}`).join(', ')}.` },
    'monotonic-stack': { problem: 'Given daily temperatures, find for each day how many days you must wait for a warmer one (0 if never).',
        example: `temps = ${list(IN.monotonic.temps)} → ${list(end(monotonicStackTrace(IN.monotonic.temps)).answer)}.` },
    'monotonic-queue': { problem: 'Return the maximum of every window of k consecutive numbers.',
        example: `nums = ${list(IN.monoQueue.nums)}, k = ${IN.monoQueue.k} → ${list(end(monotonicQueueTrace(IN.monoQueue.nums, IN.monoQueue.k)).out)}.` },
    'top-k': { problem: 'Find the k-th largest element of an unsorted array.',
        example: `nums = ${list(IN.topK.nums)}, k = ${IN.topK.k} → ${(end(topKTrace(IN.topK.nums, IN.topK.k)).heap as number[])[0]}.` },
    'fast-slow': { problem: 'An array holds n + 1 values from 1 to n, so one value repeats. Find it without changing the array and with O(1) extra space.',
        example: `nums = ${list(IN.fastSlow.nums)} → ${end(fastSlowTrace(IN.fastSlow.nums)).slow}.` },
    'linked-list-reversal': { problem: 'Reverse a singly linked list in place and return its new head.',
        example: `${IN.linkedList.values.join(' → ')} → None becomes ${[...IN.linkedList.values].reverse().join(' → ')} → None.` },
    'tree-traversal': { problem: 'Visit every node of a binary tree in a chosen order: preorder, inorder, postorder or level by level.',
        example: (() => { const t = IN.tree; const o = (k: 'preorder' | 'inorder' | 'level') => list(end(treeTraversalTrace(k, t.values, t.parents, t.sides)).out); return `preorder ${o('preorder')}, inorder ${o('inorder')}, level order ${o('level')}.`; })() },
    'matrix-traversal': { problem: 'In a grid of land (1) and water (0), count the islands: groups of land cells joined up, down, left or right.',
        example: `${IN.islands.grid.map(r => r.join('')).join(' / ')} → ${end(islandsTrace(IN.islands.grid)).count}.` },
    'topological-sort': { problem: 'Courses have prerequisites. Find an order in which to take every course, or report that none exists.',
        example: `${IN.topo.n} courses with prerequisites [${IN.topo.prerequisites.map(([c, p]) => `[${c}, ${p}]`).join(', ')}] → ${topoTrace(IN.topo.n, IN.topo.prerequisites).trace.at(-1)!.result}.` },
    'union-find': { problem: 'Given n nodes and a list of undirected edges, count the connected components.',
        example: `n = ${IN.unionFind.n}, edges = ${IN.unionFind.edges.map(e => `${e[0]}–${e[1]}`).join(', ')} → ${end(unionFindTrace(IN.unionFind.n, IN.unionFind.edges)).count}.` },
    'recursion': { problem: 'Compute x to the power n using O(log n) multiplications.',
        example: `power(${IN.recursion.x}, ${IN.recursion.n}) = ${IN.recursion.x ** IN.recursion.n}, in ${powerTrace(IN.recursion.x, IN.recursion.n).parents.length} calls.` },
    'backtracking': { problem: 'Return every subset of a list of distinct numbers.',
        example: `subsets(${JSON.stringify(IN.subsets.nums)}) → ${2 ** IN.subsets.nums.length} subsets, from [] to ${JSON.stringify(IN.subsets.nums)}.` },
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

/** Which trace column explains each label: the recorded run writes tip_<var> wherever a variable is assigned. */
const TIPS: Record<string, Record<string, string>> = {
    'prefix-sum': { last: 'tip_last', answer: 'tip_answer' },
    'two-pointers': { left: 'tip_left', right: 'tip_right', total: 'tip_total', compare: 'tip_cmp' },
    'sliding-window': { right: 'tip_right', window: 'tip_window', best: 'tip_best', 'best-compare': 'tip_cmp' },
    'fast-slow': { slow: 'tip_slow', fast: 'tip_fast', compare: 'tip_cmp' },
    'monotonic-stack': { t: 'tip_t', j: 'tip_j' },
    'rotated-search': { lo: 'tip_lo', mid: 'tip_mid', hi: 'tip_hi', half: 'tip_half', compare: 'tip_cmp' },
    'merge-intervals': { m: 'tip_m', compare: 'tip_cmp' },
    'dynamic-programming': { skip: 'tip_skip', take: 'tip_take' },
    'kadane': { cur: 'tip_cur', best: 'tip_best' },
    'dp-2d': { cell: 'tip_cell' },
    'greedy': { reach: 'tip_reach' },
    'bit-manipulation': { x: 'tip_x', result: 'tip_result' },
    'string-matching': { k: 'tip_k' },
    'monotonic-queue': { x: 'tip_x' },
    'union-find': { a: 'tip_edge', b: 'tip_edge', count: 'tip_count' },
};
/** Fixed source lines for labels the code never assigns in the body: parameters and loop variables. */
const LINES: Record<string, Record<string, number>> = {
    'prefix-sum': { x: 3 },
    'two-pointers': { target: 1 },
    'sliding-window': { k: 1 },
    'rotated-search': { target: 1 },
    'merge-intervals': { k: 4 },
    'monotonic-stack': { i: 4 },
    'monotonic-queue': { i: 5, k: 3 },
    'greedy': { i: 3 },
};
/**
 * A label's tooltip reads its tip_<var> column, and its codeRef links to ln_<var>: the line that last
 * assigned the value (recorded with the run), so the </> button opens the code that produced what is shown.
 */
const withTip = (sceneId: string) => (el: Json): Json => {
    if (el.type !== 'expression_label') return el;
    const column = TIPS[sceneId]?.[el.id as string], line = LINES[sceneId]?.[el.id as string];
    if (column) return { ...el, tooltipExpr: tr(column), codeRef: { file: sceneId, lineExpr: tr(`ln_${column.slice(4)}`) } };
    return line ? { ...el, codeRef: { file: sceneId, line } } : el;
};

interface PatternScene {
    id: string; title: string; markdown: string; prompt: string; file: string; source: string;
    trace: Frame[]; input: Json; elements: Json[]; cameraX?: number;
    /** For a recursive function: the line a call lands on; the trace's `calls` column lists waiting call sites. */
    callEntryLine?: number;
    /** Steps after the run, each playing its own data table (`data`) with its own code locations. */
    more?: { steps: Json[]; data: Record<string, unknown[]>; locations: Json[] };
    /** The code's teaching structure (see section()) and its hover explanations (see doc(), docBlock(), docExpr()). */
    sections?: Json[]; annotations?: Json[];
}
/** The 1-based line of source holding text, searched from the line holding after when given. */
function lineOf(source: string, text: string, after?: string): number {
    const lines = source.split('\n'), start = after ? lines.findIndex(l => l.includes(after)) : 0;
    const i = lines.findIndex((l, k) => k >= start && l.includes(text));
    if (i < 0) throw new Error(`no line holds ${JSON.stringify(text)}`);
    return i + 1;
}
/** One section of a code file's teaching structure: the lines from the one holding start to the one holding end. */
function section(source: string, id: string, title: string, start: string, end: string | null, extra: { hint?: string; prompt?: string } = {}): Json {
    const from = lineOf(source, start);
    return { id, title, from, to: end ? lineOf(source, end, start) : from, ...extra };
}
/**
 * An annotation documenting a name file-wide, or, with start (and end) texts, only on the lines from the one
 * holding start to the one holding end: an override for a name that means something else there.
 */
function doc(name: string, text: string, scope?: { source: string; start: string; end?: string }): Json {
    if (!scope) return { name, text };
    return { name, line: lineOf(scope.source, scope.start), endLine: lineOf(scope.source, scope.end ?? scope.start, scope.start), text };
}
/**
 * Sections that leave no line out: the first starts at line 1 (taking any imports), each runs on over the blank
 * lines after it, and a code line no section holds is an error, so "sections only" never shows a stray line.
 */
function coverLines(source: string, sections: Json[]): Json[] {
    const lines = source.split('\n'), sorted = [...sections].sort((a, b) => (a.from as number) - (b.from as number));
    const out = sorted.map((s, k) => {
        let to = s.to as number;
        const stop = k + 1 < sorted.length ? (sorted[k + 1]!.from as number) - 1 : lines.length;
        while (to < stop && !lines[to]!.trim()) to++;
        return { ...s, ...(k === 0 ? { from: 1 } : {}), to };
    });
    lines.forEach((l, i) => {
        if (l.trim() && !out.some(s => i + 1 >= (s.from as number) && i + 1 <= (s.to as number)))
            throw new Error(`line ${i + 1} (${l.trim()}) is in no section`);
    });
    return out;
}
/** An annotation documenting the lines from the one holding start to the one holding end. */
const docBlock = (source: string, start: string, end: string, text: string): Json =>
    ({ line: lineOf(source, start), endLine: lineOf(source, end, start), text });
/** An annotation documenting an expression: snippet, on the line holding lineText. */
function docExpr(source: string, lineText: string, snippet: string, text: string): Json {
    const line = lineOf(source, lineText), col = source.split('\n')[line - 1]!.indexOf(snippet);
    if (col < 0) throw new Error(`line ${line} has no ${JSON.stringify(snippet)}`);
    return { line, col, endCol: col + snippet.length, text };
}
const scenes: Json[] = [], codeFiles: Json[] = [];
/**
 * The codeRef extras for the values calls returned, when any frame records them (a frame's `returns`); frames
 * without get {} so every row has the column.
 */
function returnsRef(trace: Frame[], table = 'trace'): Json {
    const frames = trace as unknown as Record<string, unknown>[];
    if (!frames.some(f => 'returns' in f)) return {};
    for (const f of frames) f.returns ??= {};
    return { returnsExpr: `dataTable('${table}', frame, 'returns')` };
}
function pattern(p: PatternScene) {
    const x = p.cameraX ?? 0;
    scenes.push({
        id: p.id, title: p.title, description: PROBLEMS[p.id]!.problem, range: RANGE,
        camera: { position: [x, 0, 16], target: [x, 0, 0] },
        data: { input: [p.input], trace: p.trace, ...p.more?.data }, markdown: withProblem(p.id, p.markdown), prompt: p.prompt, elements: [grid],
        steps: [{
            // The caption narrates the current step, as in the database lab; description is the fallback.
            id: 'run', title: 'Run the algorithm', description: 'Follow the highlighted code line with the execution player.', descriptionExpr: tr('message'),
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: p.trace.length - 1, step: 1, default: 0 }],
            add: p.elements.map(withTip(p.id)),
        }, ...(p.more?.steps ?? [])],
        stepPlayback: { slider: 'frame', intervalMs: 1200 },
        codeRef: { file: p.id, lineExpr: tr('line'), ...(p.callEntryLine ? { callsExpr: tr('calls'), callEntryLine: p.callEntryLine } : {}), ...returnsRef(p.trace) },
    });
    codeFiles.push({
        id: p.id, path: `patterns/${p.file}`, language: 'python', source: p.source,
        ...(p.sections?.length ? { sections: coverLines(p.source, p.sections) } : {}), ...(p.annotations?.length ? { annotations: p.annotations } : {}),
        locations: [...p.trace.map((f, snapshot) => ({ line: f.line, scene: p.id, step: 'run', snapshot, label: `${p.title} · ${f.message}` })), ...(p.more?.locations ?? [])],
    });
}
const MD_TAIL = 'Use the execution player to step through, or open **Code** to see the active Python line. The code is display-only; every view reads the same recorded execution snapshot.';

// ── Overview: a decision tree from what the problem gives you, through the signal, to the pattern ──
// Each category has signals (the question to ask of the problem) and, under each, the pattern it leads to,
// with interview problems that show that signal. Pattern names are the scenes' short names.
const DECISIONS: { category: string; signals: { signal: string; pattern: string; scene: string; problems: string[] }[] }[] = [
    { category: 'Sorted array', signals: [
        { signal: 'pair or triple?', pattern: 'Two pointers', scene: 'two-pointers', problems: ['Two Sum II', '3Sum'] },
        { signal: 'find a value fast?', pattern: 'Binary search', scene: 'rotated-search', problems: ['Search in Rotated Sorted Array', 'Find Peak Element'] } ] },
    // Two signals, one tool: a dict answers "seen it?" and "how many / which group?" in O(1).
    { category: 'Unsorted array', signals: [
        { signal: 'seen it before?', pattern: 'Hash map', scene: 'hash-map', problems: ['Two Sum', 'Contains Duplicate'] },
        { signal: 'count or group?', pattern: 'Hash map', scene: 'hash-map', problems: ['Group Anagrams', 'Longest Consecutive Sequence'] } ] },
    { category: 'Ranges in an array', signals: [
        { signal: 'many range sums?', pattern: 'Prefix sum', scene: 'prefix-sum', problems: ['Range Sum Query', 'Product of Array Except Self'] },
        { signal: 'sum equals k?', pattern: 'Hash map', scene: 'hash-map', problems: ['Subarray Sum Equals K'] },
        { signal: 'window of size k?', pattern: 'Sliding window', scene: 'sliding-window', problems: ['Max Sum of k Consecutive', 'Longest Substring Without Repeating'] },
        { signal: 'best sum, any length?', pattern: 'Kadane', scene: 'kadane', problems: ['Maximum Subarray'] },
        { signal: 'max of each window?', pattern: 'Monotonic queue', scene: 'monotonic-queue', problems: ['Sliding Window Maximum'] } ] },
    { category: 'Order & selection', signals: [
        { signal: 'next greater?', pattern: 'Monotonic stack', scene: 'monotonic-stack', problems: ['Daily Temperatures', 'Next Greater Element'] },
        { signal: 'k largest?', pattern: 'Heap', scene: 'top-k', problems: ['Kth Largest Element', 'Top K Frequent Elements'] },
        { signal: 'overlapping ranges?', pattern: 'Merge intervals', scene: 'merge-intervals', problems: ['Merge Intervals', 'Meeting Rooms II'] },
        { signal: 'local best is safe?', pattern: 'Greedy', scene: 'greedy', problems: ['Jump Game'] },
        { signal: 'pairs cancel?', pattern: 'Bit tricks', scene: 'bit-manipulation', problems: ['Single Number'] } ] },
    { category: 'Strings', signals: [
        { signal: 'pattern in text?', pattern: 'KMP', scene: 'string-matching', problems: ['First Occurrence in a String'] },
        { signal: 'shared prefixes?', pattern: 'Trie', scene: 'trie', problems: ['Implement Trie', 'Word Search II'] } ] },
    { category: 'Linked list', signals: [
        { signal: 'cycle or duplicate?', pattern: 'Fast & slow', scene: 'fast-slow', problems: ['Find the Duplicate Number', 'Linked List Cycle II'] },
        { signal: 'reverse or reorder?', pattern: 'Reverse links', scene: 'linked-list-reversal', problems: ['Reverse Linked List', 'Reorder List'] } ] },
    { category: 'Trees & graphs', signals: [
        { signal: 'visit in an order?', pattern: 'Tree traversal', scene: 'tree-traversal', problems: ['Binary Tree Level Order', 'Kth Smallest in a BST'] },
        { signal: 'grid of cells?', pattern: 'Grid DFS / BFS', scene: 'matrix-traversal', problems: ['Number of Islands', 'Rotting Oranges'] },
        { signal: 'join as edges come?', pattern: 'Union-find', scene: 'union-find', problems: ['Redundant Connection'] },
        { signal: 'dependencies?', pattern: 'Topological sort', scene: 'topological-sort', problems: ['Course Schedule'] },
        { signal: 'cheapest path?', pattern: 'Dijkstra', scene: 'draft/graph-algorithms#dijkstra', problems: ['Network Delay Time'] } ] },
    { category: 'Choices', signals: [
        { signal: 'reuse sub-answers?', pattern: 'Dynamic prog.', scene: 'dynamic-programming', problems: ['House Robber', 'Coin Change'] },
        { signal: 'two sequences?', pattern: '2D DP', scene: 'dp-2d', problems: ['Longest Common Subsequence', 'Edit Distance'] },
        { signal: 'all combinations?', pattern: 'Backtracking', scene: 'backtracking', problems: ['Subsets', 'N-Queens'] },
        { signal: 'smaller copies?', pattern: 'Recursion', scene: 'recursion', problems: ['Pow(x, n)'] } ] },
];
/** The overview's steps: the categories round the root question, then one decision tree per category. */
function overviewSteps(): { steps: Json[]; data: Record<string, unknown[]> } {
    const data: Record<string, unknown[]> = {};
    const node = (t: string, col: string) => `dataTable('${t}', idx, '${col}')`;
    const prob = (t: string, col: string) => `dataTable('${t}', problem, '${col}')`;
    // A tree graph over table t: on[k] marks the lit path for the problem the slider picks.
    const tree = (t: string, pt: string, layout: Json, size: { w: number; h: number }): Json => ({
        id: 'decisions', type: 'graph', label: '', lengthExpr: `${data[t]!.length}`, valueExpr: node(t, 'text'),
        treeLayout: { type: 'tidy', parentExpr: node(t, 'p'), ...layout },
        nodeShape: 'rect', nodeWidth: size.w, nodeHeight: size.h, nodeCornerRadius: 0.16, valueLabel: 'inside', showIndices: false,
        axisLabels: 'plane',   // text painted on each box, sized to it, so it fits at any zoom
        // Deep fills so the white node text reads: the lit path gold (its pattern green), questions blue, patterns violet.
        colorExpr: `arrayAt(${prob(pt, 'on')}, idx) == 1 ? (${node(t, 'kind')} == 2 ? '#2f7d66' : '#9a7420') : (${node(t, 'kind')} == 2 ? '#56468a' : (${node(t, 'kind')} == 1 ? '#335374' : '#4a5560'))`,
        connectTo: { indexExpr: node(t, 'p'), pinned: true, bendExpr: '0', color: '#7f93aa',
            colorExpr: `arrayAt(${prob(pt, 'on')}, idx) == 1 ? '${GOLD}' : ''`, highlightExpr: `arrayAt(${prob(pt, 'on')}, idx) == 1` },
    });
    // reset: each step's slider snapshots the one it replaces, so going back restores that step's problem list.
    const slider = (pt: string) => ({ id: 'problem', label: 'Problem', min: 0, max: data[pt]!.length - 1, step: 1, default: 0, valueExpr: prob(pt, 'name'), reset: true });
    // Step 1: the root question and the categories round it; a problem lights its category.
    const all = DECISIONS.flatMap((d, k) => d.signals.flatMap(sg => sg.problems.map(name => ({ name, k, sg }))));
    // pick: a category's first problem on this step's slider, which lists every category's problems in order.
    const firstOf = DECISIONS.map((_, k) => all.findIndex(a => a.k === k));
    data.dt_root = [{ text: 'What are you given?', p: -1, kind: 0, pick: -1 }, ...DECISIONS.map((d, k) => ({ text: d.category, p: 0, kind: 1, pick: firstOf[k] }))];
    data.dp_root = all.map(({ name, k, sg }) => ({ name, on: data.dt_root!.map((_, i) => (i === 0 || i === k + 1 ? 1 : 0)),
        why: `${name}: ${DECISIONS[k]!.category.toLowerCase()} → ${sg.signal} → ${sg.pattern}. Its step shows the whole branch.` }));
    const steps: Json[] = [{
        id: 'categories', title: 'What are you given?', description: 'Start from what the problem gives you.',
        descriptionExpr: prob('dp_root', 'why'),
        camera: { position: [0, 0, 14], target: [0, 0, 0] },
        // The slider is replaced too, so coming back from a branch never keeps that branch's problem names.
        remove: [{ id: '*' }, { type: 'slider' }], sliders: [slider('dp_root')],
        add: [{ ...tree('dt_root', 'dp_root', {}, { w: 2.5, h: 0.75 }), treeLayout: { type: 'radial', parentExpr: node('dt_root', 'p'), origin: [0, 0, 0], levelGap: 3.9 }, nodeWidth: 3.0,
            // Click a category to select its first problem (the root keeps the current one).
            onClick: [{ action: 'setSlider', slider: 'problem', valueExpr: `${node('dt_root', 'pick')} < 0 ? problem : ${node('dt_root', 'pick')}` }] }],
    }];
    // One step per category: category → signals → patterns, and its problems on the slider.
    DECISIONS.forEach((d, k) => {
        const t = `dt_${k}`, pt = `dp_${k}`;
        // pick: the first problem (slider value) that shows a node's signal; clicking the node selects it.
        const first = d.signals.map((_, j) => d.signals.slice(0, j).reduce((n, sg) => n + sg.problems.length, 0));
        // scene: a pattern node's scene, which clicking it opens.
        data[t] = [{ text: d.category, p: -1, kind: 0, pick: -1, scene: '' },
            ...d.signals.flatMap((sg, j) => [{ text: sg.signal, p: 0, kind: 1, pick: first[j], scene: '' }, { text: sg.pattern, p: 1 + 2 * j, kind: 2, pick: -1, scene: sg.scene }])];
        data[pt] = d.signals.flatMap((sg, j) => sg.problems.map(name => ({ name,
            on: data[t]!.map((_, i) => (i === 0 || i === 1 + 2 * j || i === 2 + 2 * j ? 1 : 0)),
            why: `${name}: ${d.category.toLowerCase()}, and the problem asks "${sg.signal}" → ${sg.pattern}.` })));
        steps.push({
            id: `branch-${k}`, title: d.category, description: `${d.category}: which signal does the problem show?`,
            descriptionExpr: prob(pt, 'why'),
            camera: { position: [0, 0.6, 13], target: [0, 0.6, 0] },
            remove: [{ id: '*' }, { type: 'slider' }], sliders: [slider(pt)],
            // Left to right: the category, a column of signals, a column of the patterns they lead to.
            add: [{ ...tree(t, pt, { origin: [-3.4, 0.6, 0], spacing: 1.15, levelGap: 3.1, orientation: 'horizontal' }, { w: 2.8, h: 0.8 }),
                // Click a signal to pick the first problem that shows it; click a pattern to open its scene.
                onClick: [{ action: 'setSlider', slider: 'problem', valueExpr: `${node(t, 'pick')} < 0 ? problem : ${node(t, 'pick')}` },
                    { action: 'goToScene', sceneExpr: node(t, 'scene') }] }],
        });
    });
    return { steps, data };
}
const overview = overviewSteps();

scenes.push({
    id: 'overview', title: 'Which pattern fits?', description: 'Recognize which pattern a problem is asking for.', range: RANGE,
    camera: { position: [1.5, 0, 15], target: [1.5, 0, 0] }, elements: [grid,
        { id: 'title', type: 'text', text: 'Common algorithm patterns', position: [1.5, 0.6, 0], color: GOLD },
        { id: 'subtitle', type: 'text', text: 'Spot the signal, pick the plan', position: [1.5, -0.6, 0], color: BLUE }],
    markdown: `# Which pattern fits?

Most interview problems are variations on a small set of patterns. The skill is recognizing the **signal** in the problem statement and reaching for the matching plan.

| Signal in the problem | Pattern | Typical cost |
| --- | --- | --- |
| Many range-sum queries on a fixed array | Running totals (prefix sum) | O(n) build, O(1) per query |
| Unsorted data: "have I seen this, or its partner, before?" | Remember what you've seen (hash map) | O(n), O(n) space |
| Sorted array, find a pair or triple | Squeeze from both ends (two pointers) | O(n) |
| Best contiguous subarray or substring | Slide a window (sliding window) | O(n) |
| Largest sum of a contiguous subarray, any length | Keep the best running sum (Kadane) | O(n), O(1) space |
| Sorted data with a twist (rotated, 2D) | Halve the search (binary search) | O(log n) |
| Intervals, meetings, ranges | Merge overlapping ranges (intervals) | O(n log n) |
| Choices where the locally best step is always safe | Take the best step now (greedy) | Often O(n) or O(n log n) |
| Pairs cancelling, parity, bitmask subsets | Flip bits (bit manipulation) | O(n), O(1) space |
| Find a pattern inside a long text | Find a word fast (KMP string matching) | O(n + m) |
| Prefix lookups over many words | Build trie | O(word length) |
| "Next greater / smaller element" | Next bigger value (monotonic stack) | O(n) |
| Max or min of every window | Max of every window (monotonic queue) | O(n) |
| k largest, k smallest, k most frequent | Keep the best k (heap) | O(n log k) |
| Cycle, or "find the duplicate" in O(1) space | Tortoise and hare (fast & slow pointers) | O(n), O(1) space |
| Reverse or reorder linked-list nodes | Flip the links (linked list reversal) | O(n), O(1) space |
| Visit every tree node in a set order | Walk a tree (traversal orders) | O(n) |
| Explore every path, depth first (DFS) | Walk a tree (traversal orders) | O(V + E) |
| Level by level, or shortest path in steps (BFS) | Walk a tree (traversal orders) | O(V + E) |
| Grid of cells, islands, flood fill | Explore a grid (matrix traversal) | O(rows × cols) |
| Prerequisites, build order, or "is there a cycle?" | Order by dependencies (topological sort) | O(V + E) |
| Cheapest path with weighted edges | Dijkstra (in the Graph algorithms lesson) | O((V + E) log V) |
| Connectivity as edges arrive, counting groups | Group connected items (union-find) | ≈ O(1) per operation |
| A problem built from smaller copies of itself | Solve smaller copies (recursion) | Depends on the recurrence |
| All permutations, subsets, placements | Try, undo, retry (backtracking) | Exponential, pruned |
| Optimal value from overlapping subproblems | Reuse answers (dynamic programming) | Subproblems × work each |
| Two sequences to align, or a grid walked right and down | Fill a table (2D dynamic programming) | O(m·n) |

The steps here walk the same map as a **decision tree**: start from what the problem gives you, ask which signal it shows, and follow it to the pattern. Move **Problem** to see real interview problems take their path, or click a node: a category or a signal picks a problem that shows it, and a pattern opens its scene.

Each following scene runs one pattern on a small example.`,
    prompt: 'Help the learner recognize which pattern fits a problem. Ask them to name the signal (sorted input, contiguous range, cycle, next-greater, overlapping subproblems) before naming a pattern. Encourage predicting the pattern before revealing it.',
    data: overview.data, steps: overview.steps,
});

// ── Prefix sum ──
pattern({
    id: 'prefix-sum', title: 'Running totals (prefix sum)', file: 'prefix_sum.py', source: PREFIX_SOURCE,
    input: { nums: IN.prefix.nums }, trace: prefixSumTrace(IN.prefix.nums, IN.prefix.queries),
    sections: [
        section(PREFIX_SOURCE, 'p-start', 'Start from the empty sum', 'def build_prefix(', 'prefix = [0]', {
            hint: 'prefix begins as [0]: the sum of no numbers, so the first range can subtract it.' }),
        section(PREFIX_SOURCE, 'p-build', 'Extend the running total', 'for k, x in enumerate', 'return prefix', {
            hint: 'Each new entry is the previous total plus the next number; one pass builds all n + 1 entries.',
            prompt: 'Explain why prefix gets n + 1 entries and why prefix[k + 1], not prefix[k], holds the sum through nums[k].' }),
        section(PREFIX_SOURCE, 'p-query', 'Answer a range in one subtraction', 'def range_sum(', 'return prefix[j + 1]', {
            hint: 'The total up to j minus the total before i leaves exactly nums[i..j].',
            prompt: 'Explain why prefix[j + 1] - prefix[i] is the sum of nums[i..j], and what goes wrong with prefix[j] - prefix[i].' }),
    ],
    annotations: [
        doc('build_prefix', '`build_prefix(nums)` returns the running totals of `nums`: a list one longer than `nums` whose entry `m` is the sum of the first `m` numbers. One O(n) pass.'),
        doc('range_sum', '`range_sum(prefix, i, j)` is the sum of `nums[i..j]`, both ends included, read from the running totals in O(1).'),
        doc('nums', 'The input numbers. They never change, which is what makes precomputing totals worthwhile.'),
        doc('prefix', '`prefix[m]` is the sum of `nums[0..m-1]`, the first `m` numbers. It has `len(nums) + 1` entries; `prefix[0] = 0` is the empty sum.'),
        doc('k', 'The index of the number being added, 0 to `len(nums) - 1`.'),
        doc('x', 'The number being added, `nums[k]`.'),
        doc('i', 'The first index of the range, included.'),
        doc('j', 'The last index of the range, included; the total through it is `prefix[j + 1]`.'),
        docExpr(PREFIX_SOURCE, 'prefix.append', 'prefix[-1] + x', 'The total so far plus the next number: the sum of the first `k + 1` numbers, which becomes `prefix[k + 1]`.'),
        docExpr(PREFIX_SOURCE, 'return prefix[j + 1]', 'prefix[j + 1]', 'The sum of `nums[0..j]`: everything up to and including the range\'s end.'),
        docExpr(PREFIX_SOURCE, 'return prefix[j + 1]', 'prefix[i]', 'The sum of `nums[0..i-1]`: everything before the range, which the subtraction removes.'),
        docBlock(PREFIX_SOURCE, 'for k, x in enumerate', 'prefix.append', 'One pass over `nums`, each step appending the previous total plus the next number. After it, `prefix` holds every running total.'),
    ],
    markdown: `# Running totals (prefix sum)

**Signal:** many "sum of nums[i..j]" queries on an array that does not change.

Build \`prefix\` once, where \`prefix[m]\` is the sum of the first \`m\` numbers. Each prefix cell sits on the boundary *before* position m, so it covers everything to its left. Then

$$\\text{sum}(i..j) = \\text{prefix}[j+1] - \\text{prefix}[i]$$

because the larger prefix includes the range and the smaller one removes everything before it. Building costs O(n); every query after that costs O(1).

${MD_TAIL}

**Practice:** Range Sum Query, Contiguous Array, Subarray Sum Equals K.`,
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

// ── Hash map: Two Sum, then subarrays summing to target, both remembering what they have seen in a dict ──
(() => {
    const { nums, target, sums, sumTarget } = IN.hashMap;
    const twoSum = twoSumTrace(nums, target), sub = subarraySumTrace(sums, sumTarget);
    const L1 = (t: string) => hashLine('two_sum', t), L2 = (t: string) => hashLine('subarray_sum', t);
    const ref = (line: number) => ({ file: 'hash-map', line });
    const S = (id: string, title: string, start: string, end: string | null, extra: { hint?: string; prompt?: string }) =>
        section(HASH_MAP_SOURCE, id, title, start, end, extra);
    // A dict over a table's keys / vals columns, the entry being read or written lit.
    const dict = (id: string, c: (col: string) => string, origin: number[], extra: Json = {}): Json => ({
        id, type: 'dict', label: id, origin, labelSide: 'left', cellSize: 1.35, fontSize: 16, indexFontSize: 10, axisLabels: ARRAY_TEXT,
        lengthExpr: `arrayCount(${c('keys')})`, keyExpr: `arrayAt(${c('keys')}, idx)`, valueExpr: `arrayAt(${c('vals')}, idx)`,
        highlightExpr: `idx == ${c('look')}`, ...extra,
    });
    // Two Sum: nums with i; seen maps each number to its index, and each entry points back at that cell. On a
    // hit, nums[i] points at the entry for its partner.
    const found = `${tr('cond')} == 1`;
    const twoSumElements: Json[] = [
        array('nums', 'nums', [-4.4, 2.4, 0], { from: inp('nums'), highlightExpr: `idx == ${tr('i')}`,
            markers: [marker('i', tr('i'), PINK, `${tr('i')} >= 0`)],
            connectTo: { object: 'seen', indexExpr: `idx == ${tr('i')} and ${found} ? ${tr('look')} : -1`, arrow: true, pinned: true, color: GOLD } }),
        dict('seen', tr, [-4.4, -0.8, 0], {
            markers: [marker('other', tr('look'), GOLD, `${found}`)],
            connectTo: { object: 'nums', indexExpr: 'value', arrow: true, pinned: true, color: '#7f93aa',
                highlightExpr: `idx == ${tr('look')} and ${found}` } }),
        { ...label('i', `${tr('i')} < 0 ? 'i: —' : concat('i = ', ${tr('i')})`, [4.6, -3.6, 0], ['nums', tr('i')]), codeRef: ref(L1('for i, num')) },
        { ...label('num', `${tr('i')} < 0 ? 'num: —' : concat('num = ', ${tr('num')})`, [4.6, -3.6, 0], ['nums', tr('i')]), codeRef: ref(L1('for i, num')) },
        { ...label('target', `concat('target = ', ${inp('target')})`, [4.6, -3.6, 0]), codeRef: ref(L1('other = target - num')) },
        { ...label('target-num', `${tr('hasOther')} == 0 ? 'target - num: —' : concat('target - num = ', ${inp('target')}, ' - ', ${tr('num')}, ' = ', ${tr('other')})`, [4.6, -3.6, 0]), codeRef: ref(L1('other = target - num')) },
        { ...label('other', `${tr('hasOther')} == 0 ? 'other: —' : concat('other = ', ${tr('other')})`, [4.6, -3.6, 0]), codeRef: ref(L1('other = target - num')) },
        { ...label('cond', `${tr('cond')} < 0 ? 'other in seen: —' : (${found} ? 'other in seen → True' : 'other in seen → False')`, [4.6, -3.6, 0],
            ['seen', `${found} ? ${tr('look')} : -1`], `${tr('line')} == ${L1('if other in seen')}`), codeRef: ref(L1('if other in seen')) },
        { ...label('result', tr('returned'), [4.6, -3.6, 0]), codeRef: ref(L1('return [seen[other], i]')) },
    ];
    // Subarray sum: count maps each prefix sum to how often it has appeared; a subarray ending here sums to target
    // once for each earlier prefix equal to running_sum − target.
    const sb = (col: string) => `dataTable('hm_sub', frame, '${col}')`;
    const subElements: Json[] = [
        array('sums', 'nums', [-4.4, 2.4, 0], { from: inp('sums'), highlightExpr: `idx <= ${sb('i')}`,
            markers: [marker('num', sb('i'), PINK, `${sb('i')} >= 0`)] }),
        dict('count', sb, [-3.4, 0.6, 0], { arrayLayout: 'vertical', cellSize: 1.1, labelSide: 'left', indexFontSize: 14 }),
        { ...label('num', `${sb('i')} < 0 ? 'num: —' : concat('num = ', ${sb('num')})`, [4.6, -3.6, 0], ['sums', sb('i')]), codeRef: ref(L2('for num in nums')) },
        { ...label('sum-target', `concat('target = ', ${inp('sumTarget')})`, [4.6, -3.6, 0]), codeRef: ref(L2('subarray_count += count.get')) },
        { ...label('running_sum', `concat('running_sum = ', ${sb('runningSum')})`, [4.6, -3.6, 0]), codeRef: ref(L2('running_sum += num')) },
        { ...label('need', `${sb('i')} < 0 ? 'running_sum - target: —' : concat('running_sum - target = ', ${sb('need')})`, [4.6, -3.6, 0]), codeRef: ref(L2('subarray_count += count.get')) },
        { ...label('got', sb('gotText'), [4.6, -3.6, 0],
            ['count', `${sb('line')} == ${L2('subarray_count += count.get')} ? ${sb('look')} : -1`], `${sb('line')} == ${L2('subarray_count += count.get')}`), codeRef: ref(L2('subarray_count += count.get')) },
        { ...label('subarray_count', `concat('subarray_count = ', ${sb('subarrayCount')})`, [4.6, -3.6, 0]), codeRef: ref(L2('return subarray_count')) },
    ];
    pattern({
        id: 'hash-map', title: "Remember what you've seen (hash map)", file: 'hash_map.py', source: HASH_MAP_SOURCE,
        input: { nums, target, sums, sumTarget }, trace: twoSum,
        sections: [
            S('ts-init', 'Nothing seen yet', 'def two_sum(', 'seen = {}', {
                hint: 'seen will map each number already passed to its index; it starts empty.' }),
            S('ts-need', 'Walk once; name the partner', 'for i, num in enumerate', 'other = target - num', {
                hint: 'For each number, the only partner that works is target − num.' }),
            S('ts-look', 'Look up the partner first', 'if other in seen', 'return [seen[other], i]', {
                hint: 'If the partner was seen earlier, its index and this one are the answer.',
                prompt: 'Explain why two_sum looks up other before recording num, and what would go wrong with a number that is exactly half of target if it recorded first.' }),
            S('ts-record', 'Then remember this number', 'seen[num] = i', null, {
                hint: 'Record num with its index so the numbers still to come can find it.' }),
            S('ts-none', 'No pair', 'return []', null, { hint: 'The loop ended without a hit: no two numbers sum to target.' }),
            S('ss-init', 'Count the empty prefix once', 'def subarray_sum(', 'running_sum = subarray_count = 0', {
                hint: 'count starts as {0: 1}: the empty prefix, so a subarray starting at index 0 can be counted.',
                prompt: 'Explain why count starts with {0: 1} instead of empty, using a subarray that starts at index 0.' }),
            S('ss-step', 'Extend the running sum', 'for num in nums', 'running_sum += num', {
                hint: 'running_sum is the sum of every number up to and including this one.' }),
            S('ss-count', 'Count the subarrays ending here', 'subarray_count += count.get', null, {
                hint: 'Each earlier prefix equal to running_sum − target starts a subarray that ends here and sums to target.',
                prompt: 'Explain why the number of earlier prefixes equal to running_sum − target is the number of subarrays ending here that sum to target.' }),
            S('ss-record', 'Then record this prefix', 'count[running_sum] =', null, {
                hint: 'Add this prefix sum to count, after counting, so a subarray is never empty.' }),
            S('ss-return', 'The count', 'return subarray_count', null, { hint: 'subarray_count counted every subarray summing to target, once each.' }),
        ],
        annotations: [
            doc('two_sum', '`two_sum(nums, target)` returns the indices `[a, b]` of two numbers that add up to `target`, or `[]` when none do. One pass, O(n) time and space.'),
            doc('subarray_sum', '`subarray_sum(nums, target)` counts the contiguous subarrays of `nums` whose sum is `target`. One pass with a dict of prefix sums; works with negative numbers.'),
            doc('nums', 'The input numbers, read once from left to right.'),
            doc('target', 'The sum the two numbers must reach.'),
            doc('seen', 'Each number already passed, mapped to its index: `seen[value] = index`. Looking a value up costs O(1) on average.'),
            doc('i', 'The index of the current number.'),
            doc('num', 'The current number, `nums[i]`.'),
            doc('other', 'The other number of the pair, the one `num` needs: `target − num`. Only this value can complete the pair.'),
            doc('num', 'The next number of `nums`.', { source: HASH_MAP_SOURCE, start: 'def subarray_sum(', end: 'return subarray_count' }),
            doc('target', 'The sum a subarray must have to be counted.', { source: HASH_MAP_SOURCE, start: 'def subarray_sum(', end: 'return subarray_count' }),
            doc('count', 'How many times each prefix sum has appeared so far: `count[p]` is the number of earlier positions whose running sum was `p`. Starts as `{0: 1}` for the empty prefix.'),
            doc('running_sum', 'The running sum: every number up to and including the current one.'),
            doc('subarray_count', 'The number of subarrays summing to `target` found so far, the answer.'),
            docExpr(HASH_MAP_SOURCE, 'other = target - num', 'target - num', 'The partner `num` needs: the one value that, added to `num`, gives `target`.'),
            docExpr(HASH_MAP_SOURCE, 'if other in seen', 'other in seen', 'Was the partner among the numbers already passed? A dict answers in O(1) on average, instead of a scan.'),
            docExpr(HASH_MAP_SOURCE, 'return [seen[other], i]', '[seen[other], i]', 'The partner\'s index, from `seen`, then this number\'s: the earlier index comes first.'),
            docExpr(HASH_MAP_SOURCE, 'count = {0: 1}', '{0: 1}', 'The empty prefix, sum 0, seen once: it lets a subarray that starts at index 0 be counted.'),
            docBlock(HASH_MAP_SOURCE, 'subarray_count += count.get', 'subarray_count += count.get', '```\ncurrent_running_sum - previous_running_sum = target\nTherefore:\nprevious_running_sum = current_running_sum - target\n```\nHow many earlier prefixes equal `running_sum − target`. Each one starts a subarray ending here whose sum is `running_sum − (running_sum − target) = target`; 0 when there are none.'),
            docExpr(HASH_MAP_SOURCE, 'count[running_sum] =', 'count.get(running_sum, 0) + 1', 'One more occurrence of this prefix sum, counting from 0 if it is new.'),
            docBlock(HASH_MAP_SOURCE, 'if other in seen', 'seen[num] = i', 'Look up first, then record. Checking before recording means a number never pairs with itself, and every pair is found when its second number arrives.'),
            docBlock(HASH_MAP_SOURCE, 'running_sum += num', 'count[running_sum] =', 'Extend the running sum, count the subarrays ending here, then record the new prefix sum for the numbers still to come.'),
        ],
        more: {
            data: { hm_sub: sub },
            steps: [{
                id: 'subarray-sum', title: 'Count by prefix (subarray sum = target)', description: 'Subarrays summing to target: count earlier prefix sums in a dict.',
                descriptionExpr: `dataTable('hm_sub', frame, 'message')`,
                remove: [{ id: '*' }, { type: 'slider' }],
                sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: sub.length - 1, step: 1, default: 0 }],
                codeRef: { file: 'hash-map', lineExpr: `dataTable('hm_sub', frame, 'line')` },
                add: subElements,
            }],
            locations: sub.map((f, snapshot) => ({ line: f.line, scene: 'hash-map', step: 'subarray-sum', snapshot, label: `Subarray sum · ${f.message}` })),
        },
        markdown: `# Remember what you've seen (hash map)

**Signal:** unsorted data and a question about pairs or earlier values: "two numbers that sum to…", "have I seen this before?", "how many times…", "first repeat".

A **dict** (hash map) answers "have I seen this?" in O(1) on average, so one pass can do what nested loops do in O(n²). Walk the input once; at each element, **look up** what you need from the past, then **record** the current element for the elements still to come.

## 1. Two Sum (this step)

For each \`num\`, its partner is \`other = target − num\`. If \`other\` is already a key in \`seen\`, the answer is \`[seen[other], i]\`; otherwise remember \`seen[num] = i\`. Each entry in \`seen\` points back at the cell of \`nums\` it indexes; on a hit, \`nums[i]\` points at its partner's entry. O(n) time and O(n) space, against O(n²) for checking every pair. The sorted version needs no dict: see the two-pointers scene.

## 2. Count by prefix (next step)

Subarrays summing to \`k\`: a subarray ending here sums to \`k\` exactly when an earlier **prefix sum** equals \`prefix − k\`. So keep \`count\`, how often each prefix sum has appeared, starting with \`{0: 1}\` for the empty prefix, and add \`count.get(prefix − k, 0)\` at each step. This works with negative numbers, where a sliding window cannot.

${MD_TAIL}

**Practice:** Two Sum, Contains Duplicate, Subarray Sum Equals K, Longest Consecutive Sequence, Group Anagrams.`,
        prompt: 'Explain why a dict turns the pair search into one pass: look up first, then record. Ask the learner to predict, before each lookup, whether other is already in seen, and for subarray sums, how many subarrays end at the current index.',
        elements: twoSumElements,
    });
    const scene = scenes.at(-1)!, first = (scene.steps as Json[])[0]!;
    Object.assign(first, { title: 'Find the partner (Two Sum)', description: 'Two Sum: look up target − num among the numbers seen so far, then remember num.' });
})();
// ── Two pointers ──
pattern({
    id: 'two-pointers', title: 'Squeeze from both ends (two pointers)', file: 'two_pointers.py', source: TWO_POINTERS_SOURCE,
    input: { nums: IN.twoPointers.nums, target: IN.twoPointers.target }, trace: twoPointersTrace(IN.twoPointers.nums, IN.twoPointers.target),
    sections: [
        section(TWO_POINTERS_SOURCE, 'tp-ends', 'Start at both ends', 'def two_sum_sorted(', 'left, right = 0', {
            hint: 'left on the smallest value, right on the largest.' }),
        section(TWO_POINTERS_SOURCE, 'tp-sum', 'While they have not met, add the pair', 'while left < right', 'total = nums[left]', {
            hint: 'Each round looks at one pair: the values under the two pointers.' }),
        section(TWO_POINTERS_SOURCE, 'tp-hit', 'Found the target', 'if total == target', 'return [left, right]', {
            hint: 'The pair adds up: return both indices.' }),
        section(TWO_POINTERS_SOURCE, 'tp-move', 'Too small: move left; too big: move right', 'if total < target', 'right -= 1', {
            hint: 'Only one move can help: a bigger left value raises the sum, a smaller right value lowers it.',
            prompt: 'Explain why, when total is below target, no pair using nums[left] can work, so left can move on; and the mirror argument for right.' }),
        section(TWO_POINTERS_SOURCE, 'tp-none', 'The pointers met: no pair', 'return []', null, {
            hint: 'Every pair that could work was ruled out.' }),
    ],
    annotations: [
        doc('two_sum_sorted', '`two_sum_sorted(nums, target)` returns the indices `[left, right]` of two numbers in a **sorted** list that add up to `target`, or `[]`. O(n) time and O(1) space: no dict needed.'),
        doc('nums', 'The input numbers, sorted from smallest to largest. The sort is what lets one comparison rule out a whole row of pairs.'),
        doc('target', 'The sum the pair must reach.'),
        doc('left', 'The index of the smaller number of the pair. It only moves right, to raise the sum.'),
        doc('right', 'The index of the larger number of the pair. It only moves left, to lower the sum.'),
        doc('total', 'The sum of the current pair, `nums[left] + nums[right]`.'),
        docExpr(TWO_POINTERS_SOURCE, 'left, right = 0', 'len(nums) - 1', 'The last index: `right` starts on the largest value.'),
        docExpr(TWO_POINTERS_SOURCE, 'while left < right', 'left < right', 'The pointers have not met, so pairs remain. Once they meet, every pair has been ruled out.'),
        docExpr(TWO_POINTERS_SOURCE, 'total = nums[left]', 'nums[left] + nums[right]', 'The smallest remaining value plus the largest remaining value.'),
        docExpr(TWO_POINTERS_SOURCE, 'if total == target', 'total == target', 'Does this pair reach the target exactly?'),
        docExpr(TWO_POINTERS_SOURCE, 'if total < target', 'total < target', 'Too small. `nums[left]` with any value left of `right` is smaller still, so `nums[left]` can be in no pair: move `left` on.'),
        docBlock(TWO_POINTERS_SOURCE, 'if total < target', 'right -= 1', 'Each round drops one value for good: the smaller one when the sum is too small, the larger one when it is too big. So the loop runs at most n − 1 times.'),
    ],
    markdown: `# Squeeze from both ends (two pointers)

**Signal:** a **sorted** array and a question about a pair (or triple) of elements.

This is **Two Sum** again, solved the other way. The hash-map scene ("Remember what you've seen") finds the pair in one pass with a dict: O(n) time, O(n) extra space. When the array is sorted, the order itself does the dict's job: two pointers find the pair in O(n) time with **O(1)** space. On unsorted input, sorting first costs O(n log n) and shuffles the indices you have to return, so the dict is the better choice there.

Put \`left\` at the smallest value and \`right\` at the largest. Compare their sum with the target:

- **Too small:** \`nums[right]\` is the largest value still available, so \`nums[left]\` cannot reach the target with anything. Discard it: \`left += 1\`.
- **Too big:** \`nums[left]\` is the smallest value still available, so \`nums[right]\` overshoots with everything. Discard it: \`right -= 1\`.

Each step rules out one element for good, so the scan is O(n) with O(1) space, compared with O(n²) for checking every pair. Target here: **${IN.twoPointers.target}**.

${MD_TAIL}

**Practice:** Two Sum II, 3Sum, Container With Most Water.`,
    prompt: 'This is Two Sum on a sorted array, the alternative to the hash-map solution: compare the two (time, space, and when each fits). Explain why moving a pointer never skips a valid pair: the discarded element cannot be part of any solution. Ask the learner to predict which pointer moves before each step.',
    elements: [
        array('nums', 'nums', [-4.5, 1.2, 0], {
            from: inp('nums'), highlightExpr: `idx == ${tr('left')} or idx == ${tr('right')}`,
            markers: [marker('left', tr('left')), marker('right', tr('right'), PINK)],
        }),
        label('left', `concat('left = ', ${tr('left')})`, [-4, -2.6, 0], ['nums', tr('left')]),
        label('right', `concat('right = ', ${tr('right')})`, [-4, -2.6, 0], ['nums', tr('right')]),
        // total is linked to target; both, and the comparison, light up on a match.
        ...((hit: string) => [
            { ...label('total', `concat('total = ', ${tr('hasTotal')} == 1 ? ${tr('total')} : '—')`, [-4, -2.6, 0], undefined, hit), connectTo: { object: 'target', pinned: true } },
            label('target', `concat('target = ', ${inp('target')})`, [4, -2.6, 0], undefined, hit),
            { ...label('compare', `${tr('hasTotal')} == 1 ? concat(${tr('total')}, ${tr('total')} < ${inp('target')} ? ' < ' : (${tr('total')} > ${inp('target')} ? ' > ' : ' = '), ${inp('target')}, ${tr('total')} < ${inp('target')} ? ': move left pointer' : (${tr('total')} > ${inp('target')} ? ': move right pointer' : ': found')) : 'compare: —'`, [4, -2.6, 0], undefined, hit) },
        ])(`${tr('hasTotal')} == 1 and ${tr('total')} == ${inp('target')}`),
    ],
});

// ── Sliding window ──
pattern({
    id: 'sliding-window', title: 'Slide a window (sliding window)', file: 'sliding_window.py', source: SLIDING_WINDOW_SOURCE,
    input: { nums: IN.slidingWindow.nums, k: IN.slidingWindow.k }, trace: slidingWindowTrace(IN.slidingWindow.nums, IN.slidingWindow.k),
    sections: [
        section(SLIDING_WINDOW_SOURCE, 'sw-first', 'Sum the first window', 'def max_window_sum(', 'best = window', {
            hint: 'Add up the first k numbers once; that window is the best so far.' }),
        section(SLIDING_WINDOW_SOURCE, 'sw-slide', 'Slide: add the new number, drop the old one', 'for right in range', 'window += nums[right]', {
            hint: 'Moving one step right brings in nums[right] and lets go of nums[right − k]: two operations, not k.',
            prompt: 'Explain why updating the window with one addition and one subtraction gives the same sum as adding up all k numbers again, and what that does to the cost.' }),
        section(SLIDING_WINDOW_SOURCE, 'sw-best', 'Keep the best window', 'best = max(best, window)', 'return best', {
            hint: 'After each slide, keep the larger of the best so far and this window.' }),
    ],
    annotations: [
        doc('max_window_sum', '`max_window_sum(nums, k)` returns the largest sum of k consecutive numbers. O(n): each number enters and leaves the window once.'),
        doc('nums', 'The input numbers.'),
        doc('k', 'The window size: how many consecutive numbers are summed.'),
        doc('window', 'The sum of the k numbers in the current window.'),
        doc('best', 'The largest window sum seen so far.'),
        doc('right', 'The index of the number entering the window; the window is `nums[right − k + 1 .. right]`.'),
        docExpr(SLIDING_WINDOW_SOURCE, 'window = sum(', 'sum(nums[:k])', 'The first window, summed once in full.'),
        docExpr(SLIDING_WINDOW_SOURCE, 'window += nums[right]', 'nums[right] - nums[right - k]', 'In comes `nums[right]`, out goes `nums[right − k]`, the number that just left the window.'),
    ],
    markdown: `# Slide a window (sliding window)

**Signal:** the best (largest, smallest, longest) **contiguous** subarray or substring.

Neighbouring windows share all but two elements. Instead of re-summing each window of size k = ${IN.slidingWindow.k}, slide it one step: add the element that enters on the right, subtract the one that leaves on the left. That turns O(n·k) into O(n).

This scene uses a fixed-size window. Variable-size windows (longest substring without repeats, minimum window substring) grow \`right\` every step and shrink \`left\` while a constraint is broken. The invariant is the same: the window state is updated incrementally, never recomputed.

${MD_TAIL}

**Practice:** Maximum Average Subarray I, Longest Substring Without Repeating Characters, Minimum Window Substring.`,
    prompt: 'Explain the incremental update and why it is O(1). Contrast fixed and variable windows. Ask the learner to predict the next window sum before the player shows it.',
    elements: [
        array('nums', 'nums', [-4.5, 1.2, 0], {
            from: inp('nums'), highlightExpr: `idx >= ${tr('left')} and idx <= ${tr('right')}`,
            markers: [marker('left', tr('left')), marker('right', tr('right')), marker('right − k', tr('dropped'), PINK)],
        }),
        label('right', `concat('right = ', ${tr('right')})`, [-4, -2.6, 0], ['nums', tr('right')]),
        // The update on line 5, term by term: what enters (nums[right]) and what leaves (nums[right - k]); before the
        // loop there is no slide yet.
        ...((sliding: string) => [
            label('right-k', `${sliding} ? concat('right - k = ', ${tr('right')} - ${inp('k')}) : 'right - k: —'`, [-4, -2.6, 0], ['nums', `${tr('right')} - ${inp('k')}`]),
            label('enters', `concat('nums[right] = ', arrayAt(${inp('nums')}, ${tr('right')}))`, [-4, -2.6, 0], ['nums', tr('right')]),
            label('leaves', `${sliding} ? concat('nums[right - k] = ', arrayAt(${inp('nums')}, ${tr('right')} - ${inp('k')})) : 'nums[right - k]: —'`, [-4, -2.6, 0], ['nums', `${tr('right')} - ${inp('k')}`]),
        ])(`${tr('right')} >= ${inp('k')}`),
        // window is linked to best; on line 6 a comparison row shows max(best, window), and all three glow on a new best.
        ...((hit: string, comparing: string) => [
            { ...label('window', `concat('window = ', ${tr('window')})`, [-4, -2.6, 0], undefined, hit), connectTo: { object: 'best', pinned: true } },
            label('best', `concat('best = ', ${tr('best')})`, [4, -2.6, 0], undefined, hit),
            { ...label('best-compare', `${comparing} ? (${tr('improved')} == 1 ? concat(${tr('window')}, ' > ', ${tr('prevBest')}, ': best updated') : concat(${tr('window')}, ' ≤ ', ${tr('prevBest')}, ': best stays')) : 'compare: —'`, [4, -2.6, 0], undefined, hit) },
        ])(`${tr('improved')} == 1`, `${tr('prevBest')} >= 0`),
        label('k', `concat('k = ', ${inp('k')})`, [-4, -2.6, 0]),
    ],
});


// ── Kadane ──
pattern({
    id: 'kadane', title: 'Keep the best running sum (Kadane)', file: 'kadane.py', source: KADANE_SOURCE,
    input: { nums: IN.kadane.nums }, trace: kadaneTrace(IN.kadane.nums),
    sections: [
        section(KADANE_SOURCE, 'kd-start', 'Start from the first number', 'def max_subarray(', 'cur = best = nums[0]', {
            hint: 'The best subarray ending at index 0 is nums[0] itself, and so is the best so far.' }),
        section(KADANE_SOURCE, 'kd-extend', 'Extend the run, or start over here', 'for i in range(1', 'cur = max(nums[i]', {
            hint: 'A run with a negative sum only drags the next number down: then it is better to start again at nums[i].',
            prompt: 'Explain why cur = max(nums[i], cur + nums[i]) is the best sum of a subarray ending at i, and when the run starts over.' }),
        section(KADANE_SOURCE, 'kd-best', 'Keep the best run', 'best = max(best, cur)', 'return best', {
            hint: 'The answer ends somewhere: keep the largest cur seen at any index.' }),
    ],
    annotations: [
        doc('max_subarray', '`max_subarray(nums)` returns the largest sum of a contiguous, non-empty subarray. O(n) time, O(1) space.'),
        doc('nums', 'The input numbers, negatives included.'),
        doc('cur', 'The largest sum of a subarray that ends exactly at the current index.'),
        doc('best', 'The largest subarray sum found so far, ending anywhere.'),
        doc('i', 'The index being added.'),
        docExpr(KADANE_SOURCE, 'cur = max(nums[i]', 'cur + nums[i]', 'Extend the best run ending at i − 1 by `nums[i]`.'),
        docExpr(KADANE_SOURCE, 'cur = max(nums[i]', 'nums[i]', 'Or start a new run here, when the old run\'s sum is negative.'),
    ],
    markdown: `# Keep the best running sum (Kadane)

**Signal:** the largest (or smallest) sum of a contiguous subarray, of any length; or the best profit from one buy and one sell.

Let \`cur\` be the best sum of a subarray that *ends at* i. It either extends the best run ending at i − 1 or starts fresh at nums[i]:

$$\\text{cur}_i = \\max(\\text{nums}[i],\; \\text{cur}_{i-1} + \\text{nums}[i])$$

Starting fresh wins exactly when the run so far is negative: it only drags the sum down. The answer is the largest \`cur\` seen. Each value needs only the one before it, so a single pass with two variables suffices: O(n) time, O(1) space, instead of O(n²) for every start and end.

Unlike a sliding window, the length is free, so the window resets instead of sliding.

${MD_TAIL}

**Practice:** Maximum Subarray, Maximum Product Subarray, Best Time to Buy and Sell Stock, Maximum Sum Circular Subarray.`,
    prompt: 'Explain why a negative running sum should be dropped. Ask the learner to predict, at each index, whether the run extends or starts fresh, and whether best changes, before the player reveals it.',
    elements: [
        // Gold: the run cur covers (start..i). Teal: the best run found so far.
        array('nums', 'nums', [-5.5, 1.8, 0], {
            from: inp('nums'), highlightExpr: `idx == ${tr('i')}`,
            colorExpr: `idx >= ${tr('start')} and idx <= ${tr('i')} ? '${GOLD}' : (idx >= ${tr('bs')} and idx <= ${tr('be')} ? '${TEAL}' : '')`,
            markers: [marker('i', tr('i')), marker('start', tr('start'), PINK, `${tr('start')} < ${tr('i')}`)],
        }),
        label('cur', `concat('cur = ', ${tr('cur')})`, [-4, -3.6, 0], ['nums', tr('i')]),
        label('best', `concat('best = ', ${tr('best')})`, [-4, -3.6, 0], ['nums', tr('be')]),
        // The two choices line 4 weighs: start fresh at nums[i], or extend the run.
        { ...label('num-i', `${tr('i')} < 1 ? 'nums[i]: —' : concat('nums[i] = ', arrayAt(${inp('nums')}, ${tr('i')}))`, [3.2, -3.6, 0], ['nums', `${tr('i')} < 1 ? -1 : ${tr('i')}`]),
            codeRef: { file: 'kadane', line: 4 } },
        { ...label('extend', `${tr('i')} < 1 ? 'cur + nums[i]: —' : concat('cur + nums[i] = ', ${tr('extend')})`, [3.2, -3.6, 0], undefined, `${tr('line')} == 4`),
            codeRef: { file: 'kadane', line: 4 } },
    ],
});
// ── Fast & slow ──
const fsNums = IN.fastSlow.nums, fsOrigin = [-4, 0.6, 0];

/**
 * Step 2 of the scene: why phase 2 finds the entrance. The walk from index 0 drawn as its real shape, a straight
 * path into a loop, with A, B and C marked as the proof names them and the three equations revealed in step with
 * the recorded run (fastSlowProofTrace). It plays its own table, `proof`, on the same execution player.
 */
/**
 * The same argument as a proof for the Math view, coloured like the diagram (A gold, B pink, C teal), with this
 * input's numbers in every justification. `t` is the first meeting's round.
 */
function phaseTwoProof(A: number, B: number, C: number, t: number, walk: { path: number[]; cycle: number[]; entrance: number; meet: number }) {
    const a = String.raw`\htmlClass{hl-a}{A}`, b = String.raw`\htmlClass{hl-b}{B}`, c = String.raw`\htmlClass{hl-c}{C}`;
    const highlights = { a: { color: 'gold', label: `A = ${A}: start to the entrance` }, b: { color: 'pink', label: `B = ${B}: entrance to the first meeting` }, c: { color: 'teal', label: `C = ${C}: the loop's length` } };
    const k = t / C, m = (t - A - B) / C;
    return {
        id: 'phase_two_entrance', title: 'Why phase 2 finds the entrance', technique: 'direct',
        goal: String.raw`Show that a pointer from the start and one from the first meeting point, each taking one step at a time, reach the loop's entrance together: $A \equiv -B \pmod C$.`,
        prompt: 'Walk the argument with the numbers from this run. The key move: both expressions equal t, so A + B is a whole number of laps; walking A more steps from the meeting point (B past the entrance) lands on the entrance.',
        steps: [
            { id: 'measure', type: 'definition', label: 'Measure the walk', math: `${a} = ${A},\\quad ${b} = ${B},\\quad ${c} = ${C}`, highlights, sceneStep: 1,
                justification: 'A: steps from the start to the entrance. B: from the entrance on to the first meeting. C: the loop length.',
                explanation: `Here the path ${walk.path.join(' → ')} leads to the entrance, index ${walk.entrance} (A = ${A}); the first meeting is index ${walk.meet}, ${B} steps on (B = ${B}); the loop ${walk.cycle.join(' → ')} has ${C} steps.` },
            { id: 'laps', type: 'step', label: 'Fast is whole laps ahead', math: `2t - t = k${c}`, highlights, sceneStep: 1,
                justification: String.raw`After $t$ rounds fast walked $2t$ and slow $t$; they stand on the same spot, so the difference is whole laps.`,
                explanation: `Here $t = ${t}$: $${2 * t} - ${t} = ${t} = ${k}\\cdot ${C}$.` },
            { id: 'slow_walk', type: 'step', label: "Slow's walk", math: `t = ${a} + ${b} + m${c}`, highlights, sceneStep: 1,
                justification: 'Slow walked the whole path, then B into the loop, plus some whole laps.',
                explanation: `Here $${t} = ${A} + ${B} + ${m}\\cdot ${C}$.` },
            { id: 'combine', type: 'step', label: 'Both equal t', math: `${a} + ${b} = (k - m)\\,${c}`, highlights, sceneStep: 1,
                justification: 'Subtract: A + B is a whole number of laps.',
                explanation: `Here $${A} + ${B} = ${A + B} = ${(A + B) / C}\\cdot ${C}$.` },
            { id: 'congruence', type: 'conclusion', label: 'The entrance lemma', math: String.raw`\boxed{${a} \equiv -${b} \pmod{${c}}}`, highlights, sceneStep: 1,
                justification: 'So walking A more steps from the meeting point (already B past the entrance) ends B + A ≡ 0 steps past it: at the entrance. A pointer from the start reaches it after the same A steps.',
                explanation: `Here $${A} \\equiv -${B} \\equiv ${((A % C) + C) % C} \\pmod{${C}}$: phase 2 meets at the entrance after ${A} steps, and the entrance is the duplicate.` },
        ],
    };
}

function fastSlowProofStep(nums: number[]) {
    const { path, cycle, entrance, A, C } = rhoShape(nums);
    const run = fastSlowProofTrace(nums);
    const B = run.at(-1)!.B, meet = run.at(-1)!.meet;
    const pr = (col: string) => `dataTable('proof', frame, '${col}')`;
    const stage = (n: number) => `${pr('stage')} >= ${n}`;
    // Layout: the path left to right, then the loop as a circle entered from the left, running clockwise.
    // Centred on x = 0: path steps of 1.2, then the loop of radius 1.5 entered from its left.
    const y = 1.3, step = 1.2, r = 1.5, x0 = -(path.length * step + 2 * r) / 2, cx = x0 + path.length * step + r;
    const at: Record<number, [number, number]> = {};
    path.forEach((n, i) => { at[n] = [x0 + i * step, y]; });
    const angle = (k: number) => Math.PI - (2 * Math.PI * k) / C;
    cycle.forEach((n, k) => { at[n] = [cx + r * Math.cos(angle(k)), y + r * Math.sin(angle(k))]; });
    const xy = (n: number) => at[n]!;
    const round = (v: number) => +v.toFixed(3);
    // One row per node: its place, and which part of the walk its outgoing edge belongs to (A: the path;
    // B: from the entrance to the first meeting). The graph reads these; nothing is drawn by hand.
    const onB = (n: number) => { const k = cycle.indexOf(n); return k >= 0 && k < B ? 1 : 0; };
    const layout = nums.map((_, n) => ({ x: round(xy(n)[0]), y: round(xy(n)[1]), a: path.includes(n) ? 1 : 0, b: onB(n), loop: cycle.includes(n) ? 1 : 0 }));
    const ly = (col: string) => `dataTable('layout', idx, '${col}')`;
    const partColor = `${stage(2)} and ${ly('b')} == 1 ? '${PINK}' : (${stage(1)} and ${ly('a')} == 1 ? '${GOLD}' : '')`;
    const els: Json[] = [];
    const mid = (a: number, b: number) => (a + b) / 2;
    els.push(
        {
            id: 'walk', type: 'graph', itemType: 'number', label: 'nums as pointers',
            lengthExpr: String(nums.length), valueExpr: `arrayAt(${inp('nums')}, idx)`,
            positionExpr: [ly('x'), ly('y'), '0'],
            nodeShape: 'point', nodeSize: 0.42, valueLabel: 'none', showIndices: true,
            colorExpr: `idx == ${entrance} and ${stage(1)} ? '${TEAL}' : ''`,
            // Each node points at the index it holds; the walk's parts light up as the proof names them.
            // The path's edges are straight; the loop's are arcs round its centre, so the loop reads as a circle.
            connectTo: { indexExpr: 'value', pinned: true, arrow: true, color: '#7f93aa', colorExpr: partColor, bendExpr: '0',
                arcCenterExpr: [`${ly('loop')} == 1 ? ${round(cx)} : NaN`, `${ly('loop')} == 1 ? ${y} : NaN`, '0'], highlightExpr: `(${stage(2)} and ${ly('b')} == 1) or (${stage(1)} and ${ly('a')} == 1)` },
            markers: [marker('slow', pr('slow')), marker('fast', pr('fast'), PINK)],
        },
        { id: 'label-a', type: 'text', text: `$A = ${A}$`, position: [round(mid(xy(path[0]!)[0], xy(entrance)[0])), y - 0.95, 0], color: GOLD, visibleExpr: stage(1) },
        { id: 'label-b', type: 'text', text: `$B = ${B}$`, position: [round(cx + r * 1.45 * Math.cos(angle(0.5))), round(y + r * 1.45 * Math.sin(angle(0.5))), 0], color: PINK, visibleExpr: stage(2) },
        { id: 'label-c', type: 'text', text: `$C = ${C}$`, position: [round(cx + r + 0.9), y, 0], color: TEAL, visibleExpr: stage(3) },
        { id: 'label-entrance', type: 'text', text: 'entrance', position: [round(xy(entrance)[0]), round(xy(entrance)[1] - 0.95), 0], color: TEAL, visibleExpr: stage(1) },
        { id: 'label-meet', type: 'text', text: 'first meeting', position: [round(xy(meet)[0]), round(xy(meet)[1] - 0.95), 0], color: '#b5c1cf', visibleExpr: `${pr('meet')} >= 0` },
        { id: 'proof-walked', type: 'expression_label', position: [0, -2.1, 0],
            textExpr: `${pr('phase')} == 1 ? concat('t = ', ${pr('t')}, '   slow walked ', ${pr('t')}, ', fast walked ', 2 * ${pr('t')}) : concat('phase 2, step ', ${pr('phaseSteps')}, ':  slow ', ${A} - ${pr('phaseSteps')}, ' from the entrance,  fast ', ${B}, ' + ', ${pr('phaseSteps')}, ' ≡ ', mod(${B} + ${pr('phaseSteps')}, ${C}), ' past it')` },
    );
    // The proof in an info overlay that builds up: one more equation per state, the last boxed.
    const lines = [String.raw`$$2t - t = kC$$`, String.raw`$$t = A + B + mC$$`, String.raw`$$\boxed{A \equiv -B \pmod C}$$`];
    const info = lines.map((_, k) => ({
        id: `proof-eq-${k + 1}`, title: 'Why the entrance', position: 'top-left',
        content: lines.slice(0, k + 1).join('\n'),
        visibleExpr: k < lines.length - 1 ? `${pr('stage')} == ${4 + k}` : stage(4 + k),
    }));
    const rows = run;
    return {
        data: { proof: rows, layout },
        locations: run.map((f, snapshot) => ({ line: f.line, scene: 'fast-slow', step: 'proof', snapshot, label: `Why phase 2 finds the entrance · ${f.message}` })),
        steps: [{
            id: 'proof', title: 'Why phase 2 finds the entrance',
            description: 'Measure the walk as A, B and C, and see why a pointer from the start and one from the meeting point reach the entrance together.',
            descriptionExpr: pr('message'),
            camera: { position: [0, 0.6, 12], target: [0, 0.6, 0] },
            remove: [{ id: '*' }, { type: 'slider' }],
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: rows.length - 1, step: 1, default: 0 }],
            codeRef: { file: 'fast-slow', lineExpr: pr('line') },
            proof: phaseTwoProof(A, B, C, run.find(f => f.meet >= 0)!.t, { path, cycle, entrance, meet }),
            info,
            add: els,
        }],
    };
}
pattern({
    id: 'fast-slow', title: 'Tortoise and hare (fast & slow pointers)', file: 'fast_slow.py', source: FAST_SLOW_SOURCE,
    input: { nums: fsNums }, trace: fastSlowTrace(fsNums), more: fastSlowProofStep(fsNums),
    sections: [
        section(FAST_SLOW_SOURCE, 'fs-setup', 'Both pointers start at index 0', 'def find_duplicate(', 'slow = fast = 0', {
            hint: 'Each value is a pointer to the index it names, so `nums` is a linked list that starts at index 0.' }),
        section(FAST_SLOW_SOURCE, 'fs-race', 'Fast gains a step every move, so they meet in the loop', 'while True', 'break', {
            hint: 'Slow moves one hop, fast two. Once both are in the loop, the gap between them shrinks by one each move.' }),
        section(FAST_SLOW_SOURCE, 'fs-entrance', 'Restart slow; at the same pace they meet at the entrance', 'slow = 0', 'fast = nums[fast]', {
            hint: 'The start is as far from the entrance as the meeting point is, counting whole laps, so moving both one hop at a time brings them together there.',
            prompt: 'Explain why restarting slow from 0 and moving both pointers one hop at a time makes them meet exactly at the loop\'s entrance.' }),
        section(FAST_SLOW_SOURCE, 'fs-done', 'The entrance is the duplicate', 'return slow', null, {
            hint: 'Two indices point to the entrance, so its index is the value that repeats.' }),
    ],
    annotations: [
        doc('find_duplicate', '`find_duplicate(nums)` returns the value that repeats in `nums`. O(n) time, O(1) extra space.'),
        doc('nums', 'Values from 1 to n − 1 in n cells. Read cell `i` as a pointer to index `nums[i]`.'),
        doc('slow', 'The tortoise: one hop per move.'),
        doc('fast', 'The hare: two hops per move in phase 1, one in phase 2.'),
        docExpr(FAST_SLOW_SOURCE, 'slow = nums[slow]', 'nums[slow]', 'One hop: the index the current cell points to.'),
        docExpr(FAST_SLOW_SOURCE, 'fast = nums[nums[fast]]', 'nums[nums[fast]]', 'Two hops in one move: follow the pointer, then follow it again.'),
        docExpr(FAST_SLOW_SOURCE, 'if slow == fast', 'slow == fast', 'They meet: both are inside the loop, on the same cell.'),
        docBlock(FAST_SLOW_SOURCE, 'while True', 'break', 'Once fast is in the loop it gains one cell per move, so it catches slow within one lap: O(n) moves.'),
        docExpr(FAST_SLOW_SOURCE, 'slow = 0', 'slow = 0', 'Slow goes back to the start; fast stays at the meeting point.'),
        docExpr(FAST_SLOW_SOURCE, 'while slow != fast', 'slow != fast', 'Both move one hop at a time now; they first agree at the loop\'s entrance.'),
        docExpr(FAST_SLOW_SOURCE, 'fast = nums[fast]', 'nums[fast]', 'One hop now, not two: the same pace as slow.'),
        docBlock(FAST_SLOW_SOURCE, 'while slow != fast', 'fast = nums[fast]', 'With $A$ the path to the entrance, $B$ the entrance to the meeting point and $C$ the loop length, $A \\equiv -B \\pmod C$: $A$ hops from the meeting point also land on the entrance.'),
        docExpr(FAST_SLOW_SOURCE, 'return slow', 'slow', 'The entrance: two indices point to it, so it is the duplicate.'),
    ],
    markdown: `# Tortoise and hare (fast & slow pointers)

**Signal:** a cycle in a linked structure, or "find the duplicate" with O(1) extra space.

Here \`nums\` holds ${fsNums.length} values from 1 to ${fsNums.length - 1}, so one value repeats. Read each cell as a pointer: index i points to index \`nums[i]\` (the arcs). Following pointers from index 0 must eventually loop, and the loop's entrance is the value two indices point to: the duplicate.

**Phase 1:** \`slow\` moves one hop, \`fast\` moves two. Inside the cycle fast gains one step per move, so they must meet.

**Phase 2:** restart \`slow\` from the beginning and move both one hop at a time. The distance from the start to the entrance equals the distance from the meeting point to the entrance (mod the cycle length), so they meet exactly at the entrance. The next step, **Why phase 2 finds the entrance**, proves it: with $A$ the path to the entrance, $B$ the entrance to the first meeting and $C$ the loop length, $2t - t = kC$ and $t = A + B + mC$ give $A \equiv -B \pmod C$.

${MD_TAIL}

**Practice:** Linked List Cycle, Happy Number, Find the Duplicate Number.`,
    prompt: 'Explain why fast catches slow inside the cycle and why phase 2 lands on the entrance. Use the arcs as a linked list. Ask the learner to predict where each pointer lands after the next hop.',
    elements: [
        array('nums', 'nums', fsOrigin, {
            from: inp('nums'), highlightExpr: `idx == ${tr('slow')} or idx == ${tr('fast')}`,
            // Each cell points at the index it holds: arcs over the row go forward, under it go back.
            // The arcs a hop takes light in its pointer's colour while it moves.
            connectTo: { object: 'nums', indexExpr: 'value', pinned: true, arrow: true, color: '#8aa0b8',
                colorExpr: `idx == ${tr('slow_from')} ? '${GOLD}' : (idx == ${tr('fast_from')} or idx == ${tr('fast_mid')} ? '${PINK}' : '')`,
                highlightExpr: `idx == ${tr('slow_from')} or idx == ${tr('fast_from')} or idx == ${tr('fast_mid')}` },
            markers: [marker('slow', tr('slow')), marker('fast', tr('fast'), PINK), marker('fast (mid-hop)', tr('hop'), BLUE)],
        }),
        label('slow', `concat('slow = ', ${tr('slow')})`, [-4, -3.4, 0], ['nums', tr('slow')]),
        label('fast', `concat('fast = ', ${tr('fast')})`, [-4, -3.4, 0], ['nums', tr('fast')]),
        label('phase', `concat('phase = ', ${tr('phase')})`, [4, -3.4, 0]),
        // The loop's test, on the lines that make it: slow == fast in phase 1, slow != fast in phase 2.
        label('compare', `${tr('line')} == 6 ? concat('slow == fast? ', ${tr('slow')}, ${tr('slow')} == ${tr('fast')} ? ' = ' : ' ≠ ', ${tr('fast')}, ${tr('slow')} == ${tr('fast')} ? ': they meet' : ': not yet') : (${tr('line')} == 9 ? concat('slow != fast? ', ${tr('slow')}, ${tr('slow')} == ${tr('fast')} ? ' = ' : ' ≠ ', ${tr('fast')}, ${tr('slow')} == ${tr('fast')} ? ': stop, the entrance' : ': keep moving') : 'compare: —')`,
            [4, -4.4, 0], undefined, `(${tr('line')} == 6 or ${tr('line')} == 9) and ${tr('slow')} == ${tr('fast')}`),
    ],
});

// ── Monotonic stack ──
pattern({
    id: 'monotonic-stack', title: 'Next bigger value (monotonic stack)', file: 'monotonic_stack.py', source: MONOTONIC_STACK_SOURCE,
    input: { temps: IN.monotonic.temps }, trace: monotonicStackTrace(IN.monotonic.temps), cameraX: 1,
    sections: [
        section(MONOTONIC_STACK_SOURCE, 'mono-setup', 'Every day waits; the stack starts empty', 'def daily_temperatures(', 'stack = []', {
            hint: 'answer[i] stays 0 unless a warmer day comes; the stack will hold the days still waiting for one.' }),
        section(MONOTONIC_STACK_SOURCE, 'mono-pop', 'A warmer day answers the days waiting below it', 'for i, t in enumerate', 'answer[j] = i - j', {
            hint: 'While today is warmer than the day on top, that day has found its answer: pop it and record the distance.',
            prompt: 'Explain why only the top of the stack needs comparing with today, and why each popped day\'s answer is final.' }),
        section(MONOTONIC_STACK_SOURCE, 'mono-push', 'Today waits too', 'stack.append(i)', null, {
            hint: 'Today goes on the stack; the temperatures on it still never increase from bottom to top.' }),
        section(MONOTONIC_STACK_SOURCE, 'mono-done', 'Days left on the stack keep 0', 'return answer', null, {
            hint: 'Each day is pushed and popped at most once: O(n).' }),
    ],
    annotations: [
        doc('daily_temperatures', '`daily_temperatures(temps)` returns, for each day, how many days until a warmer one (0 if never). O(n).'),
        doc('temps', 'The temperature of each day.'),
        doc('answer', '`answer[j]`: how many days day `j` waits for a warmer one; 0 while none has come.'),
        doc('stack', 'The indices of the days still waiting for a warmer day. Their temperatures never increase from bottom to top.'),
        doc('i', 'Today: the index of the day being read.'),
        doc('t', "Today's temperature, `temps[i]`."),
        doc('j', 'A day just popped: today is its first warmer day.'),
        docExpr(MONOTONIC_STACK_SOURCE, 'answer = [0]', '[0] * len(temps)', 'One answer per day, 0 until a warmer day is found.'),
        docExpr(MONOTONIC_STACK_SOURCE, 'while stack and', 'stack[-1]', 'The day on top of the stack: the most recent day still waiting, and the coldest of them.'),
        docExpr(MONOTONIC_STACK_SOURCE, 'while stack and', 'temps[stack[-1]] < t', 'Today is warmer than the day on top: that day stops waiting.'),
        docExpr(MONOTONIC_STACK_SOURCE, 'answer[j] = i - j', 'i - j', 'The number of days from day `j` to today, its first warmer day.'),
        docBlock(MONOTONIC_STACK_SOURCE, 'while stack and', 'answer[j] = i - j', 'Every day is popped at most once in the whole run, so all these pops together cost O(n).'),
        docExpr(MONOTONIC_STACK_SOURCE, 'stack.append(i)', 'stack.append(i)', 'Today waits for a warmer day too. It is the coldest on the stack now, so the order still holds.'),
    ],
    markdown: `# Next bigger value (monotonic stack)

**Signal:** "next greater element", "next smaller element", or "how far until…".

The stack holds the **indices** of days that have not yet seen a warmer day. Their temperatures never increase from bottom to top, so a new day only needs to compare with the top. While today is warmer than the top day, pop it: today is its answer. Then push today.

Every index is pushed once and popped at most once, so the whole scan is O(n), even though there is a loop inside a loop.

${MD_TAIL}

**Practice:** Next Greater Element I, Daily Temperatures, Largest Rectangle in Histogram.`,
    prompt: 'Explain the stack invariant (temperatures non-increasing bottom to top) and the amortized O(n) argument. Ask the learner to predict how many days the next temperature will pop.',
    elements: [
        array('temps', 'temps', [-5, 2.2, 0], {
            from: inp('temps'), highlightExpr: `idx == ${tr('i')}`,
            // temps[stack[-1]] is what the while condition compares with t: the top day's temperature.
            markers: [marker('i', tr('i')), marker('j', tr('j'), PINK), marker('stack[-1]', tr('top'), BLUE),
                { ...marker('temps[stack[-1]]', tr('top'), BLUE), valueExpr: `arrayAt(${inp('temps')}, ${tr('top')})` }],
        }),
        array('answer', 'answer', [-5, -0.8, 0], {
            from: tr('answer'), color: '#b69bea', highlightExpr: `idx == ${tr('j')} and ${tr('line')} == 7`,
            markers: [marker('j', tr('j'), PINK)],
        }),
        {
            id: 'stack', type: 'stack', itemType: 'number', origin: [6.3, -3.4, 0], cellSize: 1.1, fontSize: 15, showIndices: false,
            lengthExpr: tr('n'), valueExpr: `arrayAt(${tr('stack')}, idx)`, color: BLUE, label: 'stack (days)', containerColor: TEAL,
            connectTo: [{ object: 'temps', indexExpr: 'value', pinned: true }, { object: 'answer', indexExpr: 'value', color: '#b69bea' }],
        },
        label('i', unset('i'), [-4.5, -3.6, 0], ['temps', tr('i')]),
        label('t', `concat('t = ', ${tr('i')} < 0 ? 'unset' : ${tr('t')})`, [-4.5, -3.6, 0], ['temps', tr('i')]),
        label('j', unset('j'), [-4.5, -3.6, 0], ['answer', tr('j')]),
    ],
});

// ── Modified binary search ──
const MID_HIT = `${tr('comparing')} == 1 and arrayAt(${inp('nums')}, ${tr('mid')}) == ${inp('target')}`;
pattern({
    id: 'rotated-search', title: 'Halve the search (binary search)', file: 'rotated_search.py', source: ROTATED_SEARCH_SOURCE,
    input: { nums: IN.rotated.nums, target: IN.rotated.target }, trace: rotatedSearchTrace(IN.rotated.nums, IN.rotated.target),
    sections: [
        section(ROTATED_SEARCH_SOURCE, 'rs-range', 'Search the whole array', 'def search_rotated(', 'lo, hi = 0', {
            hint: 'lo and hi bound the part of nums the target can still be in.' }),
        section(ROTATED_SEARCH_SOURCE, 'rs-mid', 'Look at the middle', 'while lo <= hi', 'return mid', {
            hint: 'Halve the range at mid; if nums[mid] is the target, done.' }),
        section(ROTATED_SEARCH_SOURCE, 'rs-left', 'Left half sorted: is the target in it?', 'if nums[lo] <= nums[mid]', 'lo = mid + 1', {
            hint: 'When nums[lo] ≤ nums[mid], the left half is in order, so one range check says whether the target lies there.',
            prompt: 'Explain why, in a rotated sorted array, at least one half around mid is always sorted, and how nums[lo] <= nums[mid] tells which.' }),
        // The outer else (the inner one, under the left half, comes first in the file).
        { ...section(ROTATED_SEARCH_SOURCE, 'rs-right', 'Otherwise the right half is sorted', 'else:', 'hi = mid - 1', {
            hint: 'The rotation point is on the left, so the right half is in order: check the target against it.' }),
            from: lineOf(ROTATED_SEARCH_SOURCE, 'else:', 'lo = mid + 1') },
        section(ROTATED_SEARCH_SOURCE, 'rs-none', 'The range is empty: not found', 'return -1', null, {
            hint: 'lo passed hi: every place the target could be was ruled out.' }),
    ],
    annotations: [
        doc('search_rotated', '`search_rotated(nums, target)` returns the index of `target` in a sorted array rotated at an unknown point, or −1. O(log n).'),
        doc('nums', 'A sorted array rotated at some index, so it rises, drops once, then rises again.'),
        doc('target', 'The value to find.'),
        doc('lo', 'The first index still in the search range.'),
        doc('hi', 'The last index still in the search range.'),
        doc('mid', 'The middle of the range, where it is split in two.'),
        docExpr(ROTATED_SEARCH_SOURCE, 'if nums[lo] <= nums[mid]', 'nums[lo] <= nums[mid]', 'No drop between lo and mid: the left half is sorted.'),
        docExpr(ROTATED_SEARCH_SOURCE, 'if nums[lo] <= target', 'nums[lo] <= target < nums[mid]', 'The target falls inside the sorted left half: search there.'),
        docExpr(ROTATED_SEARCH_SOURCE, 'if nums[mid] < target', 'nums[mid] < target <= nums[hi]', 'The target falls inside the sorted right half: search there.'),
    ],
    markdown: `# Halve the search (binary search)

**Signal:** data that is sorted *with a twist* (rotated, sorted rows and columns, or a monotone yes/no condition) and an O(log n) expectation.

A rotated sorted array is two sorted runs. Cut it at \`mid\` and **at least one half is fully sorted**: if \`nums[lo] ≤ nums[mid]\` the left half is, otherwise the right half is. A sorted half lets you check in O(1) whether the target lies inside it, so you still discard half the candidates each step. Highlighted cells are the candidates still in play. Target here: **${IN.rotated.target}**.

${MD_TAIL}

**Practice:** Search in Rotated Sorted Array, Find Minimum in Rotated Sorted Array, Search a 2D Matrix II.`,
    prompt: 'Explain why one half is always sorted and how that keeps O(log n). Ask the learner to predict which half survives before each step.',
    elements: [
        array('nums', 'nums', [-5.5, 1.2, 0], {
            from: inp('nums'), cellSize: 1.25, fontSize: 15,
            highlightExpr: `idx >= ${tr('lo')} and idx <= ${tr('hi')}`,
            markers: [marker('lo', tr('lo')), marker('mid', tr('mid'), PINK), marker('hi', tr('hi'))],
        }),
        label('lo', `concat('lo = ', ${tr('lo')})`, [-4.5, -2.6, 0], ['nums', tr('lo')]),
        // mid is wired to its cell, nums[mid]; while line 5 compares it with target, a comparison row shows the result, and a match glows.
        { ...label('mid', unset('mid'), [-4.5, -2.6, 0], undefined, MID_HIT), connectTo: { object: 'nums', indexExpr: tr('mid'), pinned: true } },
        label('hi', `concat('hi = ', ${tr('hi')})`, [-4.5, -2.6, 0], ['nums', tr('hi')]),
        label('half', `concat('sorted half = ', ${tr('half')} == 1 ? 'left' : (${tr('half')} == 2 ? 'right' : '—'))`, [4, -2.6, 0]),
        label('target', `concat('target = ', ${inp('target')})`, [4, -2.6, 0], undefined, MID_HIT),
        label('compare', `${tr('comparing')} == 1 ? concat('nums[mid] = ', arrayAt(${inp('nums')}, ${tr('mid')}), arrayAt(${inp('nums')}, ${tr('mid')}) == ${inp('target')} ? ' = target: found' : concat(' ≠ ', ${inp('target')})) : 'compare: —'`, [4, -2.6, 0], undefined, MID_HIT),
    ],
});

// ── Merge intervals ──
const ivs = IN.intervals.input;
/** Gantt view of the same state: input spans on two staggered lanes, the merged result growing on lane 0. */
const intervalChart = {
    id: 'timeline', type: 'chart', origin: [-5, -4.5, 0], size: [11, 2.2], xDomain: [0, 24], yDomain: [-0.5, 2.5],
    // Lanes are named on the chart's own y axis (ticks fall on 0, 1, 2), so names line up with their bars.
    axes: [{ ticks: 5 }, { ticks: 4, labels: ['merged', 'input', 'input'] }],
    intervals: [
        {
            color: '#74d0c2', countExpr: `arrayCount(${tr('starts')})`,
            startExpr: `arrayAt(${tr('starts')}, i)`, endExpr: `arrayAt(${tr('ends')}, i)`, laneExpr: `1 + arrayAt(${tr('lanes')}, i)`,
            highlightExpr: `i == ${tr('k')}`,
            labelExpr: `concat(arrayAt(${tr('starts')}, i), '–', arrayAt(${tr('ends')}, i))`,
        },
        {
            color: '#b69bea', countExpr: tr('m'),
            startExpr: `arrayAt(${tr('mStarts')}, i)`, endExpr: `arrayAt(${tr('mEnds')}, i)`, lane: 0,
            highlightExpr: `i == ${tr('m')} - 1 and (${tr('line')} == 6 or ${tr('line')} == 5)`,
            labelExpr: `concat(arrayAt(${tr('mStarts')}, i), '–', arrayAt(${tr('mEnds')}, i))`,
        },
    ],
};
pattern({
    id: 'merge-intervals', title: 'Merge overlapping ranges (intervals)', file: 'merge_intervals.py', source: MERGE_INTERVALS_SOURCE,
    input: { intervals: ivs.map(([s, e]) => `[${s},${e}]`) }, trace: mergeIntervalsTrace(ivs), cameraX: -1,
    sections: [
        section(MERGE_INTERVALS_SOURCE, 'mi-sort', 'Sort by start', 'def merge(', 'intervals.sort(', {
            hint: 'Sorted by start, intervals that overlap sit next to each other.',
            prompt: 'Explain why sorting by start means an interval can only overlap the last merged one, never an earlier one.' }),
        section(MERGE_INTERVALS_SOURCE, 'mi-walk', 'Walk the intervals, building merged', 'merged = []', 'for start, end in', {
            hint: 'merged holds the result so far; its last interval is the only one the next can touch.' }),
        section(MERGE_INTERVALS_SOURCE, 'mi-overlap', 'Overlap: stretch the last interval', 'if merged and start', 'merged[-1][1] = max(', {
            hint: 'It starts before the last one ends: they merge, and the end is the later of the two.' }),
        section(MERGE_INTERVALS_SOURCE, 'mi-new', 'No overlap: start a new interval', 'else:', 'merged.append(', {
            hint: 'A gap before it: it begins a new merged interval.' }),
        section(MERGE_INTERVALS_SOURCE, 'mi-done', 'Return the merged list', 'return merged', null, {
            hint: 'O(n log n) for the sort, then one pass.' }),
    ],
    annotations: [
        doc('merge', '`merge(intervals)` returns the intervals with every overlapping group joined into one, sorted by start. O(n log n).'),
        doc('intervals', 'The input intervals, each `[start, end]`.'),
        doc('merged', 'The merged intervals so far, in order; only the last one can still grow.'),
        doc('start', 'Where the current interval begins.'),
        doc('end', 'Where the current interval ends.'),
        docExpr(MERGE_INTERVALS_SOURCE, 'intervals.sort(', 'key=lambda iv: iv[0]', 'Order by start point.'),
        docExpr(MERGE_INTERVALS_SOURCE, 'if merged and start', 'start <= merged[-1][1]', 'It begins before (or where) the last merged interval ends: they overlap.'),
        docExpr(MERGE_INTERVALS_SOURCE, 'merged[-1][1] = max(', 'max(merged[-1][1], end)', 'The later end: an interval inside the last one must not shrink it.'),
    ],
    markdown: `# Merge overlapping ranges (intervals)

**Signal:** meetings, bookings, ranges, or anything with a start and an end.

Sort by start time. After sorting, an interval can only overlap the group immediately before it, so a single sweep suffices: if the next interval starts at or before the last merged end, extend that end; otherwise start a new group. The chart below draws the same state as bars: input intervals on the upper lanes, and the merged groups growing on the bottom lane as the sweep runs.

Sorting dominates: O(n log n) time.

${MD_TAIL}

**Practice:** Merge Intervals, Insert Interval, Non-overlapping Intervals.`,
    prompt: 'Explain why sorting by start means only the last merged interval can overlap the next one. Ask the learner to predict whether the next interval extends the last group or starts a new one.',
    elements: [
        intervalChart,
        array('starts', 'start', [-4, 3.0, 0], {
            from: tr('starts'), showIndices: false, highlightExpr: `idx == ${tr('k')}`, markers: [marker('k', tr('k'))],
        }),
        array('ends', 'end', [-4, 2.15, 0], { from: tr('ends'), highlightExpr: `idx == ${tr('k')}` }),
        array('merged-starts', 'merged start', [-4, 0.05, 0], { from: tr('mStarts'), color: '#b69bea', showIndices: false,
            // The group lines 5-6 compare with and extend: merged[-1], start and end together.
            highlightExpr: `idx == ${tr('m')} - 1 and (${tr('line')} == 6 or ${tr('line')} == 5)` }),
        array('merged-ends', 'merged end', [-4, -0.8, 0], {
            from: tr('mEnds'), showIndices: true, color: '#b69bea', highlightExpr: `idx == ${tr('m')} - 1 and (${tr('line')} == 6 or ${tr('line')} == 5)`,
        }),
        label('k', unset('k'), [5, 0.6, 0], ['starts', tr('k')]),
        label('m', `concat('len(merged) = ', ${tr('m')})`, [5, 0.6, 0], ['merged-ends', `${tr('m')} - 1`]),
        // Line 5's overlap check, glowing when the interval extends the last group, and wired to both
        // values it compares: start[k] and the end of the group that was last when it ran.
        { ...label('compare', `${tr('cmp')} == -2 ? 'compare: —' : (${tr('cmp')} == -1 ? 'merged is empty: append' : (${tr('cmp')} == 1 ? concat(${tr('cmpStart')}, ' ≤ ', ${tr('cmpEnd')}, ': overlap, extend') : concat(${tr('cmpStart')}, ' > ', ${tr('cmpEnd')}, ': no overlap, append')))`, [5, 0.6, 0], undefined, `${tr('cmp')} == 1`),
          connectTo: [
            { object: 'starts', indexExpr: `${tr('cmp')} >= -1 ? ${tr('k')} : -1`, pinned: true },
            { object: 'merged-ends', indexExpr: `${tr('cmp')} >= 0 ? ${tr('cmpIdx')} : -1`, pinned: true },
          ] },
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

**Practice:** Climbing Stairs, House Robber, Coin Change, Longest Common Subsequence, Longest Increasing Subsequence, Partition Equal Subset Sum.`,
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
        // The cells the recurrence reads and writes, each wired to its cell and to the line that uses it (none before the loop).
        ...([['dp[i-1]', 'dp', 1, 5], ['dp[i-2]', 'dp', 2, 6], ['houses[i-1]', 'houses', 1, 6], ['dp[i]', 'dp', 0, 7]] as const).map(([text, arr, back, line]) => {
            const at = back ? `${tr('i')} - ${back}` : tr('i');
            const from = arr === 'dp' ? tr('dp') : inp('houses');
            return { ...label(`expr-${text.replace(/\W/g, '')}`, `${tr('i')} < 2 ? '${text}: —' : concat('${text} = ', arrayAt(${from}, ${at}))`, [3.2, -3.6, 0], [arr, `${tr('i')} < 2 ? -1 : ${at}`]),
                codeRef: { file: 'dynamic-programming', line } };
        }),
        // The answer: the last cell, returned on line 8; it fills in as the loop reaches it.
        ...((last: string) => [{ ...label('expr-dplast', `concat('dp[-1] = ', arrayAt(${tr('dp')}, ${last}))`, [3.2, -3.6, 0], ['dp', last]),
            codeRef: { file: 'dynamic-programming', line: 8 } }])(`arrayCount(${tr('dp')}) - 1`),
    ],
});


// ── 2D dynamic programming ──
(() => {
    const { a, b } = IN.lcs;
    const x0 = -3.4, y0 = 1.9, size = 1.0, rowY = (k: number) => +(y0 - k * size).toFixed(2);
    const i = tr('i'), j = tr('j'), line = tr('line');
    // One array per table row, untitled: b runs down the left beside them, its letter i − 1 level with row i.
    const rows = Array.from({ length: b.length + 1 }, (_, k) => array(`row${k}`, '', [x0, rowY(k), 0], {
        from: tr(`r${k}`), cellSize: size, fontSize: 14, color: '#b69bea', showIndices: false,
        highlightExpr: `${i} == ${k} and idx == ${j} and ${j} >= 1`,
        // The cells the recurrence reads: the diagonal on a match (line 6), above and left otherwise (line 8).
        colorExpr: `(${line} == 6 and ${i} - 1 == ${k} and idx == ${j} - 1) or (${line} == 8 and ((${i} - 1 == ${k} and idx == ${j}) or (${i} == ${k} and idx == ${j} - 1))) ? '${PINK}' : ''`,
    }));
    const inRow = (indexAt: (k: number) => string) => rows.map((_, k) => ({ object: `row${k}`, indexExpr: indexAt(k), pinned: true }));
    const vars: [number, number, number] = [6.2, 1.6, 0];
    pattern({
        id: 'dp-2d', title: 'Fill a table (2D dynamic programming)', file: 'lcs.py', source: LCS_SOURCE,
        input: { a: [...a], b: [...b] }, trace: lcsTrace(a, b),
        markdown: `# Fill a table (2D dynamic programming)

**Signal:** two sequences to align or compare (common subsequence, edit distance), or a grid walked right and down. The state needs two indices.

Longest common subsequence: let \`dp[i][j]\` be the LCS length of the first i letters of b and the first j of a. Compare the last letters of the two prefixes:

$$dp[i][j] = \\begin{cases} dp[i-1][j-1] + 1 & b[i-1] = a[j-1] \\\\ \\max(dp[i-1][j],\; dp[i][j-1]) & \\text{otherwise} \\end{cases}$$

A match extends the best answer without both letters; otherwise one of the two letters is not used, so drop either and keep the better. Row 0 and column 0 are empty prefixes, 0. Every cell reads only cells above and to the left, so filling row by row works: O(m·n) time and space (O(n) if you keep two rows).

${MD_TAIL}

**Practice:** Longest Common Subsequence, Edit Distance, Unique Paths, Minimum Path Sum, Longest Palindromic Subsequence.`,
        prompt: 'Explain the 2D state and why each cell depends only on cells above and to the left. Ask the learner to predict each cell (match: diagonal + 1; else the max of above and left) before the player reveals it.',
        elements: [
            // a across the top, its letter j − 1 over table column j.
            array('a', 'a', [x0 + size, +(y0 + 1.25).toFixed(2), 0], {
                from: inp('a'), itemType: 'character', cellSize: size, fontSize: 14, showIndices: false,
                highlightExpr: `idx == ${j} - 1 and ${tr('match')} >= 0`,
                markers: [marker('j − 1', `${j} - 1`, GOLD, `${j} >= 1`)],
            }),
            array('b', 'b', [x0 - size - 0.25, rowY(1), 0], {
                from: inp('b'), itemType: 'character', cellSize: size, fontSize: 14, showIndices: false, labelSide: 'top',
                direction: [0, -1, 0], arraySpacing: size,
                highlightExpr: `idx == ${i} - 1 and ${tr('match')} >= 0`,
            }),
            ...rows,
            // The loop indexes, wired to the letters heading their row and column (b's i − 1, a's j − 1).
            { ...label('loop-i', `${i} < 1 ? 'i: —' : concat('i = ', ${i})`, vars), codeRef: { file: 'dp-2d', line: 3 },
                connectTo: { object: 'b', indexExpr: `${i} >= 1 ? ${i} - 1 : -1` } },
            { ...label('loop-j', `${j} < 1 ? 'j: —' : concat('j = ', ${j})`, vars), codeRef: { file: 'dp-2d', line: 4 },
                connectTo: { object: 'a', indexExpr: `${j} >= 1 ? ${j} - 1 : -1` } },
            { ...label('b-i', `${i} < 1 or ${tr('match')} < 0 ? 'b[i-1]: —' : concat('b[i-1] = ', ${tr('cb')})`, vars, ['b', `${i} < 1 or ${tr('match')} < 0 ? -1 : ${i} - 1`]), codeRef: { file: 'dp-2d', line: 5 } },
            { ...label('a-j', `${tr('match')} < 0 ? 'a[j-1]: —' : concat('a[j-1] = ', ${tr('ca')})`, vars, ['a', `${tr('match')} < 0 ? -1 : ${j} - 1`]), codeRef: { file: 'dp-2d', line: 5 } },
            // Line 5's condition, evaluated: glows on that line and wires to both letters it compares.
            { ...label('cond', `${tr('match')} < 0 ? 'b[i-1] == a[j-1]: —' : (${tr('match')} == 1 ? 'b[i-1] == a[j-1] → True' : 'b[i-1] == a[j-1] → False')`, vars, undefined, `${line} == 5`),
                connectTo: [{ object: 'b', indexExpr: `${tr('match')} < 0 ? -1 : ${i} - 1` }, { object: 'a', indexExpr: `${tr('match')} < 0 ? -1 : ${j} - 1` }],
                codeRef: { file: 'dp-2d', line: 5 } },
            { ...label('diag', `${tr('diag')} < 0 ? 'dp[i-1][j-1]: —' : concat('dp[i-1][j-1] = ', ${tr('diag')})`, vars, undefined, `${line} == 6`),
                connectTo: inRow(k => `${tr('diag')} >= 0 and ${i} - 1 == ${k} ? ${j} - 1 : -1`), codeRef: { file: 'dp-2d', line: 6 } },
            { ...label('up', `${tr('up')} < 0 ? 'dp[i-1][j]: —' : concat('dp[i-1][j] = ', ${tr('up')})`, vars, undefined, `${line} == 8`),
                connectTo: inRow(k => `${tr('up')} >= 0 and ${i} - 1 == ${k} ? ${j} : -1`), codeRef: { file: 'dp-2d', line: 8 } },
            { ...label('left', `${tr('left')} < 0 ? 'dp[i][j-1]: —' : concat('dp[i][j-1] = ', ${tr('left')})`, vars, undefined, `${line} == 8`),
                connectTo: inRow(k => `${tr('left')} >= 0 and ${i} == ${k} ? ${j} - 1 : -1`), codeRef: { file: 'dp-2d', line: 8 } },
            { ...label('cell', `${j} < 1 ? 'dp[i][j]: —' : concat('dp[i][j] = ', ${rows.map((_, k) => `(${i} == ${k} ? arrayAt(${tr(`r${k}`)}, ${j}) : 0)`).join(' + ')})`, vars),
                connectTo: inRow(k => `${j} >= 1 and ${i} == ${k} ? ${j} : -1`) },
            { ...label('answer', `concat('dp[-1][-1] = ', arrayAt(${tr(`r${b.length}`)}, ${a.length}))`, vars, [`row${b.length}`, String(a.length)]), codeRef: { file: 'dp-2d', line: 9 } },
        ],
    });
})();

// ── Monotonic queue ──
pattern({
    id: 'monotonic-queue', title: 'Max of every window (monotonic queue)', file: 'monotonic_queue.py', source: MONOTONIC_QUEUE_SOURCE,
    input: { nums: IN.monoQueue.nums, k: IN.monoQueue.k }, trace: monotonicQueueTrace(IN.monoQueue.nums, IN.monoQueue.k),
    sections: [
        section(MONOTONIC_QUEUE_SOURCE, 'mq-setup', 'An empty deque of indices', 'def max_sliding_window(', 'dq, out = deque(), []', {
            hint: 'The deque will hold indices, not values: an index also says when it leaves the window.' }),
        section(MONOTONIC_QUEUE_SOURCE, 'mq-back', 'A new value evicts the smaller ones behind it', 'for i, x in enumerate', 'dq.append(i)', {
            hint: 'Pop from the back while the value there is no bigger than x: none of them can be a maximum while x is in the window.',
            prompt: 'Explain why a smaller value behind a newer, bigger one can never be a window maximum again.' }),
        section(MONOTONIC_QUEUE_SOURCE, 'mq-front', 'The front leaves once it slides out', 'if dq[0] <= i - k', 'dq.popleft()', {
            hint: 'The front is the oldest index kept; once it is k or more steps back it is outside the window.' }),
        section(MONOTONIC_QUEUE_SOURCE, 'mq-out', 'A full window reports its front', 'if i >= k - 1', 'out.append(nums[dq[0]])', {
            hint: 'From the k-th number on, every step closes a window; its maximum is the value at the front.' }),
        section(MONOTONIC_QUEUE_SOURCE, 'mq-done', 'One maximum per window', 'return out', null, {
            hint: 'Each index enters and leaves the deque at most once: O(n) for all windows.' }),
    ],
    annotations: [
        doc('max_sliding_window', '`max_sliding_window(nums, k)` returns the maximum of every window of `k` consecutive numbers. O(n).'),
        doc('nums', 'The numbers the window slides over.'),
        doc('k', 'The window size.'),
        doc('dq', 'Indices of the numbers that may still be a window maximum. Their values decrease from front to back; the front is the maximum.'),
        doc('out', 'The maximum of each full window, in order.'),
        doc('i', 'The index of the number entering the window.'),
        doc('x', 'The number entering the window, `nums[i]`.'),
        doc('deque', 'A double-ended queue: O(1) push and pop at both ends.'),
        docExpr(MONOTONIC_QUEUE_SOURCE, 'while dq and', 'nums[dq[-1]] <= x', 'The value at the back is no bigger than the newcomer: it can never be a maximum again.'),
        docBlock(MONOTONIC_QUEUE_SOURCE, 'while dq and', 'dq.pop()', 'Every index is popped at most once in the whole run, so all these pops together cost O(n).'),
        docExpr(MONOTONIC_QUEUE_SOURCE, 'if dq[0] <= i - k', 'i - k', 'The last index that has slid out: the window is now `i - k + 1 .. i`.'),
        docExpr(MONOTONIC_QUEUE_SOURCE, 'if dq[0] <= i - k', 'dq[0] <= i - k', 'The front index is outside the window, so it is dropped.'),
        docExpr(MONOTONIC_QUEUE_SOURCE, 'if i >= k - 1', 'i >= k - 1', 'The window is full: it holds `k` numbers.'),
        docExpr(MONOTONIC_QUEUE_SOURCE, 'out.append(nums[dq[0]])', 'nums[dq[0]]', 'The value at the front: the maximum of this window.'),
    ],
    markdown: `# Max of every window (monotonic queue)

**Signal:** the maximum (or minimum) of every window of size k, or "the best value within the last k steps".

Keep a **deque of indices** whose values decrease from front to back. A new value first evicts every smaller value from the back: those can never be a maximum while the new one is in the window. The front is then the window maximum, once indices that slid out of the window are dropped from the front.

Each index enters and leaves the deque at most once, so all windows cost O(n) instead of O(n·k). It is the monotonic stack's idea with an exit at both ends. Window size here: **${IN.monoQueue.k}**.

${MD_TAIL}

**Practice:** Sliding Window Maximum, Shortest Subarray with Sum at Least K, Constrained Subsequence Sum.`,
    prompt: 'Explain why smaller values behind a new value can be discarded, and why the front is the maximum. Ask the learner to predict which indices the next value evicts.',
    elements: [
        array('nums', 'nums', [-4.5, 2.3, 0], {
            from: inp('nums'), highlightExpr: `idx >= ${tr('left')} and idx <= ${tr('i')}`,
            markers: [marker('i', tr('i')), marker('dq[0]', tr('front'), PINK)],
        }),
        // Each deque cell holds an index into nums: link it to the value it names.
        array('deque', 'deque', [-4.5, -0.2, 0], { from: tr('dq'), color: BLUE, showIndices: false, connectTo: { object: 'nums', indexExpr: 'value', pinned: true } }),
        array('out', 'out', [-4.5, -2.4, 0], { from: tr('out'), color: '#b69bea' }),
        // Vars, wired to the cell they name; and each condition as a row that glows on its line and wires to what it reads.
        { ...label('i', unset('i'), [5, -3.9, 0]), connectTo: { object: 'nums', indexExpr: tr('i'), pinned: true } },
        { ...label('x', `concat('x = ', ${tr('i')} < 0 ? 'unset' : ${tr('x')})`, [5, -3.9, 0]), connectTo: { object: 'nums', indexExpr: tr('i'), pinned: true } },
        label('k', `concat('k = ', ${inp('k')})`, [5, -3.9, 0]),
        // The deque's front: the index of the window maximum, checked against i - k on line 9 (none while empty).
        { ...label('dq-front', `arrayCount(${tr('dq')}) == 0 ? 'dq[0]: —' : concat('dq[0] = ', arrayAt(${tr('dq')}, 0))`, [5, -3.9, 0]),
            connectTo: { object: 'nums', indexExpr: `arrayCount(${tr('dq')}) == 0 ? -1 : arrayAt(${tr('dq')}, 0)` }, codeRef: { file: 'monotonic-queue', line: 9 } },
        // The window maximum: the value at the deque's front, appended to out on line 12 (none while empty).
        { ...label('dq-front-value', `arrayCount(${tr('dq')}) == 0 ? 'nums[dq[0]]: —' : concat('nums[dq[0]] = ', arrayAt(${inp('nums')}, arrayAt(${tr('dq')}, 0)))`, [5, -3.9, 0]),
            connectTo: { object: 'nums', indexExpr: `arrayCount(${tr('dq')}) == 0 ? -1 : arrayAt(${tr('dq')}, 0)` }, codeRef: { file: 'monotonic-queue', line: 12 } },
        // What the while condition compares with x: the value at the deque's back (none while it is empty).
        ...((back: string) => [{ ...label('dq-back', `arrayCount(${tr('dq')}) == 0 ? 'nums[dq[-1]]: —' : concat('nums[dq[-1]] = ', arrayAt(${inp('nums')}, ${back}))`, [5, -3.9, 0]),
            connectTo: { object: 'nums', indexExpr: `arrayCount(${tr('dq')}) == 0 ? -1 : ${back}` }, codeRef: { file: 'monotonic-queue', line: 6 } }])(`arrayAt(${tr('dq')}, arrayCount(${tr('dq')}) - 1)`),
        { ...label('cond-w', tr('cond_w'), [4.5, -1.3, 0], undefined, `${tr('line')} == 6`), codeRef: { file: 'monotonic-queue', line: 6 },
          connectTo: [
            { object: 'nums', indexExpr: `${tr('line')} == 6 ? ${tr('back')} : -1`, pinned: true },
            { object: 'nums', indexExpr: `${tr('line')} == 6 and ${tr('back')} >= 0 ? ${tr('i')} : -1`, pinned: true },
          ] },
        { ...label('cond-e', tr('cond_e'), [4.5, -1.3, 0], undefined, `${tr('line')} == 9`), codeRef: { file: 'monotonic-queue', line: 9 },
          connectTo: { object: 'deque', indexExpr: `${tr('line')} == 9 ? 0 : -1`, pinned: true } },
        { ...label('cond-f', tr('cond_f'), [4.5, -1.3, 0], undefined, `${tr('line')} == 11`), codeRef: { file: 'monotonic-queue', line: 11 } },
    ],
});

// ── Greedy ──
pattern({
    id: 'greedy', title: 'Take the best step now (greedy)', file: 'greedy.py', source: GREEDY_SOURCE,
    input: { nums: IN.greedy.nums }, trace: greedyTrace(IN.greedy.nums),
    sections: [
        section(GREEDY_SOURCE, 'gr-start', 'Start: only index 0 is reachable', 'def can_jump(', 'reach = 0', {
            hint: 'reach is the farthest index known to be reachable.' }),
        section(GREEDY_SOURCE, 'gr-stuck', 'An index past reach: stuck', 'for i, jump in', 'return False', {
            hint: 'If i is beyond reach, no earlier jump gets here, so the end can never be reached.' }),
        section(GREEDY_SOURCE, 'gr-reach', 'Push the reach as far as it goes', 'reach = max(reach, i + jump)', 'return True', {
            hint: 'From i you can land anywhere up to i + jump: keep the farthest. Every index was reachable, so the end is too.',
            prompt: 'Explain why tracking only the farthest reachable index is enough, with no need to try each jump length (the greedy choice).' }),
    ],
    annotations: [
        doc('can_jump', '`can_jump(nums)` says whether you can get from index 0 to the last index, where `nums[i]` is the longest jump from i. O(n).'),
        doc('nums', '`nums[i]`: the farthest you can jump from index i.'),
        doc('reach', 'The farthest index reachable using the indices seen so far.'),
        doc('i', 'The index being stood on.'),
        doc('jump', 'The longest jump from index i: `nums[i]`.'),
        docExpr(GREEDY_SOURCE, 'if i > reach', 'i > reach', 'No jump so far lands on i: there is a gap.'),
        docExpr(GREEDY_SOURCE, 'reach = max(reach, i + jump)', 'i + jump', 'The farthest index a jump from i can land on.'),
    ],
    markdown: `# Take the best step now (greedy)

**Signal:** a sequence of choices where the locally best choice never hurts later ones, often "can you reach…", "minimum number of…", or scheduling.

Jump game: each value is the longest jump allowed from that index. Instead of exploring every path, keep one number, **reach**: the farthest index any path found so far can get to. Walking left to right, every index up to reach is reachable (gold), and each one may push reach farther. If the walk ever steps past reach, the rest is cut off.

A greedy solution needs an argument for why the local choice is safe; here, any index within reach is as good as any other for extending it. O(n) time, O(1) space.

${MD_TAIL}

**Practice:** Jump Game, Jump Game II, Gas Station, Non-overlapping Intervals.`,
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
    sections: [
        section(BITS_SOURCE, 'bt-start', 'Start from 0', 'def single_number(', 'result = 0', {
            hint: 'x ^ 0 is x: 0 changes nothing.' }),
        section(BITS_SOURCE, 'bt-xor', 'XOR every number in', 'for x in nums', 'result ^= x', {
            hint: 'A number XORed in twice cancels out (x ^ x = 0), so only the one that appears once is left.',
            prompt: 'Explain why XOR-ing all the numbers leaves the single one, using x ^ x = 0, x ^ 0 = x, and that the order does not matter.' }),
        section(BITS_SOURCE, 'bt-done', 'What is left is the single number', 'return result', null, {
            hint: 'O(n) time, O(1) space: no set needed.' }),
    ],
    annotations: [
        doc('single_number', '`single_number(nums)` returns the one number that appears once when every other appears twice. O(n) time, O(1) space.'),
        doc('nums', 'The input: every number twice, except one.'),
        doc('result', 'The XOR of the numbers so far: the pairs cancel, leaving the unmatched ones.'),
        doc('x', 'The number being XORed in.'),
        docExpr(BITS_SOURCE, 'result ^= x', '^=', 'XOR: a bit is 1 when the two bits differ. Twice the same x flips the same bits back.'),
    ],
    markdown: `# Flip bits (bit manipulation)

**Signal:** "appears once / twice", parity, subsets as bitmasks, powers of two, or an O(1)-space requirement on integers.

XOR has two facts that do all the work: \`a ^ a = 0\` and \`a ^ 0 = a\`, and it does not care about order. XOR every number together and each pair cancels, leaving the number that appears once. Watch the result's bits: each step flips exactly the bits where x has a 1 (gold).

Other everyday tricks: \`x & (x − 1)\` clears the lowest set bit, \`x & −x\` isolates it, and the bits of a counter from 0 to 2ⁿ − 1 enumerate every subset.

${MD_TAIL}

**Practice:** Single Number, Number of 1 Bits, Counting Bits, Missing Number, Subsets (as bitmasks).`,
    prompt: 'Explain XOR cancellation bit by bit. Ask the learner to predict the result bits before each step.',
    elements: [
        array('nums', 'nums', [-4.5, 2.5, 0], { from: inp('nums'), highlightExpr: `idx == ${tr('k')}`, markers: [marker('k', tr('k'))] }),
        // A worked XOR: result before, then x, then result; on line 4 the bits x flipped glow in the result row.
        array('before-bits', 'result before', [-2, 0.9, 0], { from: tr('bBits'), color: '#b69bea', showIndices: false }),
        array('x-bits', 'x', [-2, -0.05, 0], { from: tr('xBits'), showIndices: false, highlightExpr: 'value == 1' }),
        array('result-bits', 'result', [-2, -1.0, 0], { from: tr('rBits'), color: '#b69bea', showIndices: false,
            highlightExpr: `${tr('line')} == 4 and arrayAt(${tr('xBits')}, idx) == 1` }),
        label('x', `concat('x = ', ${tr('k')} < 0 ? 'unset' : ${tr('x')})`, [4, -0.4, 0], ['nums', tr('k')]),
        label('result', `concat('result = ', ${tr('result')})`, [4, -0.4, 0]),
    ],
});

// ── String matching ──
pattern({
    id: 'string-matching', title: 'Find a word fast (KMP string matching)', file: 'kmp.py', source: KMP_SOURCE,
    input: { text: [...IN.kmp.text], pattern: [...IN.kmp.pattern] }, trace: kmpTrace(IN.kmp.text, IN.kmp.pattern),
    sections: [
        section(KMP_SOURCE, 'kmp-lps-start', 'Start the table with no borders', 'def build_lps(', 'lps, k = [0]', {
            hint: 'lps[0] is 0: one character has no proper border. k, the border being grown, starts empty.' }),
        section(KMP_SOURCE, 'kmp-lps-fall', 'Mismatch: fall back to a shorter border', 'for i in range(1', 'k = lps[k - 1]', {
            hint: 'While p[i] cannot extend the border p[0..k−1], shrink it to that border\'s own longest border, lps[k − 1].',
            prompt: 'Explain why lps[k − 1] is the next border worth trying when p[i] does not extend the border of length k, and why no border in between can work.' }),
        section(KMP_SOURCE, 'kmp-lps-grow', 'Extend the border and record it', 'if p[i] == p[k]', 'return lps', {
            hint: 'If p[i] continues the border it grows by one; either way lps[i] is the border\'s length now.' }),
        section(KMP_SOURCE, 'kmp-start', 'Build the table, then scan the text', 'def kmp_search(', 'lps, k, hits =', {
            hint: 'The table comes from the pattern alone; k counts how much of p matches the text so far.' }),
        section(KMP_SOURCE, 'kmp-fall', 'Mismatch: keep the longest border', 'for i, ch in enumerate', 'k = lps[k - 1]', {
            hint: 'The text pointer never moves back: on a mismatch only k shrinks, to lps[k − 1].',
            prompt: 'Explain why, on a mismatch, the text pointer can stay where it is and only k falls back to lps[k − 1], and why that makes the scan O(n).' }),
        section(KMP_SOURCE, 'kmp-grow', 'Match: one more character', 'if ch == p[k]', 'k += 1', {
            hint: 'ch continues the match: k grows by one.' }),
        section(KMP_SOURCE, 'kmp-hit', 'All of p matched: record it, keep the overlap', 'if k == len(p)', 'k = lps[k - 1]', {
            hint: 'A match ends at i, so it starts at i − k + 1; falling back to lps[k − 1] still finds overlapping matches.',
            prompt: 'Explain why, after a full match, k falls back to lps[k − 1] instead of 0, with an example of overlapping matches.' }),
        section(KMP_SOURCE, 'kmp-done', 'Return every start', 'return hits', null, {
            hint: 'One pass over the text: O(n + m) with the table.' }),
    ],
    annotations: [
        doc('build_lps', '`build_lps(p)` returns the `lps` table of the pattern: for each prefix `p[0..i]`, the length of its longest proper prefix that is also a suffix (its longest border). O(m).'),
        doc('kmp_search', '`kmp_search(text, p)` returns every index where `p` starts in `text`, overlaps included. O(n + m).'),
        doc('p', 'The pattern to find.'),
        doc('text', 'The text searched, read once from left to right.'),
        doc('lps', '`lps[i]`: the length of the longest proper prefix of `p[0..i]` that is also its suffix. After a mismatch it says how much of the match can be kept.'),
        doc('hits', 'The indices where a match of `p` starts, in order.'),
        doc('ch', 'The text character being read: `text[i]`.'),
        doc('i', 'The pattern position whose `lps` entry is being worked out.', { source: KMP_SOURCE, start: 'def build_lps(', end: 'return lps' }),
        doc('k', 'The length of the border being grown: `p[0..k−1]` matches the characters just before `p[i]`.', { source: KMP_SOURCE, start: 'def build_lps(', end: 'return lps' }),
        doc('i', 'The index of the text character being read. It only moves forward.', { source: KMP_SOURCE, start: 'def kmp_search(', end: 'return hits' }),
        doc('k', 'How many characters of `p` match the text ending just before `ch`.', { source: KMP_SOURCE, start: 'def kmp_search(', end: 'return hits' }),
        docExpr(KMP_SOURCE, 'lps, k = [0]', '[0] * len(p)', 'One entry per prefix of `p`; `lps[0]` stays 0.'),
        docExpr(KMP_SOURCE, 'while k and p[i] != p[k]', 'p[i] != p[k]', '`p[i]` does not continue the border `p[0..k−1]`.'),
        docExpr(KMP_SOURCE, 'k = lps[k - 1]', 'lps[k - 1]', 'The border of the border: the next shorter prefix that still ends right here.'),
        docExpr(KMP_SOURCE, 'lps[i] = k', 'lps[i] = k', 'The longest border of `p[0..i]` is `k` long.'),
        docExpr(KMP_SOURCE, 'while k and ch != p[k]', 'ch != p[k]', '`ch` does not continue the `k` characters matched so far.'),
        docBlock(KMP_SOURCE, 'while k and ch != p[k]', 'k = lps[k - 1]', 'k grows by at most 1 per character and each fallback shrinks it, so all the fallbacks together cost at most n steps: the scan stays O(n).'),
        docExpr(KMP_SOURCE, 'if k == len(p)', 'k == len(p)', 'Every character of `p` matched.'),
        docExpr(KMP_SOURCE, 'hits.append(i - k + 1)', 'i - k + 1', 'The match ends at `i` and is `k` long, so it starts at `i − k + 1`.'),
        (() => { const line = lineOf(KMP_SOURCE, 'k = lps[k - 1]', 'hits.append'), col = KMP_SOURCE.split('\n')[line - 1]!.indexOf('lps[k - 1]');
            return { line, col, endCol: col + 'lps[k - 1]'.length, text: 'Keep the longest border of the whole match, so a match overlapping this one is still found.' }; })(),
    ],
    markdown: `# Find a word fast (KMP string matching)

**Signal:** find every occurrence of a pattern in a text, repeated-substring questions, or "longest prefix that is also a suffix".

The naive search restarts one character later after every mismatch: O(n·m). KMP first precomputes, for every prefix of the pattern, the length of its longest proper **border** (a prefix that is also a suffix): the \`lps\` table. On a mismatch it keeps that border as already matched instead of starting over, so the text pointer **never moves backwards**. Total cost O(n + m).

Phase 1 builds \`lps\` from the pattern itself; phase 2 scans the text. Gold text cells are the stretch currently matched by the pattern's prefix.

${MD_TAIL}

**Practice:** Find the Index of the First Occurrence in a String, Repeated Substring Pattern, Shortest Palindrome.`,
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
        // Each while/if condition as a row with its last evaluation; the row for the line running now glows,
        // wires to the cells it compares, and links to its line. Build rows show in phase 1, search rows in phase 2.
        ...([
            ['bw', 4, 1], ['bi', 6, 1], ['sw', 14, 2], ['si', 16, 2], ['sm', 18, 2],
        ] as const).map(([row, line, phase]) => ({
            ...label(`cond-${row}`, tr(`cond_${row}`), [4.5, -2.3, 0], undefined, `${tr('line')} == ${line}`),
            visibleExpr: `${tr('phase')} == ${phase}`,
            codeRef: { file: 'string-matching', line },
            connectTo: [
                { object: 'text', indexExpr: `${tr('line')} == ${line} ? ${tr('cmpT')} : -1`, pinned: true },
                { object: 'pattern', indexExpr: `${tr('line')} == ${line} ? ${tr('cmpA')} : -1`, pinned: true },
                { object: 'pattern', indexExpr: `${tr('line')} == ${line} ? ${tr('cmpB')} : -1`, pinned: true },
            ],
        })),
    ],
});

// ── Union-find ──
/**
 * The union-find run as a forest: each node points at its parent (roots at nothing), laid out per frame with
 * every tree's root on top and its children below, roots side by side. Per frame and node: where it sits, and
 * whether its edge to the parent is on the current find's climb (`path`) or is the union just made (`union`).
 * Rows are frame * n + node, one table for the whole run.
 */
const COMPONENT_COLORS = ['#77bfae', '#efa768', '#b69bea', '#e67db0', '#75bfe9', '#f1c65b'];
function unionFindForest(n: number, run: ReturnType<typeof unionFindTrace>) {
    const rows: Json[] = [];
    for (const f of run) {
        const parent = f.parent as number[], kids: number[][] = parent.map(() => []);
        parent.forEach((p, i) => { if (p !== i) kids[p]!.push(i); });
        const at: [number, number][] = [];
        let cursor = 0;
        const place = (u: number, depth: number): number => {
            const xs = kids[u]!.map(c => place(c, depth + 1));
            const x = xs.length ? (xs[0]! + xs.at(-1)!) / 2 : cursor++;
            at[u] = [x, depth]; return x;
        };
        parent.forEach((p, i) => { if (p === i) place(i, 0); });
        // The climb so far: from the node being found up to x, its edges lit.
        const start = f.x < 0 ? -1 : f.ra < 0 ? f.a : f.b, path = new Set<number>();
        for (let u = start; u >= 0 && u !== f.x; u = parent[u]!) path.add(u);
        // The input graph so far: each edge up to the current one, drawn once from its first end; components
        // coloured by their root, so groups share a colour and a union recolours one of them.
        const root = (u: number) => { while (parent[u] !== u) u = parent[u]!; return u; };
        const seen = IN.unionFind.edges.filter((_, j) => j <= f.e);
        // The forest on the right (roots side by side on top, each level 1.4 lower), the graph on the left.
        for (let i = 0; i < n; i++) rows.push({ x: +(3.6 + (at[i]![0] - (cursor - 1) / 2) * 1.25).toFixed(3), y: +(-0.2 - at[i]![1] * 1.4).toFixed(3),
            path: path.has(i) ? 1 : 0, union: f.line === 10 && i === f.rb ? 1 : 0,
            to: seen.filter(([a]) => a === i).map(([, b]) => b), comp: COMPONENT_COLORS[root(i) % COMPONENT_COLORS.length]!,
            cur: f.e >= 0 && IN.unionFind.edges[f.e]![0] === i ? IN.unionFind.edges[f.e]![1] : -1 });
    }
    return rows;
}

const ufRun = unionFindTrace(IN.unionFind.n, IN.unionFind.edges), ufN = IN.unionFind.n;
const uf = (col: string) => `dataTable('forest', frame * ${ufN} + idx, '${col}')`;

/** Step 2 of the union-find scene: the same run, drawn as the forest the parent array stores. */
function unionFindForestStep(n: number, run: ReturnType<typeof unionFindTrace>) {
    return {
        data: { forest: unionFindForest(n, run) },
        locations: run.map((f, snapshot) => ({ line: f.line, scene: 'union-find', step: 'forest', snapshot, label: `See the forest · ${f.message}` })),
        steps: [{
            id: 'forest', title: 'See the forest',
            description: 'The same run, drawn twice: the input graph as its edges arrive, and the forest the parent array stores.',
            descriptionExpr: tr('message'),
            camera: { position: [0, -0.3, 14], target: [0, -0.3, 0] },
            remove: [{ id: '*' }, { type: 'slider' }],
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: run.length - 1, step: 1, default: 0 }],
            add: [
                // The input graph: nodes on a ring, coloured by component, each processed edge drawn (undirected,
                // so no arrow); the edge being processed is lit.
                {
                    id: 'input-graph', type: 'graph', label: 'graph', lengthExpr: String(n), valueExpr: 'idx',
                    positionExpr: [`-4.0 + 1.7 * cos(2 * pi * idx / ${n} + pi / 2)`, `-1.4 + 1.7 * sin(2 * pi * idx / ${n} + pi / 2)`, '0'],
                    nodeShape: 'rect', nodeWidth: 0.7, nodeHeight: 0.7, nodeCornerRadius: 0.35, valueLabel: 'inside', showIndices: false,
                    colorExpr: uf('comp'),
                    connectTo: { indexExpr: uf('to'), pinned: true, arrow: false, color: '#9fb1c6', bendExpr: '0',
                        highlightExpr: `to == ${uf('cur')}`, colorExpr: `to == ${uf('cur')} ? '${GOLD}' : ''` },
                    markers: [marker('a', tr('a'), BLUE), marker('b', tr('b'), BLUE)],
                },
                // The storage, compact on top: each cell links to its parent, like the forest below.
                // Title above the row: a left title would run off a narrow view.
                array('parent-row', 'parent', [-3.4, 3.4, 0], {
                    from: tr('parent'), color: BLUE, highlightExpr: 'value == idx', labelSide: 'top',
                    // Each cell links to its parent (a root links nowhere): the forest below, read off the array.
                    connectTo: { object: 'parent-row', indexExpr: 'value == idx ? -1 : value', pinned: true, arrow: true, color: '#8aa0b8' },
                }),
                {
                    id: 'forest', type: 'graph', label: 'forest', lengthExpr: String(n), valueExpr: 'idx',
                    positionExpr: [uf('x'), uf('y'), '0'],
                    nodeShape: 'rect', nodeWidth: 0.8, nodeHeight: 0.8, nodeCornerRadius: 0.4, valueLabel: 'inside', showIndices: false,
                    // Coloured by component like the graph on the left, so the two views match; a root has no arrow.
                    colorExpr: uf('comp'),
                    // Each node points at its parent; a root (its own parent) points at nothing.
                    connectTo: { indexExpr: `arrayAt(${tr('parent')}, idx) == idx ? -1 : arrayAt(${tr('parent')}, idx)`, pinned: true, arrow: true, color: '#7f93aa', bendExpr: '0',
                        colorExpr: `${uf('union')} == 1 ? '${GOLD}' : (${uf('path')} == 1 ? '${PINK}' : '')`, highlightExpr: `${uf('union')} == 1 or ${uf('path')} == 1` },
                    markers: [marker('x', tr('x'), PINK), marker('ra', tr('ra')), marker('rb', tr('rb'))],
                },
                label('edge', `${tr('e')} < 0 ? 'edge: —' : concat('edge ', ${tr('a')}, '–', ${tr('b')})`, [-4.6, -4.2, 0]),
                { ...label('forest-parent-x', `${tr('x')} < 0 ? 'parent[x]: —' : concat('parent[x] = ', arrayAt(${tr('parent')}, ${tr('x')}))`, [-4.6, -4.2, 0], ['forest', tr('x')]), codeRef: { file: 'union-find', line: 4 } },
                // n as the code names it: the number of components, one less per union.
                { ...label('count', `concat('n = ', ${tr('count')})`, [4.2, -4.2, 0]), tooltipExpr: tr('tip_count'), codeRef: { file: 'union-find', lineExpr: tr('ln_count') } },
            ],
        }],
    };
}
pattern({
    id: 'union-find', title: 'Group connected items (union-find)', file: 'union_find.py', source: UNION_FIND_SOURCE,
    input: { from: IN.unionFind.edges.map(e => e[0]), to: IN.unionFind.edges.map(e => e[1]) }, trace: ufRun,
    more: unionFindForestStep(ufN, ufRun),
    markdown: `# Group connected items (union-find)

**Signal:** "are these connected?", counting groups or islands as edges arrive, detecting a cycle in an undirected graph, or Kruskal's minimum spanning tree.

Each node points to a **parent**; a node that points to itself is a **root** (gold) and names its group. \`find\` climbs parent pointers to the root. Joining an edge's two groups is one assignment: point one root at the other. If both ends already share a root, the edge adds nothing, which is exactly how a redundant edge or cycle is detected.

The parent array *is* the forest: each column is a node, its value is the node it points to. The next step, **See the forest**, draws it: each node's arrow goes to its parent, roots have none, and every node wears its component's colour, as in the graph beside it. While \`find\` climbs, the edges it has walked light up pink; a union's new edge flashes gold, and the next state redraws the two trees as one. This version climbs without shortcuts; adding **path compression** (point every visited node straight at the root) and **union by rank** makes each operation nearly O(1).

${MD_TAIL}

The **See the forest** step shows the run twice: the input graph on the left, its edges arriving one by one and each component in its own colour, and the forest on the right.

**Practice:** Number of Provinces, Redundant Connection, Accounts Merge, Number of Connected Components in an Undirected Graph.`,
    prompt: 'Explain the parent array as a forest, find as climbing to the root, and union as linking roots. Ask the learner to predict each find result before the climb.',
    elements: [
        array('edge-from', 'edge a', [-4.5, 2.9, 0], { from: inp('from'), showIndices: false, highlightExpr: `idx == ${tr('e')}`, markers: [marker('edge', tr('e'))] }),
        array('edge-to', 'edge b', [-4.5, 2.05, 0], { from: inp('to'), highlightExpr: `idx == ${tr('e')}` }),
        array('parent', 'parent', [-4.5, -0.4, 0], {
            from: tr('parent'), color: BLUE, highlightExpr: 'value == idx',
            // The forest on the array itself: each cell links to its parent (a root, its own parent, links nowhere).
            connectTo: { object: 'parent', indexExpr: 'value == idx ? -1 : value', pinned: true, arrow: true, color: '#8aa0b8' },
            markers: [marker('x', tr('x'), PINK), marker('ra', tr('ra')), marker('rb', tr('rb'))],
        }),
        label('a', unset('a'), [-4, -3.2, 0], ['parent', tr('a')]),
        label('b', unset('b'), [-4, -3.2, 0], ['parent', tr('b')]),
        // What find reads at each step of its climb: the parent of x, about to become x (or x itself at a root).
        { ...label('parent-x', `${tr('x')} < 0 ? 'parent[x]: —' : concat('parent[x] = ', arrayAt(${tr('parent')}, ${tr('x')}))`, [-4, -3.2, 0], ['parent', tr('x')]), codeRef: { file: 'union-find', line: 4 } },
        label('count', `concat('n = ', ${tr('count')})`, [4, -3.2, 0]),
    ],
});

// ── Placeholders for patterns that need data structures AlgeBench does not render yet ──
// ── Linked list reversal ──
(() => {
    const { values } = IN.linkedList;
    const node = (col: string) => `${tr(col)} < 0 ? '${col}: None' : concat('${col} = ', arrayAt(${inp('values')}, ${tr(col)}))`;
    pattern({
        id: 'linked-list-reversal', title: 'Flip the links (linked list reversal)', file: 'reverse_list.py', source: LINKED_LIST_SOURCE,
        input: { values }, trace: linkedListTrace(values),
        markdown: `# Flip the links (linked list reversal)

**Signal:** reverse a list or a sublist, swap pairs, or reorder nodes, with O(1) extra space.

Walk the list with three pointers, \`prev\`, \`curr\` and \`nxt\`. Save \`curr.next\` in \`nxt\` **first**, point \`curr.next\` back at \`prev\`, then advance both. Without the save, flipping the pointer would lose the rest of the list. Each node is rewired once: O(n) time, O(1) space.

At every step the pointers hold two lists: the reversed part, walked from \`prev\`, and what is left, walked from \`curr\`. Each flip moves one node from the second to the first.

${MD_TAIL}

**Practice:** Reverse Linked List, Reverse Linked List II, Swap Nodes in Pairs, Reverse Nodes in k-Group, Palindrome Linked List.`,
        prompt: 'Explain the prev/curr/nxt dance and why saving nxt first matters. Ask the learner to predict where each arrow points after the flip before the player reveals it.',
        elements: [
            // The nodes in a row; each next pointer is an arrow, and a flip reverses it on the same line.
            {
                id: 'nodes', type: 'graph', label: 'nodes', lengthExpr: String(values.length), valueExpr: `arrayAt(${inp('values')}, idx)`,
                positionExpr: [`-4.6 + idx * 2.1`, '1.2', '0'],
                nodeShape: 'rect', nodeWidth: 1.1, nodeHeight: 0.9, nodeCornerRadius: 0.18, valueLabel: 'inside', showIndices: false,
                colorExpr: `idx == ${tr('curr')} ? '${GOLD}' : (idx == ${tr('prev')} ? '${PINK}' : (idx == ${tr('nxt')} ? '${TEAL}' : ''))`,
                connectTo: { indexExpr: `arrayAt(${tr('next')}, idx)`, pinned: true, arrow: true, bendExpr: '0', color: '#7f93aa',
                    colorExpr: `idx == ${tr('flipped')} ? '${GOLD}' : ''`, highlightExpr: `idx == ${tr('flipped')}` },
                // Each pointer names a node, so its marker shows the node's value, not its position in the row.
                markers: ([['prev', PINK], ['curr', GOLD], ['nxt', TEAL]] as const).map(([name, color]) =>
                    ({ ...marker(name, tr(name), color, `${tr(name)} >= 0`), valueExpr: `arrayAt(${inp('values')}, ${tr(name)})` })),
            },
            { ...label('prev', node('prev'), [-3.6, -2.2, 0], ['nodes', `${tr('prev')}`]), codeRef: { file: 'linked-list-reversal', line: 12 } },
            { ...label('curr', node('curr'), [-3.6, -2.2, 0], ['nodes', `${tr('curr')}`]), codeRef: { file: 'linked-list-reversal', line: 13 } },
            { ...label('nxt', node('nxt'), [-3.6, -2.2, 0], ['nodes', `${tr('nxt')}`]), codeRef: { file: 'linked-list-reversal', line: 10 } },
            // The two lists the pointers hold, as Python would walk them.
            label('from-prev', `concat('from prev: ', ${tr('fromPrev')})`, [3.4, -2.2, 0]),
            label('from-curr', `concat('from curr: ', ${tr('fromCurr')})`, [3.4, -2.2, 0]),
        ],
    });
})();
// ── Heap (top k) ──
(() => {
    const { nums, k } = IN.topK;
    // The tree view: root at (cx, top), each level levelGap lower, spread across width.
    const cx = 4.3, width = 5.0, top = 1.5, levelGap = 1.35;
    const a = tr('a'), b = tr('b');
    const compared = `idx == ${a} or idx == ${b}`;
    const trace = topKTrace(nums, k);
    pattern({
        id: 'top-k', title: 'Keep the best k (heap)', file: 'top_k.py', source: TOP_K_SOURCE,
        input: { nums, k }, trace,
        sections: [
            section(TOP_K_SOURCE, 'heap-setup', 'An empty min-heap', 'def kth_largest(', 'heap = []', {
                hint: 'A min-heap keeps its smallest value at heap[0]; it will hold the k largest seen so far.' }),
            section(TOP_K_SOURCE, 'heap-push', 'Every number joins the heap', 'for x in nums', 'heapq.heappush(heap, x)', {
                hint: 'Push each number: it sifts up past bigger parents until the smallest is at the root again.' }),
            section(TOP_K_SOURCE, 'heap-trim', 'One too many: drop the smallest', 'if len(heap) > k', 'heapq.heappop(heap)', {
                hint: 'With k + 1 values, the root is the smallest of them, so it cannot be among the k largest.',
                prompt: 'Explain why popping the root keeps exactly the k largest numbers seen so far.' }),
            section(TOP_K_SOURCE, 'heap-done', 'The root is the k-th largest', 'return heap[0]', null, {
                hint: 'The heap holds the k largest; the smallest of them, at the root, is the k-th largest. O(n log k).' }),
        ],
        annotations: [
            doc('kth_largest', '`kth_largest(nums, k)` returns the k-th largest number. O(n log k) time, O(k) space.'),
            doc('nums', 'The numbers to scan.'),
            doc('k', 'Which largest is wanted: 1 is the maximum.'),
            doc('heap', 'A min-heap of at most k numbers: the k largest seen so far, the smallest of them at `heap[0]`.'),
            doc('x', 'The number being read.'),
            doc('heapq', "Python's binary heap: a list kept so every parent is no bigger than its children."),
            docExpr(TOP_K_SOURCE, 'heapq.heappush(heap, x)', 'heapq.heappush(heap, x)', 'Append x and sift it up: O(log k).'),
            docExpr(TOP_K_SOURCE, 'if len(heap) > k', 'len(heap) > k', 'One more than k: the extra one is the smallest.'),
            docExpr(TOP_K_SOURCE, 'heapq.heappop(heap)', 'heapq.heappop(heap)', 'Remove the root, the smallest; the last value moves to the root and sifts down: O(log k).'),
            docBlock(TOP_K_SOURCE, 'for x in nums', 'heapq.heappop(heap)', 'n numbers, each a push and at most one pop on a heap of size k: O(n log k).'),
            docExpr(TOP_K_SOURCE, 'return heap[0]', 'heap[0]', 'The root: the smallest of the k largest, which is the k-th largest.'),
        ],
        markdown: `# Keep the best k (heap)

**Signal:** the k largest, k smallest, or k most frequent items; or "the best so far" from a stream.

Keep a **min-heap of size k**. Push each value; when the heap grows past k, pop its smallest. What stays is the k largest seen so far, and the root, the smallest of them, is the k-th largest. A min-heap (not a max-heap) because the value to evict is always the smallest of the keepers, and the heap keeps it on top.

A heap is a complete binary tree stored in an array: slot i's children are 2i + 1 and 2i + 2, its parent is ⌊(i − 1) / 2⌋, and every parent is ≤ its children. \`heappush\` appends at the end and **sifts up** (swap with the parent while smaller); \`heappop\` moves the last value to the root and **sifts down** (swap with the smaller child while larger). Each sift walks one root-to-leaf path: O(log k). All n values: O(n log k), which beats sorting when k is small. Here k = **${k}**.

${MD_TAIL}

**Practice:** Kth Largest Element in an Array, Top K Frequent Elements, K Closest Points to Origin, Find K Pairs with Smallest Sums, Merge k Sorted Lists.`,
        prompt: 'Explain why a min-heap of size k keeps the k largest, and how sift-up and sift-down restore the heap rule along one path. Ask the learner to predict each swap, and which value heappop drops, before the player reveals it.',
        elements: [
            array('nums', 'nums', [-3.6, 3.2, 0], { from: inp('nums'), highlightExpr: `idx == ${tr('i')}`, markers: [marker('x', tr('i'))] }),
            // The heap, as Python stores it (an array) and as the tree it encodes (a graph). Values glide between slots
            // as the sifts swap them; the two slots being compared, and the edge between them, are pink.
            {
                id: 'heap', type: 'heap', label: 'heap', itemType: 'number',
                lengthExpr: `arrayCount(${tr('heap')})`, valueExpr: `arrayAt(${tr('heap')}, idx)`,
                origin: [-3.6, 0.9, 0], cellSize: 1.35, fontSize: 16, indexFontSize: 10, axisLabels: ARRAY_TEXT,
                treeOrigin: [cx, top, 0], treeWidth: width, levelGap, nodeSize: 1.05,
                colorExpr: `${compared} ? '${PINK}' : (idx == 0 ? '${GOLD}' : '')`,
                edgeColorExpr: `(idx == ${a} and floor((idx - 1) / 2) == ${b}) or (idx == ${b} and floor((idx - 1) / 2) == ${a}) ? '${PINK}' : ''`,
            },
            array('dropped', 'dropped', [-3.6, -1.6, 0], { from: tr('dropped'), color: '#8793a6', showIndices: false }),
            { ...label('x', `${tr('i')} < 0 ? 'x: —' : concat('x = ', ${tr('x')})`, [-4, -3.6, 0], ['nums', tr('i')]), codeRef: { file: 'top-k', line: 5 } },
            label('k', `concat('k = ', ${inp('k')})`, [-4, -3.6, 0]),
            { ...label('root', `${tr('size')} == 0 ? 'heap[0]: —' : concat('heap[0] = ', arrayAt(${tr('heap')}, 0))`, [-4, -3.6, 0], ['heap-tree', `${tr('size')} == 0 ? -1 : 0`]), codeRef: { file: 'top-k', line: 9 } },
            // Line 7's condition, evaluated when the line runs.
            { ...label('over', `${tr('over')} < 0 ? 'len(heap) > k: —' : concat('len(heap) > k: ', ${tr('checked')}, ' > ', ${inp('k')}, ${tr('over')} == 1 ? ' → True' : ' → False')`, [3.2, -3.6, 0], undefined, `${tr('line')} == 7`),
                codeRef: { file: 'top-k', line: 7 } },
        ],
    });
})();
// ── Tree traversal: one step per order, each playing its own run ──
(() => {
    const { values, parents, sides } = IN.tree;
    const nd = (c: string) => `dataTable('treeNodes', idx, '${c}')`;
    const ORDERS = [
        { order: 'preorder', title: 'Preorder (DFS)', table: 'trace', what: 'node, then left, then right' },
        { order: 'inorder', title: 'Inorder (DFS)', table: 'tt_inorder', what: 'left, then node, then right: a search tree in sorted order' },
        { order: 'postorder', title: 'Postorder (DFS)', table: 'tt_postorder', what: 'left, then right, then node: children before their parent' },
        { order: 'level', title: 'Level order (BFS)', table: 'tt_level', what: 'a queue, level by level, top to bottom' },
    ] as const;
    const runs = ORDERS.map(o => treeTraversalTrace(o.order, values, parents, sides));
    // The same picture for every order, reading its own table.
    const elements = (table: string, bfs: boolean): Json[] => {
        const c = (col: string) => `dataTable('${table}', frame, '${col}')`;
        const val = (i: string) => `arrayAt(${inp('values')}, ${i})`;
        const waiting = (i: string) => `arrayAt(${c('waiting')}, ${i}) == 1`;
        // Rows titled on the left, like the lesson's other arrays; cells a little smaller so nine values fit.
        const small = { cellSize: 1.0, fontSize: 14 };
        const pending = { ...array(bfs ? 'queue' : 'stack', bfs ? 'queue' : 'call stack', [-2.4, -2.4, 0], { from: c(bfs ? 'queue' : 'stack'), color: bfs ? BLUE : PINK, ...small }),
            valueExpr: val(`arrayAt(${c(bfs ? 'queue' : 'stack')}, idx)`) };
        return [
            // The tree: gold where the code is, pink on the call stack (or blue waiting in the queue), teal once visited.
            {
                id: 'tree', type: 'graph', label: 'tree', lengthExpr: String(values.length), valueExpr: val('idx'),
                treeLayout: { type: 'binary', parentExpr: nd('p'), sideExpr: nd('s'), origin: [1.0, 3.7, 0], spacing: 0.9, levelGap: 1.3 },
                nodeShape: 'rect', nodeWidth: 0.8, nodeHeight: 0.8, nodeCornerRadius: 0.4, valueLabel: 'inside', showIndices: false,
                colorExpr: `idx == ${c('cur')} ? '${GOLD}' : (${waiting('idx')} ? '${bfs ? BLUE : PINK}' : (arrayAt(${c('visited')}, idx) == 1 ? '${TEAL}' : ''))`,
                // Each node's edge to its parent; on a DFS the call stack's path from the root is lit.
                connectTo: { indexExpr: nd('p'), pinned: true, bendExpr: '0', color: '#7f93aa',
                    ...(bfs ? {} : { colorExpr: `${waiting('idx')} and ${waiting(nd('p'))} ? '${PINK}' : ''`, highlightExpr: `${waiting('idx')} and ${waiting(nd('p'))}` }) },
                // The marker names the node by its value, as the code does (node.val), not by its position.
                markers: [{ ...marker('node', c('cur'), GOLD, `${c('cur')} >= 0`), valueExpr: val(c('cur')) }],
            },
            pending,
            array('out', 'out', [-2.4, -3.9, 0], { from: c('out'), color: '#b69bea', ...small }),
            { ...label('node', `${c('cur')} < 0 ? 'node: None' : concat('node.val = ', ${val(c('cur'))})`, [4.8, -2.4, 0], ['tree', c('cur')]) },
        ];
    };
    const table = values.map((_, i) => ({ p: parents[i], s: sides[i] }));
    const steps = ORDERS.slice(1).map((o, k) => {
        const run = runs[k + 1]!;
        return {
            id: o.order, title: o.title, description: `${o.title}: ${o.what}.`, descriptionExpr: `dataTable('${o.table}', frame, 'message')`,
            remove: [{ id: '*' }, { type: 'slider' }],
            sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: run.length - 1, step: 1, default: 0 }],
            codeRef: { file: 'tree-traversal', lineExpr: `dataTable('${o.table}', frame, 'line')`,
                ...(o.order === 'level' ? {} : { callsExpr: `dataTable('${o.table}', frame, 'calls')`, callEntryLine: o.order === 'inorder' ? 11 : 18 }) },
            add: elements(o.table, o.order === 'level'),
        };
    });
    pattern({
        id: 'tree-traversal', title: 'Walk a tree (traversal orders)', file: 'tree_traversal.py', source: TREE_TRAVERSAL_SOURCE,
        input: { values }, trace: runs[0]!, callEntryLine: 4,
        more: {
            data: { treeNodes: table, ...Object.fromEntries(ORDERS.slice(1).map((o, k) => [o.table, runs[k + 1]])) },
            steps,
            locations: ORDERS.slice(1).flatMap((o, k) => runs[k + 1]!.map((f, snapshot) => ({ line: f.line, scene: 'tree-traversal', step: o.order, snapshot, label: `${o.title} · ${f.message}` }))),
        },
        markdown: `# Walk a tree (traversal orders)

**Signal:** process every node of a tree in a specific order.

Each step plays one order on the same search tree:

- **Preorder** (node, left, right), depth first: copy or serialize a tree, print root-to-leaf paths.
- **Inorder** (left, node, right), depth first: visits a binary search tree in **sorted** order.
- **Postorder** (left, right, node), depth first: compute something from both children first, such as height or the maximum path sum.
- **Level order**, breadth first: a queue hands out nodes level by level; shortest paths in steps, or a tree's rows.

The depth-first orders differ only in **where** \`out.append\` sits between the two recursive calls; the call stack (pink) is always the path from the root to the current node. Level order swaps the stack for a queue (blue). Every node is visited once: O(n).

${MD_TAIL}

**Practice:** Binary Tree Paths (preorder), Kth Smallest Element in a BST (inorder), Binary Tree Maximum Path Sum (postorder), Binary Tree Level Order Traversal (BFS), Binary Tree Right Side View.`,
        prompt: 'Explain the three depth-first orders as the position of the visit between the recursive calls, and level order as a queue. Ask the learner to predict the next visited node before the player reveals it.',
        elements: elements('trace', false),
    });
    const scene = scenes.at(-1)!, first = (scene.steps as Json[])[0]!;
    Object.assign(first, { title: ORDERS[0].title, description: `${ORDERS[0].title}: ${ORDERS[0].what}.` });
})();
// ── Explore a grid (number of islands) ──
(() => {
    const { grid } = IN.islands;
    const rows = grid.length, cols = grid[0]!.length;
    const trace = islandsTrace(grid);
    const count = end(trace).count as number;
    const ISLAND = ['#77bfae', '#b69bea', '#e6a96b', '#8fc06b', '#7fb3e6', '#e67db0'];
    const cell = (col: string) => `arrayAt(${tr(col)}, idx)`;
    const islandColor = Array.from({ length: count }, (_, k) => `${cell('island')} == ${k + 1} ? '${ISLAND[k % ISLAND.length]}' : `).join('');
    const x0 = -4.2, y0 = 2.7, size = 1.05;
    pattern({
        id: 'matrix-traversal', title: 'Explore a grid (matrix traversal)', file: 'num_islands.py', source: ISLANDS_SOURCE,
        input: { grid }, trace,
        markdown: `# Explore a grid (matrix traversal)

**Signal:** a 2D grid: islands, flood fill, regions, shortest moves.

Treat each cell as a node whose neighbours are the cells up, down, left and right, then run DFS or BFS from it. Here: scan every cell, and when one is still land, count a new island and run a **depth-first search** from it: visit every land neighbour, recursively, marking each cell visited by overwriting it with "0" (a flood fill). Overwriting is the visited mark, so no cell is counted twice. Check bounds before you look at a neighbour.

Each island gets its own colour as the search visits it, and each visited cell points back at the cell that reached it, so the search shows as a tree; pink cells are still on the recursion stack. Every cell is scanned once and visited at most once: O(rows × cols).

${MD_TAIL}

**Practice:** Number of Islands, Flood Fill, Max Area of Island, Surrounded Regions, Rotting Oranges (BFS).`,
        prompt: 'Explain the grid as a graph, overwriting as the visited mark, and why each cell is handled once. Ask the learner to predict which cells the next dfs call reaches before the player reveals it.',
        elements: [
            // The grid as a graph: one node per cell, laid out in rows and columns, showing the value the code holds.
            {
                id: 'grid', type: 'graph', label: 'grid', lengthExpr: String(rows * cols), valueExpr: cell('grid'),
                positionExpr: [`${x0} + mod(idx, ${cols}) * ${size}`, `${y0} - floor(idx / ${cols}) * ${size}`, '0'],
                nodeShape: 'rect', nodeWidth: 0.9, nodeHeight: 0.9, nodeCornerRadius: 0.12, valueLabel: 'inside', showIndices: false,
                // Gold where dfs() is, pink on its recursion stack, an island's colour once visited, sand for land, dark water.
                colorExpr: `idx == ${tr('cur')} ? '${GOLD}' : (${cell('stack')} == 1 ? '${PINK}' : (${islandColor}(${cell('grid')} == 1 ? '#c8b98a' : '#2c4256')))`,
                // A visited cell points back at the cell whose dfs() reached it.
                connectTo: { indexExpr: cell('from'), pinned: true, arrow: true, bendExpr: '0', color: '#e8e6da' },
                markers: [marker('scan', tr('scan'), BLUE, `${tr('scan')} >= 0 and ${tr('cur')} < 0`)],
            },
            label('count', `concat('count = ', ${tr('count')})`, [4.4, 1.6, 0]),
            { ...label('rc', `${tr('r')} < 0 ? '(r, c): —' : concat('(r, c) = (', ${tr('r')}, ', ', ${tr('c')}, ')')`, [4.4, 1.6, 0],
                ['grid', `${tr('r')} < 0 ? -1 : ${tr('r')} * ${cols} + ${tr('c')}`]) },
        ],
    });
})();
// ── Backtracking: subsets, one call per subset ──
(() => {
    const { nums } = IN.subsets;
    const { trace, parents } = subsetsTrace(nums);
    const parent = `dataTable('subsetCalls', idx, 'p')`;
    const on = (col: string, i: string) => `arrayAt(${tr(col)}, ${i}) == 1`;
    pattern({
        id: 'backtracking', title: 'Try, undo, retry (backtracking)', file: 'subsets.py', source: SUBSETS_SOURCE,
        callEntryLine: 4,
        input: { nums }, trace, more: { data: { subsetCalls: parents.map(p => ({ p })) }, steps: [], locations: [] },
        markdown: `# Try, undo, retry (backtracking)

**Signal:** generate all permutations, subsets or combinations, or place pieces under constraints (N-Queens, Sudoku, word search).

Build a candidate one choice at a time, with one shared \`path\`:

1. **Choose:** append a number to \`path\`.
2. **Explore:** recurse to extend it, using only later numbers.
3. **Un-choose:** pop it, so \`path\` is back as it was and the next number can take its place.

For subsets every call's \`path\` is an answer, so each call records it first. The calls form a **decision tree**: each node is one call, labelled with the path it recorded, under the call that chose its last number. Gold is where the code is, pink calls are waiting on a deeper choice, and teal calls have recorded their subset. ${nums.length} numbers give 2^${nums.length} = ${parents.length} calls, one per subset.

Other problems add **pruning**: skip a choice, or a whole branch, that already breaks a constraint. The worst case stays exponential; pruning is what makes it practical.

${MD_TAIL}

**Practice:** Subsets, Permutations, Combination Sum, Word Search, N-Queens.`,
        prompt: 'Explain choose / explore / un-choose and why path must be undone. Ask the learner to predict the next subset recorded, and what path looks like after each pop, before the player reveals it.',
        elements: [
            {
                id: 'calls', type: 'graph', label: 'backtrack calls', lengthExpr: tr('count'), valueExpr: `arrayAt(${tr('text')}, idx)`,
                treeLayout: { type: 'tidy', parentExpr: parent, origin: [0.4, 3.4, 0], spacing: 2.45, levelGap: 1.3 },
                nodeShape: 'rect', nodeWidth: 2.2, nodeHeight: 0.72, nodeCornerRadius: 0.16, valueLabel: 'inside', showIndices: false, axisLabels: 'plane',
                colorExpr: `idx == ${tr('cur')} ? '#9a7420' : (${on('stack', 'idx')} ? '#8a3f68' : (${on('done', 'idx')} ? '#2f7d66' : '#4a5560'))`,
                connectTo: { indexExpr: parent, pinned: true, bendExpr: '0', color: '#7f93aa',
                    colorExpr: `${on('stack', 'idx')} and ${on('stack', parent)} ? '${PINK}' : ''`, highlightExpr: `${on('stack', 'idx')} and ${on('stack', parent)}` },
            },
            array('nums', 'nums', [-3.2, -2.0, 0], { from: inp('nums'), labelSide: 'left',
                markers: [marker('start', tr('start'), TEAL, `${tr('start')} >= 0 and ${tr('start')} < ${nums.length}`), marker('i', tr('i'), PINK, `${tr('i')} >= 0`)] }),
            // The one shared path: grows on choose, shrinks on un-choose.
            array('path', 'path', [-3.2, -3.7, 0], { from: tr('path'), labelSide: 'left', highlightExpr: `idx == count(${tr('path')}) - 1 and (${tr('line')} == 7 or ${tr('line')} == 8)` }),
            // out: every subset recorded so far, the newest lit as line 5 appends it.
            array('out', 'out', [-3.2, -5.5, 0], { from: tr('outText'), itemType: 'text', cellSize: 2.1, arrayColumns: 4, arrayHeight: 2.5, arrayCellHeight: 0.8, showIndices: false, color: '#b69bea', labelSide: 'left', highlightExpr: `idx == ${tr('out')} - 1 and ${tr('line')} == 5` }),
            { ...label('start', `${tr('start')} < 0 ? 'start: —' : concat('start = ', ${tr('start')})`, [4.6, -3.6, 0], ['calls', `${tr('cur')}`]), codeRef: { file: 'backtracking', line: 4 } },
            { ...label('i', `${tr('i')} < 0 ? 'i: —' : concat('i = ', ${tr('i')})`, [4.6, -3.6, 0], ['nums', tr('i')]), codeRef: { file: 'backtracking', line: 6 } },
            { ...label('numsi', `${tr('i')} < 0 ? 'nums[i]: —' : concat('nums[i] = ', arrayAt(${inp('nums')}, ${tr('i')}))`, [4.6, -3.6, 0], ['nums', tr('i')]), codeRef: { file: 'backtracking', line: 7 } },
            { ...label('pathv', `concat('path = ', ${tr('pathText')})`, [4.6, -3.6, 0]), codeRef: { file: 'backtracking', lineExpr: `${tr('line')} == 9 ? 9 : 7` } },
            { ...label('outlen', `concat('len(out) = ', ${tr('out')})`, [4.6, -3.6, 0]), codeRef: { file: 'backtracking', line: 5 } },
        ],
    });
})();

// ── Trie ──
(() => {
    const { words, queries, searches } = IN.trie;
    const { trace, nodes } = trieTrace(words, queries), lookups = trieSearchTrace(words, searches);
    // Each node's letter and parent; the graph lays the nodes made so far out as a tidy tree (treeLayout), so
    // the trie re-lays itself as an insert adds a branch.
    const table = nodes.map(n => ({ ch: n.ch, parent: n.parent }));
    const nd = (col: string) => `dataTable('trieNodes', idx, '${col}')`;
    // The trie over one run's columns: one node per prefix, its letter inside; teal where a word ends, gold where
    // the code is. The walk from the root to the current node is lit.
    const trie = (c: (col: string) => string): Json => {
        const onPath = `arrayAt(${c('onPath')}, idx) == 1`;
        return {
            id: 'root', type: 'graph', label: 'trie', lengthExpr: c('count'), valueExpr: nd('ch'),
            treeLayout: { type: 'tidy', parentExpr: nd('parent'), origin: [4.9, 3.3, 0], spacing: 1.35, levelGap: 1.25 },
            nodeShape: 'rect', nodeWidth: 0.8, nodeHeight: 0.8, nodeCornerRadius: 0.4, valueLabel: 'inside', showIndices: false,
            colorExpr: `idx == ${c('cur')} ? '${GOLD}' : (arrayAt(${c('ends')}, idx) == 1 ? '${TEAL}' : '')`,
            connectTo: { indexExpr: nd('parent'), pinned: true, bendExpr: '0', color: '#7f93aa',
                colorExpr: `${onPath} ? '${GOLD}' : ''`, highlightExpr: onPath },
            markers: [marker('node', c('cur'), PINK)],
        };
    };
    const sr = (col: string) => `dataTable('trie_search', frame, '${col}')`;
    const searchLine = (text: string) => lineOf(TRIE_SOURCE, text, 'def search');
    // On a return line of a lookup (math.js compares strings as numbers, so test the line, not the result).
    const returned = `(${sr('line')} == ${searchLine('return False')} or ${sr('line')} == ${searchLine('return node.end')}) and ${sr('qi')} >= 0`;
    const searchElements: Json[] = [
        array('searches', 'searches', [-5.4, 2.9, 0], { from: inp('searches'), itemType: 'string', labelSide: 'top', highlightExpr: `idx == ${sr('qi')}` }),
        array('word', 'word', [-3.4, -0.2, 0], { from: sr('text'), itemType: 'character', markers: [marker('ch', sr('ci'), PINK, `${sr('ci')} >= 0`)] }),
        trie(sr),
        { ...label('ch', `${sr('ci')} < 0 ? 'ch: —' : concat('ch = ', ${sr('ch')})`, [-3.6, -4.0, 0]),
            connectTo: [{ object: 'word', indexExpr: sr('ci') }], codeRef: { file: 'trie', line: searchLine('for ch in word') } },
        { ...label('cond', `${sr('cond')} < 0 ? 'ch in node.children: —' : (${sr('cond')} == 1 ? 'ch in node.children → True' : 'ch in node.children → False')`, [-3.6, -4.0, 0], undefined, `${sr('line')} == ${searchLine('if ch not in')}`),
            codeRef: { file: 'trie', line: searchLine('if ch not in') } },
        { ...label('end', `${sr('line')} == ${searchLine('return node.end')} and ${sr('qi')} >= 0 ? concat('node.end = ', ${sr('result')}) : 'node.end: —'`, [4.6, -4.0, 0], undefined, `${sr('line')} == ${searchLine('return node.end')} and ${sr('qi')} >= 0`),
            codeRef: { file: 'trie', line: searchLine('return node.end') } },
        { ...label('answer', `${returned} ? concat('search(', arrayAt(${inp('searches')}, ${sr('qi')}), ') → ', ${sr('result')}) : 'search: —'`, [4.6, -4.0, 0], undefined, returned),
            codeRef: { file: 'trie', lineExpr: `${sr('line')} == ${searchLine('return False')} ? ${searchLine('return False')} : ${searchLine('return node.end')}` } },
    ];
    pattern({
        id: 'trie', title: 'Build trie', file: 'trie.py', source: TRIE_SOURCE,
        input: { words, queries, searches }, trace, cameraX: 0.5,
        more: {
            data: { trieNodes: table, trie_search: lookups },
            steps: [{
                id: 'search', title: 'Search for whole words', description: 'search walks the word like starts_with, then checks that a word ends at the last node.',
                descriptionExpr: `dataTable('trie_search', frame, 'message')`,
                remove: [{ id: '*' }, { type: 'slider' }],
                sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: lookups.length - 1, step: 1, default: 0 }],
                codeRef: { file: 'trie', lineExpr: `dataTable('trie_search', frame, 'line')` },
                add: searchElements,
            }],
            locations: lookups.map((f, snapshot) => ({ line: f.line, scene: 'trie', step: 'search', snapshot, label: `search · ${f.message}` })),
        },
        markdown: `# Build trie

**Signal:** autocomplete, "starts with", word search over many words, or longest common prefix.

A **trie** stores words letter by letter down a tree: each node maps a letter to a child, so a path from the root spells a prefix, and words that share a prefix share that path. A node also records whether a word **ends** there (teal): "do" ends inside "dog".

Inserting walks the word from the root, creating the nodes that are missing; \`starts_with\` walks the prefix and fails at the first missing letter. \`search\` (next step) walks the same way, then also needs a word to **end** at the last node: "ca" is a prefix here, but not a stored word. All three cost O(length of the word), however many words are stored. Here ${words.length} words need ${nodes.length - 1} letter nodes instead of ${words.reduce((n, w) => n + w.length, 0)} letters.

${MD_TAIL}

**Practice:** Implement Trie, Design Add and Search Words Data Structure, Word Search II, Longest Common Prefix, Replace Words.`,
        prompt: 'Explain shared prefixes and the end-of-word marker. Ask the learner to predict which nodes an insert creates, where a starts_with walk fails, and why search("ca") is False while starts_with("ca") is True, before the player reveals it.',
        sections: [
            section(TRIE_SOURCE, 'trie-node', 'A node: children and an end mark', 'class Node:', 'self.end = False', {
                hint: 'Each node maps a letter to the child below it, and records whether a word ends here.' }),
            section(TRIE_SOURCE, 'trie-insert-start', 'Insert each word from the root', 'def build(', 'node = root', {
                hint: 'Every insert starts at the root, which stands for the empty prefix.' }),
            section(TRIE_SOURCE, 'trie-insert-walk', 'Walk the word, creating missing nodes', 'for ch in word:', 'node = node.children[ch]', {
                hint: 'Follow the child for each letter; create it only if it is missing, so shared prefixes are stored once.',
                prompt: 'Explain why an insert creates nodes only after the first letter that is not yet a child, using "cart" after "car" as the example.' }),
            section(TRIE_SOURCE, 'trie-insert-end', 'Mark where the word ends', 'node.end = True', 'return root', {
                hint: 'The last node of the word gets the end mark, even if longer words continue below it.' }),
            section(TRIE_SOURCE, 'trie-prefix', 'starts_with: walk the prefix', 'def starts_with(', 'return True', {
                hint: 'A missing letter means no word starts with the prefix; reaching the end means some word does.' }),
            section(TRIE_SOURCE, 'trie-search-walk', 'search: walk the word', 'def search(', 'node = node.children[ch]', {
                hint: 'The same walk as starts_with: fail at the first missing letter.' }),
            section(TRIE_SOURCE, 'trie-search-end', 'search: a word must end here', 'return node.end', null, {
                hint: 'A path alone is only a prefix; the end mark says a whole word stops here.',
                prompt: 'Explain why search returns node.end rather than True, with "ca" as the example: a prefix of "car", but not a stored word.' }),
        ],
        annotations: [
            doc('Node', 'One trie node: one prefix of the stored words.'),
            doc('children', 'A dict from a letter to the child node that extends this prefix by that letter.'),
            doc('end', '`True` when a stored word ends at this node: "do" ends inside "dog".'),
            doc('build', '`build(words)` returns the root of a trie holding every word. O(total letters).'),
            doc('starts_with', '`starts_with(root, prefix)` says whether some stored word starts with `prefix`. O(len(prefix)).'),
            doc('search', '`search(root, word)` says whether `word` itself is stored, not just as a prefix. O(len(word)).'),
            doc('words', 'The words to store.'),
            doc('root', 'The root node: the empty prefix every walk starts from.'),
            doc('node', 'The node the walk is at: the prefix read so far.'),
            doc('ch', 'The letter being followed.'),
            doc('prefix', 'The prefix looked up.'),
            doc('word', 'The word being inserted.', { source: TRIE_SOURCE, start: 'def build(', end: 'return root' }),
            doc('word', 'The word looked up.', { source: TRIE_SOURCE, start: 'def search(', end: 'return node.end' }),
            docExpr(TRIE_SOURCE, 'self.children = {}', '{}', 'No children yet: a new node is a leaf.'),
            docExpr(TRIE_SOURCE, 'if ch not in node.children', 'ch not in node.children', 'No node for this letter below the current prefix yet.'),
            docExpr(TRIE_SOURCE, 'node.children[ch] = Node()', 'Node()', 'A new node: the prefix extended by `ch`, stored once for every word that shares it.'),
            docBlock(TRIE_SOURCE, 'for ch in word:', 'node = node.children[ch]', 'One step per letter, however many words are stored: O(len(word)).'),
            docExpr(TRIE_SOURCE, 'node.end = True', 'node.end = True', 'A word stops here; longer words may still continue below.'),
            (() => { const line = lineOf(TRIE_SOURCE, 'return False'), col = TRIE_SOURCE.split('\n')[line - 1]!.indexOf('False');
                return { line, col, endCol: col + 5, text: 'A letter of the prefix is missing: no stored word starts with it.' }; })(),
            docExpr(TRIE_SOURCE, 'return True', 'True', 'Every letter of the prefix is a path from the root: some stored word starts with it.'),
            (() => { const line = lineOf(TRIE_SOURCE, 'return False', 'def search('), col = TRIE_SOURCE.split('\n')[line - 1]!.indexOf('False');
                return { line, col, endCol: col + 5, text: 'A letter is missing: the word is not stored, nor any word starting with it.' }; })(),
            docExpr(TRIE_SOURCE, 'return node.end', 'node.end', 'The path exists; it is a stored word only if one ends here. `search("ca")` is False, though `starts_with("ca")` is True.'),
        ],
        elements: [
            array('words', 'words', [-5.4, 2.9, 0], { from: inp('words'), itemType: 'string', labelSide: 'top', highlightExpr: `idx == ${tr('wi')}` }),
            array('queries', 'queries', [-5.4, 0.6, 0], { from: inp('queries'), itemType: 'string', labelSide: 'top', highlightExpr: `idx == ${tr('qi')}` }),
            // The letters being walked: the word while building, the prefix while searching.
            { ...array('word', 'word', [-3.4, -1.7, 0], { from: tr('text'), itemType: 'character', markers: [marker('ch', tr('ci'), PINK, `${tr('ci')} >= 0`)] }), visibleExpr: `${tr('phase')} == 0` },
            { ...array('prefix', 'prefix', [-3.4, -1.7, 0], { from: tr('text'), itemType: 'character', markers: [marker('ch', tr('ci'), PINK, `${tr('ci')} >= 0`)] }), visibleExpr: `${tr('phase')} == 1` },
            trie(tr),
            // ch, wired to its letter in whichever row is being walked.
            { ...label('ch', `${tr('ci')} < 0 ? 'ch: —' : concat('ch = ', ${tr('ch')})`, [-3.6, -4.0, 0]),
                connectTo: [{ object: 'word', indexExpr: `${tr('phase')} == 0 ? ${tr('ci')} : -1` }, { object: 'prefix', indexExpr: `${tr('phase')} == 1 ? ${tr('ci')} : -1` }],
                codeRef: { file: 'trie', lineExpr: `${tr('phase')} == 1 ? 19 : 10` } },
            { ...label('cond', `${tr('cond')} < 0 ? 'ch in node.children: —' : (${tr('cond')} == 1 ? 'ch in node.children → True' : 'ch in node.children → False')`, [-3.6, -4.0, 0], undefined, `${tr('line')} == 11 or ${tr('line')} == 20`),
                codeRef: { file: 'trie', lineExpr: `${tr('phase')} == 1 ? 20 : 11` } },
            { ...label('answer', `${tr('line')} == 21 or (${tr('line')} == 23 and ${tr('phase')} == 1) ? concat('starts_with(', arrayAt(${inp('queries')}, ${tr('qi')}), ') → ', ${tr('result')}) : 'starts_with: —'`, [4.6, -4.0, 0], undefined, `${tr('line')} == 21 or (${tr('line')} == 23 and ${tr('phase')} == 1)`),
                codeRef: { file: 'trie', lineExpr: `${tr('line')} == 21 ? 21 : 23` } },
        ],
    });
    const scene = scenes.at(-1)!, first = (scene.steps as Json[])[0]!;
    Object.assign(first, { title: 'Build and check prefixes', description: 'Insert each word, then walk each query with starts_with.' });
})();
// ── Topological sort: DFS post-order, then Kahn's in-degrees, on one course graph ──
(() => {
    const { n, prerequisites } = IN.topo;
    const dfs = topoDfsTrace(n, prerequisites), kahn = topoTrace(n, prerequisites);
    // Lay the courses out by layer (longest prerequisite chain), so every edge points rightward.
    const layer = new Array(n).fill(0) as number[];
    for (let pass = 0; pass < n; pass++) for (const [c, p] of prerequisites) layer[c] = Math.max(layer[c]!, layer[p]! + 1);
    const nodes = dfs.graph.map((next, i) => {
        const same = layer.map((l, j) => [l, j] as const).filter(([l]) => l === layer[i]).map(([, j]) => j);
        return { next, x: -4.6 + layer[i]! * 2.6, y: 2.3 - (same.indexOf(i) - (same.length - 1) / 2) * 1.6 };
    });
    const nd = (col: string) => `dataTable('topoNodes', idx, '${col}')`;
    // Each function's lines, found by their text, so the code can be edited without renumbering.
    const dfsLine = (text: string) => topoLine(text, topoLine('def find_order_dfs') - 1);
    const kahnLine = (text: string) => topoLine(text, topoLine('def find_order(') - 1);
    const ref = (line: number) => ({ file: 'topological-sort', line });
    // The course graph, coloured by each step's state: gold where the code is, pink waiting (on the DFS path, or
    // queued), teal done (finished, or in order); the edge being followed is lit and used edges dim.
    const courses = (c: (col: string) => string): Json => {
        const current = `idx == ${c('from')} and to == ${c('to')}`;
        return {
            id: 'courses', type: 'graph', label: 'courses', lengthExpr: String(n), valueExpr: 'idx',
            positionExpr: [nd('x'), nd('y'), '0'],
            nodeShape: 'rect', nodeWidth: 0.9, nodeHeight: 0.9, nodeCornerRadius: 0.45, valueLabel: 'inside', showIndices: false,
            colorExpr: `idx == ${c('node')} ? '${GOLD}' : (arrayAt(${c('state')}, idx) == 2 ? '${TEAL}' : (arrayAt(${c('state')}, idx) == 1 ? '${PINK}' : ''))`,
            connectTo: { indexExpr: nd('next'), pinned: true, arrow: true, bendExpr: '0', color: '#7f93aa',
                colorExpr: `${current} ? '${GOLD}' : (slot < arrayAt(${c('seen')}, idx) ? '#3b4654' : '')`, highlightExpr: current },
        };
    };
    const dfsElements = (c: (col: string) => string): Json[] => [
        courses(c),
        array('state', 'state', [-4.2, -1.3, 0], { from: c('state'), markers: [marker('node', c('node'), GOLD, `${c('node')} >= 0`)] }),
        array('order', 'order', [-4.2, -2.8, 0], { from: c('order'), color: '#b69bea', highlightExpr: `idx == count(${c('order')}) - 1 and ${c('line')} == ${dfsLine('order.append(node)')}` }),
        { ...label('result', `concat('order[::-1] = ', ${c('result')})`, [4.6, -3.6, 0]), codeRef: ref(dfsLine('return order[::-1]')) },
        { ...label('c', `${c('c')} < 0 ? 'c: —' : concat('c = ', ${c('c')})`, [4.6, -3.6, 0], ['courses', c('c')]), codeRef: ref(dfsLine('for c in range(n)')) },
        { ...label('node', `${c('node')} < 0 ? 'node: —' : concat('node = ', ${c('node')})`, [4.6, -3.6, 0], ['courses', c('node')]), codeRef: ref(dfsLine('def dfs(node)')) },
        { ...label('nxt', `${c('nxt')} < 0 ? 'nxt: —' : concat('nxt = ', ${c('nxt')})`, [4.6, -3.6, 0], ['courses', c('nxt')]), codeRef: ref(dfsLine('for nxt in graph[node]')) },
        { ...label('state-node', `${c('node')} < 0 ? 'state[node]: —' : concat('state[node] = ', arrayAt(${c('state')}, ${c('node')}))`, [4.6, -3.6, 0], ['state', c('node')]), codeRef: ref(dfsLine('state[node] = 1')) },
    ];
    const kahnElements = (c: (col: string) => string): Json[] => {
        const counted = kahnLine('indegree[course] += 1'), relaxed = kahnLine('indegree[nxt] -= 1');
        return [
            courses(c),
            array('indegree', 'indegree', [-4.2, -1.3, 0], { from: c('indeg'),
                highlightExpr: `idx == ${c('nxt')} and (${c('line')} == ${counted} or ${c('line')} == ${relaxed})`,
                markers: [marker('nxt', c('nxt'), PINK, `${c('nxt')} >= 0`)] }),
            array('queue', 'queue', [-4.2, -2.8, 0], { from: c('queue') }),
            array('order', 'order', [-4.2, -4.3, 0], { from: c('order'), color: '#b69bea', highlightExpr: `idx == count(${c('order')}) - 1 and ${c('line')} == ${kahnLine('order.append(node)')}` }),
            { ...label('node', `${c('node')} < 0 ? 'node: —' : concat('node = ', ${c('node')})`, [4.6, -3.6, 0], ['courses', c('node')]), codeRef: ref(kahnLine('node = queue.popleft()')) },
            { ...label('nxt', `${c('nxt')} < 0 ? 'nxt: —' : concat('nxt = ', ${c('nxt')})`, [4.6, -3.6, 0], ['courses', c('nxt')]), codeRef: ref(kahnLine('for nxt in graph[node]')) },
            { ...label('indeg-nxt', `${c('nxt')} < 0 ? 'indegree[nxt]: —' : concat('indegree[nxt] = ', arrayAt(${c('indeg')}, ${c('nxt')}))`, [4.6, -3.6, 0], ['indegree', c('nxt')]),
                codeRef: { file: 'topological-sort', lineExpr: `${c('line')} <= ${counted} ? ${counted} : ${relaxed}` } },
            { ...label('len-order', `concat('len(order) = ', count(${c('order')}), ' of ', ${n})`, [4.6, -3.6, 0]), codeRef: ref(kahnLine('return order if len')) },
        ];
    };
    const kh = (col: string) => `dataTable('topo_kahn', frame, '${col}')`;
    pattern({
        id: 'topological-sort', title: 'Order by dependencies (topological sort)', file: 'course_order.py', source: TOPO_SOURCE,
        input: { n, prerequisites }, trace: dfs.trace, callEntryLine: dfsLine('def dfs(node)'),
        more: {
            data: { topoNodes: nodes, topo_kahn: kahn.trace },
            steps: [{
                id: 'kahn', title: 'Count in-degrees (Kahn)', description: "Kahn's algorithm: count in-degrees, queue the courses that wait on nothing.",
                descriptionExpr: `dataTable('topo_kahn', frame, 'message')`,
                remove: [{ id: '*' }, { type: 'slider' }],
                sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: kahn.trace.length - 1, step: 1, default: 0 }],
                codeRef: { file: 'topological-sort', lineExpr: `dataTable('topo_kahn', frame, 'line')` },
                add: kahnElements(kh),
            }],
            locations: kahn.trace.map((f, snapshot) => ({ line: f.line, scene: 'topological-sort', step: 'kahn', snapshot, label: `Kahn · ${f.message}` })),
        },
        markdown: `# Order by dependencies (topological sort)

**Signal:** prerequisites, build order, course schedules: "what order satisfies every dependency?", or "is there a cycle?".

Draw each prerequisite as an edge **pre → course**. A valid order puts every course after all its prerequisites. There are two classic ways to find one; each step of this scene plays one of them.

## 1. Depth-first search (DFS)

\`dfs(node)\` first finishes every course that depends on \`node\`, then appends \`node\`, so each course lands in \`order\` **after** everything that needs it. Reversing \`order\` puts every prerequisite first.

A course is pink while it is on the current path, teal once done, and gold where the search is. **Cycle:** the search reaches a pink course again: the path loops back on itself.

## 2. Count in-degrees (Kahn's algorithm)

A course's **in-degree** counts the courses it still waits on.

1. Count every in-degree.
2. Queue every course that waits on nothing.
3. Take a course from the queue and append it to the order. Each edge out of it is one wait fewer for its neighbour; a neighbour whose count reaches **0** joins the queue.

Gold is the course just taken, pink courses are queued, teal ones are in the order, and dimmed edges have been used. **Cycle:** the queue empties before every course is ordered; the rest wait on each other.

## Which one?

| | DFS (post-order) | Kahn (in-degrees) |
|---|---|---|
| Builds the order | back to front, then reversed | front to back, as courses free up |
| Extra state | a state per course, the call stack | an in-degree per course, a queue |
| Detects a cycle | a course met again on the path | courses left over |
| Good for | recursion-friendly code, finding the cycle itself | layers ("what can run now?"), parallel schedules |

Both handle each course and each edge once: **O(V + E)** time, O(V) extra space.

${MD_TAIL}

**Practice:** Course Schedule, Course Schedule II, Alien Dictionary, Parallel Courses, Minimum Height Trees.`,
        prompt: 'Explain both approaches: DFS post-order (a course is appended after everything that depends on it, then the list is reversed) and in-degrees (a course is free once its count reaches zero). Ask the learner to predict the next course ordered, and how each approach notices a cycle.',
        elements: dfsElements(tr),
    });
    const scene = scenes.at(-1)!, first = (scene.steps as Json[])[0]!;
    Object.assign(first, { title: 'Depth-first search (DFS)', description: 'Depth-first search: finish everything that depends on a course, then append it; reverse at the end.' });
})();
// ── Recursion: the call tree, growing as calls are made ──
(() => {
    const { x, n, fib } = IN.recursion;
    const pow = powerTrace(x, n), fb = fibTrace(fib);
    // The call tree over one run's table: gold where the code is, pink waiting on a smaller copy, teal returned.
    const elements = (table: string, calls: string, spacing: number, withX: boolean): Json[] => {
        const c = (col: string) => `dataTable('${table}', frame, '${col}')`;
        const on = (col: string, i: string) => `arrayAt(${c(col)}, ${i}) == 1`;
        const parent = `dataTable('${calls}', idx, 'p')`;
        return [
            {
                id: 'calls', type: 'graph', label: 'calls', lengthExpr: c('count'), valueExpr: `arrayAt(${c('text')}, idx)`,
                treeLayout: { type: 'tidy', parentExpr: parent, origin: [0, 3.4, 0], spacing, levelGap: 1.3 },
                nodeShape: 'rect', nodeWidth: 2.2, nodeHeight: 0.72, nodeCornerRadius: 0.16, valueLabel: 'inside', showIndices: false, axisLabels: 'plane',
                colorExpr: `idx == ${c('cur')} ? '#9a7420' : (${on('stack', 'idx')} ? '#8a3f68' : (${on('done', 'idx')} ? '#2f7d66' : '#4a5560'))`,
                // Each call's edge to its caller; the waiting calls' path from the first call is lit.
                connectTo: { indexExpr: parent, pinned: true, bendExpr: '0', color: '#7f93aa',
                    colorExpr: `${on('stack', 'idx')} and ${on('stack', parent)} ? '${PINK}' : ''`, highlightExpr: `${on('stack', 'idx')} and ${on('stack', parent)}` },
            },
            // The current call's arguments, wired to its node; x never changes, n halves (or drops by one or two).
            ...(withX ? [{ ...label('x', `concat('x = ', ${inp('x')})`, [4.6, -3.6, 0], ['calls', `${c('cur')}`]), codeRef: { file: 'recursion', line: 1 } }] : []),
            { ...label('n', `${c('n')} < 0 ? 'n: —' : concat('n = ', ${c('n')})`, [4.6, -3.6, 0], ['calls', `${c('cur')}`]), codeRef: { file: 'recursion', line: withX ? 1 : 9 } },
            // Fast power's half: the smaller copy's answer, set on line 4 once that call returns.
            ...(withX ? [{ ...label('half', `${c('half')} < 0 ? 'half: —' : concat('half = ', ${c('half')})`, [4.6, -3.6, 0]), codeRef: { file: 'recursion', line: 4 } }] : []),
            label('returned', `${c('result')} < 0 ? 'returned: —' : concat('returned ', ${c('result')})`, [4.6, -3.6, 0]),
            label('depth', `concat('waiting calls: ', sum(${c('stack')}))`, [4.6, -3.6, 0]),
        ];
    };
    const callsTable = (parents: number[]) => parents.map(p => ({ p }));
    pattern({
        id: 'recursion', title: 'Solve smaller copies (recursion)', file: 'recursion.py', source: RECURSION_SOURCE,
        callEntryLine: 1,
        input: { x, n, fib }, trace: pow.trace,
        more: {
            data: { callsPow: callsTable(pow.parents), callsFib: callsTable(fb.parents), rec_fib: fb.trace },
            steps: [{
                id: 'fib', title: 'Two smaller copies (Fibonacci)', description: 'Naive Fibonacci: two smaller copies per call, so the call tree branches and repeats work.',
                descriptionExpr: `dataTable('rec_fib', frame, 'message')`,
                remove: [{ id: '*' }, { type: 'slider' }],
                sliders: [{ id: 'frame', label: 'Execution state', min: 0, max: fb.trace.length - 1, step: 1, default: 0 }],
                codeRef: { file: 'recursion', lineExpr: `dataTable('rec_fib', frame, 'line')`, callsExpr: `dataTable('rec_fib', frame, 'calls')`, callEntryLine: 9 },
                add: elements('rec_fib', 'callsFib', 2.35, false),
            }],
            locations: fb.trace.map((f, snapshot) => ({ line: f.line, scene: 'recursion', step: 'fib', snapshot, label: `Fibonacci · ${f.message}` })),
        },
        markdown: `# Solve smaller copies (recursion)

**Signal:** the problem contains smaller copies of itself: trees, nested structures, divide and conquer (merge sort, fast power).

Write the **base case** first, then **trust** the recursive call to solve the smaller copy, and combine its answer. Each call gets its own frame on the call stack until it returns, so depth costs memory.

The scene draws every call as a node of the **call tree**, under the call that made it. Gold is where the code is now, pink calls are waiting for a smaller copy to return, and teal calls have returned, showing their result.

- **Fast power** (this step): \`power(x, n)\` needs one smaller copy, \`power(x, n // 2)\`, so the calls form a chain only about log₂ n long: ${pow.parents.length} calls for n = ${n}, instead of ${n} multiplications.
- **Fibonacci** (next step): \`fib(n)\` needs **two** smaller copies, so the tree branches, and the same copy is solved again and again: fib(${fib}) already makes ${fb.parents.length} calls, and the count grows exponentially. Remembering each answer (memoization) is exactly dynamic programming.

${MD_TAIL}

**Practice:** Pow(x, n), Merge Two Sorted Lists, Sort an Array (merge sort), Fibonacci Number, Climbing Stairs.`,
        prompt: 'Explain base case, trusting the recursive call, and the call stack. Ask the learner to predict what each call returns before the player reveals it, and why naive Fibonacci repeats work.',
        elements: elements('trace', 'callsPow', 2.35, true),
    });
    const scene = scenes.at(-1)!, first = (scene.steps as Json[])[0]!;
    Object.assign(first, { title: 'One smaller copy (fast power)', description: 'Fast power: one smaller copy per call, so the calls form a short chain.' });
})();

// Simplest first: arrays, strings, stack/queue/heap, linked structures, trees and graphs, then search over choices.
const ORDER = ['overview',
    'prefix-sum', 'hash-map', 'two-pointers', 'sliding-window', 'kadane', 'rotated-search', 'merge-intervals', 'greedy', 'bit-manipulation',   // arrays
    'string-matching', 'trie',                                                                                        // strings
    'monotonic-stack', 'monotonic-queue', 'top-k',                                                                    // stack, queue, heap
    'fast-slow', 'linked-list-reversal',                                                                              // linked structures
    'tree-traversal', 'matrix-traversal', 'topological-sort', 'union-find',            // trees and graphs
    'recursion', 'backtracking', 'dynamic-programming', 'dp-2d'];                                                              // searching over choices                                                // searching over choices
scenes.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
codeFiles.sort((a, b) => ORDER.indexOf(a.id as string) - ORDER.indexOf(b.id as string));
process.stdout.write(JSON.stringify({ title: 'Common algorithm patterns', codeFiles, scenes }));
