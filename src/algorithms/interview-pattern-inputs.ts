/** Example inputs for the interview-patterns draft, shared by its generator and its tests. */
export const INTERVIEW_INPUTS = {
    prefix: { nums: [3, 1, 4, 1, 5, 9, 2, 6], queries: [[2, 5], [0, 3]] as [number, number][] },
    twoPointers: { nums: [2, 3, 5, 7, 8, 11, 13, 17], target: 18 },
    slidingWindow: { nums: [2, 1, 5, 1, 3, 2, 6, 1], k: 3 },
    fastSlow: { nums: [2, 6, 4, 1, 3, 1, 5] },
    monotonic: { temps: [73, 74, 75, 71, 69, 72, 76, 73] },
    rotated: { nums: [22, 27, 31, 2, 5, 8, 11, 13, 15, 18], target: 15 },
    intervals: { input: [[8, 10], [1, 3], [2, 6], [15, 18], [9, 12]] as [number, number][] },
    dp: { houses: [2, 7, 9, 3, 1, 4] },
};
