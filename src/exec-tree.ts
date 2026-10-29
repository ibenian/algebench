/**
 * The execution tree of a recorded run, up to a frame: every call is a node under the call (or loop) that made it,
 * every for / while loop a node under its call that counts its iterations. It is read off the trace alone, the
 * executing line of each frame and, for recursive code, its `calls` (the call sites still waiting to return), so
 * it grows with the run as the Code panel steps through it. Its size is the work done: the runtime complexity.
 * Pure, so it is testable.
 */

export interface ExecFrame { line: number; calls?: readonly number[] }
export interface ExecNode {
    id: number;
    kind: 'call' | 'loop';
    /** A call as the code writes it (`dfs(v)`), or a loop's header (`for v in adj[u]`). */
    label: string;
    /** The def line of a call's function; a loop's header line. */
    line: number;
    /** The line a call was made from (none for the first call). */
    site: number | null;
    parent: number | null;
    children: number[];
    depth: number;
    /** Calls above it, itself included (loops not counted). */
    callDepth: number;
    /** The frame it started at. */
    frame: number;
    /** A loop's iterations so far; for a node made inside a loop, the iteration it was made in. */
    iterations: number;
    iteration: number | null;
    /** A call that has returned; a loop that has ended. */
    done: boolean;
}
export interface ExecTree {
    nodes: ExecNode[];
    /** Where the run is at the frame: the innermost loop or call executing. */
    current: number;
    calls: number;
    /** The deepest call nesting (the first call is 0). */
    iterations: number;
    maxDepth: number;
}

const indent = (line: string) => line.length - line.trimStart().length;

/** The last line of the block a header line opens (by indentation), 1-based. */
function blockEnd(lines: readonly string[], header: number): number {
    const own = indent(lines[header - 1]!);
    let end = header;
    for (let i = header; i < lines.length; i++) {
        const text = lines[i]!;
        if (!text.trim()) continue;
        if (indent(text) <= own) break;
        end = i + 1;
    }
    return end;
}

/** The innermost def holding a line: its line and name, or null for top-level code. */
function enclosingDef(lines: readonly string[], line: number): { line: number; name: string; text: string } | null {
    let best: { line: number; name: string; text: string } | null = null;
    lines.forEach((text, i) => {
        const m = /^\s*def\s+([A-Za-z_]\w*)\s*\(/.exec(text);
        if (m && i + 1 <= line && blockEnd(lines, i + 1) >= line) best = { line: i + 1, name: m[1]!, text: text.trim().replace(/^def\s+/, '').replace(/:\s*(#.*)?$/, '') };
    });
    return best;
}

/** Each `name(...)` call written on a line, parentheses balanced. */
export function callsOn(text: string, name: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g');
    for (let m = re.exec(text); m; m = re.exec(text)) {
        let depth = 0, end = -1;
        for (let i = m.index + m[0].length - 1; i < text.length; i++) {
            if (text[i] === '(') depth++;
            else if (text[i] === ')' && --depth === 0) { end = i; break; }
        }
        if (end > 0) out.push(text.slice(m.index, end + 1).replace(/\s+\(/, '('));
    }
    return out;
}

const LOOP = /^\s*(for|while)\b/;
const loopLabel = (text: string) => text.trim().replace(/:\s*(#.*)?$/, '');

/**
 * The tree for frames 0..upto. `label` may rewrite a call's text with the values the run had there (`dfs(v)` →
 * `dfs(3)`), given the frame the call was made from.
 */
export function execTree(source: string, frames: readonly ExecFrame[], upto: number, label: (call: string, frame: number) => string = c => c): ExecTree {
    const lines = source.split('\n');
    const nodes: ExecNode[] = [];
    const tree: ExecTree = { nodes, current: -1, calls: 0, iterations: 0, maxDepth: 0 };
    if (!frames.length || upto < 0) return tree;
    const add = (kind: ExecNode['kind'], text: string, line: number, site: number | null, parent: number | null, frame: number): ExecNode => {
        const up = parent == null ? null : nodes[parent]!;
        const node: ExecNode = { id: nodes.length, kind, label: text, line, site, parent, children: [], depth: up ? up.depth + 1 : 0,
            callDepth: (up?.callDepth ?? 0) + (kind === 'call' && up ? 1 : 0), frame,
            iterations: kind === 'loop' ? 1 : 0, iteration: up?.kind === 'loop' ? up.iterations : null, done: false };
        nodes.push(node);
        up?.children.push(node.id);
        if (kind === 'call') { tree.calls++; tree.maxDepth = Math.max(tree.maxDepth, node.callDepth); }
        else tree.iterations++;
        return node;
    };
    // The calls in progress, outermost first; each with its function's name and the loops open in it, outermost first.
    type Open = { call: ExecNode; name: string; loops: { node: ExecNode; end: number }[]; last?: number };
    // Every loop in the code, outer ones first.
    const loops = lines.flatMap((t, i) => LOOP.test(t) ? [{ line: i + 1, end: blockEnd(lines, i + 1), def: enclosingDef(lines, i + 1)?.line }] : []);
    const first = frames[0]!.line, root = enclosingDef(lines, first);
    let stack: Open[] = [{ call: add('call', root ? label(root.text, 0) : 'run', root?.line ?? first, null, null, 0), name: root?.name ?? '', loops: [] }];
    // A run without a calls column is followed by which function each line is in: entering one from a line that
    // calls it is a call; going back is its return; a function that calls the one that ran first becomes its caller.
    const implicit = !frames.some(fr => fr.calls !== undefined);
    const lift = (id: number, by: number) => {
        const n = nodes[id]!;n.depth += by;n.callDepth += by;tree.maxDepth = Math.max(tree.maxDepth, n.callDepth);
        n.children.forEach(c => lift(c, by));
    };
    const inner = () => stack[stack.length - 1]!;
    const container = () => { const top = inner(); return top.loops.length ? top.loops[top.loops.length - 1]!.node : top.call; };
    const closeLoops = (top: { loops: { node: ExecNode; end: number }[] }, keepWhile: (l: { node: ExecNode; end: number }) => boolean) => {
        while (top.loops.length && !keepWhile(top.loops[top.loops.length - 1]!)) top.loops.pop()!.node.done = true;
    };
    let previousDepth = 0;
    for (let f = 0; f <= Math.min(upto, frames.length - 1); f++) {
        const { line, calls = [] } = frames[f]!;
        const depth = calls.length;
        let lingering: ExecNode | null = null;
        // Deeper: a call per new level, made from the waiting call site, under the loop it was made in.
        while (stack.length - 1 < depth) {
            const site = calls[stack.length - 1]!;
            const parentTop = inner();
            closeLoops(parentTop, l => site <= l.end && site >= l.node.line);
            const def = enclosingDef(lines, line);
            const name = def?.name ?? '';
            const written = name ? callsOn(lines[site - 1] ?? '', name) : [];
            const made = container().children.filter(id => nodes[id]!.kind === 'call' && nodes[id]!.site === site).length;
            const text = written.length ? written[made % written.length]! : `${name || 'call'}(…)`;
            const node = add('call', label(text, Math.max(0, f - 1)), def?.line ?? line, site, container().id, f);
            stack.push({ call: node, name, loops: [] });
        }
        // Shallower: the calls that returned. A run may record a call's return line after popping it: that frame
        // still belongs to the call returning.
        while (stack.length - 1 > depth) {
            const done = stack.pop()!;
            closeLoops(done, () => false);
            done.call.done = true;
            const own = done.call.line;
            if (previousDepth > depth && /^\s*return\b/.test(lines[line - 1] ?? '') && line > own && line <= blockEnd(lines, own)) lingering ??= done.call;
        }
        previousDepth = depth;
        if (lingering) { tree.current = lingering.id; continue; }
        const def = implicit ? enclosingDef(lines, line) : null;
        if (def && inner().call.line !== def.line) {
            const at = stack.findIndex(o => o.call.line === def.line);
            const prev = f > 0 ? frames[f - 1]!.line : 0, written = callsOn(lines[prev - 1] ?? '', def.name);
            const callerLine = lines.findIndex((t, i) => i + 1 > def.line && i + 1 <= blockEnd(lines, def.line) && callsOn(t, stack[0]!.name).length > 0) + 1;
            const end = (o: Open) => { closeLoops(o, () => false);o.call.done = true; };
            if (at >= 0) while (stack.length - 1 > at) end(stack.pop()!);
            else if (written.length) {
                closeLoops(inner(), l => prev >= l.node.line && prev <= l.end);
                stack.push({ call: add('call', label(written[0]!, f - 1), def.line, prev, container().id, f), name: def.name, loops: [] });
            } else if (stack.length === 1 && callerLine > 0) {
                const callee = stack[0]!;end(callee);
                const caller = add('call', label(def.text, f), def.line, null, null, f);
                callee.call.parent = caller.id;callee.call.site = callerLine;caller.children.push(callee.call.id);lift(callee.call.id, 1);
                stack = [{ call: caller, name: def.name, loops: [] }];
            } else {
                stack.forEach(end);
                stack = [{ call: add('call', label(def.text, f), def.line, null, null, f), name: def.name, loops: [] }];
            }
        }
        // Loops, read off where the run goes (a run need not stop on a loop's header): leaving a loop's block ends
        // it; going back within the innermost loop still open (or to its header again) is its next iteration; a
        // line in a loop not open yet opens it, outer loops first.
        const top = inner();
        closeLoops(top, l => line >= l.node.line && line <= l.end);
        const back = top.loops[top.loops.length - 1];
        if (back && top.last != null && (line < top.last || (line === top.last && line === back.node.line))) { back.node.iterations++;tree.iterations++; }
        const here = enclosingDef(lines, line)?.line;
        for (const loop of loops) {
            if (loop.line > line || loop.end < line || loop.def !== here) continue;
            if (!top.loops.some(l => l.node.line === loop.line)) top.loops.push({ node: add('loop', loopLabel(lines[loop.line - 1]!), loop.line, null, container().id, f), end: loop.end });
        }
        top.last = line;
        tree.current = container().id;
    }
    return tree;
}
