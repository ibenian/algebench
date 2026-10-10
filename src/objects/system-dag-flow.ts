/** Arc-length progress keeps a flow cue continuous through routed pipe bends. */
export function pipeFlowPath(points: readonly (readonly number[])[]): { length: number; offsets: number[] } {
    const offsets=[0];
    for (let i=1;i<points.length;i++) offsets.push(offsets[i-1]! + Math.hypot(...points[i]!.map((v,j)=>v-points[i-1]![j]!)));
    return { length:offsets.at(-1) ?? 0, offsets };
}
export function pipeFlowPhase(nowMs: number): number {
    if (!Number.isFinite(nowMs)) return 0;
    // One complete traversal per second, independent of route length.
    const turns=nowMs / 1000;
    return ((turns % 1) + 1) % 1;
}
