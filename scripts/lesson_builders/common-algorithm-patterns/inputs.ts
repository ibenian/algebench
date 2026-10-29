/** Example inputs for the common-algorithm-patterns lesson, shared by its generator and its tests. */
export const PATTERN_INPUTS = {
    prefix: { nums: [3, 1, 4, 1, 5, 9, 2, 6], queries: [[2, 5], [0, 3]] as [number, number][] },
    twoPointers: { nums: [2, 3, 5, 7, 8, 11, 13, 17], target: 18 },
    // Two Sum on an unsorted list, then subarrays summing to k: both remember what they have seen in a dict.
    hashMap: { nums: [4, 11, 7, 2, 15, 5], target: 9, sums: [1, 2, -2, 2, 1], sumTarget: 3 },
    slidingWindow: { nums: [2, 1, 5, 1, 3, 2, 6, 1], k: 3 },
    fastSlow: { nums: [2, 6, 4, 1, 3, 1, 5] },
    monotonic: { temps: [73, 74, 75, 71, 69, 72, 76, 73] },
    rotated: { nums: [22, 27, 31, 2, 5, 8, 11, 13, 15, 18], target: 15 },
    intervals: { input: [[8, 10], [1, 3], [2, 6], [15, 18], [9, 12]] as [number, number][] },
    dp: { houses: [2, 7, 9, 3, 1, 4] },
    kadane: { nums: [-2, 1, -3, 4, -1, 2, 1, -5, 4] },
    lcs: { a: 'abcbd', b: 'bdcb' },
    topK: { nums: [7, 4, 9, 1, 8, 3, 6, 5], k: 3 },
    trie: { words: ['car', 'cat', 'cart', 'care', 'dog', 'do'], queries: ['ca', 'cab', 'do'] },
    linkedList: { values: [1, 2, 3, 4, 5] },
    // Course Schedule II: [course, prerequisite] pairs; an edge runs from the prerequisite to the course.
    topo: { n: 6, prerequisites: [[1, 0], [2, 0], [3, 1], [3, 2], [4, 2], [5, 3], [5, 4]] as [number, number][] },
    recursion: { x: 2, n: 13, fib: 4 },
    subsets: { nums: [1, 2, 3] },
    islands: { grid: [
        [1, 1, 0, 0, 0, 1],
        [1, 1, 0, 1, 0, 1],
        [0, 0, 0, 1, 1, 0],
        [1, 0, 0, 0, 0, 0],
        [1, 1, 0, 1, 1, 1],
    ] },
    // A binary search tree: node i holds values[i]; parents[i] is its parent (-1: root), sides[i] 0 left / 1 right.
    tree: { values: [8, 4, 12, 2, 6, 10, 14, 1, 3], parents: [-1, 0, 0, 1, 1, 2, 2, 3, 3], sides: [0, 0, 1, 0, 1, 0, 1, 0, 1] },
    monoQueue: { nums: [1, 3, -1, -3, 5, 3, 6, 7], k: 3 },
    greedy: { nums: [3, 2, 1, 0, 4] },
    bits: { nums: [4, 1, 2, 1, 2] },
    unionFind: { n: 6, edges: [[0, 1], [1, 2], [3, 4], [2, 0], [4, 5]] as [number, number][] },
    kmp: { text: 'aabaacaadaabaaba', pattern: 'aaba' },
};
