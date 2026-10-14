// Visual building blocks for the distributed databases lab. The cluster board is one system_dag:
// clients (with their operation timeline) → network (messages in flight) → one block per node,
// each holding its copy of every key. Everything reads the `dd` trace table at the current tick.
import { T, COLORS, codeColorMap, LAB } from './util.mjs';

const { FRAMES, MSG_SLOTS } = LAB.limits;
const PITCH = 6.8, NODE_W = 6.1;
const wire = (id, from, to, extra = {}) => ({ id, from: { block: from[0], port: from[1] }, to: { block: to[0], port: to[1] }, ...extra });

/** Board geometry for `nodes` node blocks and `keys` keys per node; shared by the board and whatever sits beside it. */
export function geometry(nodes, keys) {
    const width = Math.max(31, nodes * PITCH);
    const rowH = keys > 4 ? 0.62 : 0.9;
    // The status line sits at the block's centre (system_dag draws it there for blocks with contents);
    // the key cells fill the lower half below it.
    const nodeH = 2 * (1.55 + keys * rowH);
    const nodeTop = 1.0;
    // Node-to-node pipes run in lanes under the node row, one lane per pair, nearest pairs highest.
    const pairs = [];
    for (let a = 0; a < nodes; a++) for (let b = a + 1; b < nodes; b++) pairs.push([a, b]);
    const lanes = pairs.slice().sort((p, q) => (p[1] - p[0]) - (q[1] - q[0]) || p[0] - q[0]);
    const nodeBottom = nodeTop - nodeH, laneGap = 0.42, laneTop = nodeBottom - 0.75;
    const laneY = ([a, b]) => laneTop - lanes.findIndex(p => p[0] === a && p[1] === b) * laneGap;
    const bottom = laneTop - Math.max(0, lanes.length - 1) * laneGap - 0.3;
    return { width, rowH, nodeH, nodeTop, nodeY: nodeTop - nodeH / 2, nodeBottom, bottom, pairs, laneY, x: i => (i - (nodes - 1) / 2) * PITCH, left: -width / 2, right: width / 2 };
}

function timeline(prefix, clients, width) {
    // Row labels ("C1 → N1") need ~2.8 units on the left; keep a 1-unit margin on the right.
    const labels = 2.8, margin = 1.0;
    const cell = (width - labels - margin) / (FRAMES + 1);
    return {
        type: 'tensor', id: prefix + 'timeline', shape: [clients, FRAMES + 1], origin: [-width / 2 + labels, -2.85, 0.25], cellSize: cell, gap: 0.05, plane: 'xy',
        valueExpr: `col <= frame ? ddCell(${T('tl')}, row, col) : 0`, textExpr: `col <= frame ? ddText(${T('tlText')}, row, col) : ''`, textColor: 'auto',
        colorMap: codeColorMap(COLORS.timeline), colorDomain: [0, COLORS.timeline.length - 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: `ddAt(${T('clientNames')}, row)`, color: '#b8cee0' }, { labelExpr: "idx % 5 == 0 ? concat('t', idx) : ''", color: '#7f93a8' }], axisLabels: 'plane',
        label: 'Operation history (time →)',
        prompt: 'Explain this operation history: each row is a client, each column a tick. Blue = write in flight, grey-blue = read in flight, green = acknowledged write, light green = fresh read, magenta = a read that broke a consistency guarantee, red = rejected or timed out, orange = an acknowledged write that was later lost, amber = siblings. Relate each read to the writes that finished before it started.',
    };
}
function clientStatus(prefix, clients, width) {
    // One cell per client across the block: status lines carry the session token, so they need the room.
    const cell = (width - 1.6) / clients;
    return {
        type: 'array', id: prefix + 'client-status', itemType: 'string', stringQuotes: false, origin: [-width / 2 + 0.8 + cell / 2, 1.45, 0.25], cellSize: cell, fontSize: 10, showIndices: false,
        arrayColumns: clients, axisLabels: 'plane',
        lengthExpr: `min(ddCount(${T('clientText')}), ${clients})`, valueExpr: `ddAt(${T('clientText')}, idx)`,
        prompt: 'Explain what each client is doing right now: which operation, through which node, how many acknowledgements or replies it has versus how many it needs, and the session token it carries (the log position a replica must have applied before it may answer this client).',
    };
}
function messages(prefix) {
    return {
        type: 'array', id: prefix + 'messages', itemType: 'string', stringQuotes: false, origin: [-11.4, -0.35, 0.25], cellSize: 7.6, fontSize: 10, showIndices: false,
        arrayColumns: 4, axisLabels: 'plane',
        lengthExpr: `min(ddCount(${T('msgText')}), ${MSG_SLOTS})`, valueExpr: `ddAt(${T('msgText')}, idx)`,
        prompt: 'Explain the messages in flight: sender → receiver, what each carries (log entries, a put, a read, a reply, a hint, a repair) and the tick it arrives. Messages across a partition or to a crashed node are dropped.',
    };
}
function replicaCells(prefix, i, keys, g) {
    const rowH = g.rowH;
    return {
        type: 'array', id: `${prefix}node${i}-keys`, itemType: 'string', stringQuotes: false, origin: [-NODE_W / 2 + 0.35 + 2.7, -0.55 - rowH / 2 - 0.35, 0.25], cellSize: 5.4, fontSize: keys > 4 ? 9 : 11, showIndices: false,
        arrayColumns: 1, arrayHeight: keys * g.rowH, axisLabels: 'plane',
        lengthExpr: `min(ddCount(${T('keys')}), ${keys}) * (${i} < ${T('nodeCount')})`,
        valueExpr: `concat(ddAt(${T('keys')}, idx), ' = ', ddText(${T('verGrid')}, ${i}, idx))`,
        colorExpr: `ddVerColor(${T('verCodes')}, ${i}, idx)`,
        prompt: 'Explain this node\'s copy of each key: green = it holds the newest version, orange = it is behind, amber = it holds siblings (two concurrent versions), purple = a tombstone (deleted), ⟨…⟩ = a hinted write it holds for another node, dark = the node is down.',
    };
}

/** Normalized bottom-edge offset on node i of its port towards peer j (peers spread over the middle 70%). */
function peerOffset(i, j, nodes) {
    const peers = Array.from({ length: nodes }, (_, k) => k).filter(k => k !== i);
    return peers.length === 1 ? 0 : -0.7 + 1.4 * peers.indexOf(j) / (peers.length - 1);
}
function peerPorts(i, nodes) {
    return Array.from({ length: nodes }, (_, j) => j).filter(j => j !== i).map(j => ({ id: 'peer' + j, side: 'bottom', offset: peerOffset(i, j, nodes) }));
}

/** The cluster board: [system_dag, metrics strip]. */
export function clusterBoard({ prefix = '', nodes = 3, keys = 1, clients = 3, metrics = DEFAULT_METRICS, codeRefs = {} }) {
    const g = geometry(nodes, keys);
    const nodeBlocks = Array.from({ length: nodes }, (_, i) => ({
        id: 'n' + i, label: `N${i + 1}`, kind: 'database', position: [g.x(i), g.nodeY, 0], size: [NODE_W, g.nodeH, 0.18],
        textExpr: `ddAt(${T('nodeText')}, ${i})`, colorExpr: `ddNodeColor(${T('nodeCodes')}, ${i})`,
        // One bottom port per peer, ordered left to right by the peer's position.
        ports: [{ id: 'net', side: 'top', offset: 0 }, ...peerPorts(i, nodes)],
        elements: [replicaCells(prefix, i, keys, g)],
        ...(codeRefs.node ? { codeRef: codeRefs.node } : {}),
    }));
    const dag = {
        type: 'system_dag', id: prefix + 'cluster', label: 'Cluster', pipeRadius: 0.07, origin: [0, 0, 0],
        blocks: [
            { id: 'clients', label: 'Clients · each talks to one node (→)', kind: 'client', position: [0, 11.4, 0], size: [g.width, 6.4, 0.18],
                ports: [{ id: 'req', side: 'bottom', offset: 0 }], elements: [timeline(prefix, clients, g.width), clientStatus(prefix, clients, g.width)],
                ...(codeRefs.client ? { codeRef: codeRefs.client } : {}) },
            { id: 'net', label: 'Network · messages in flight', kind: 'gateway', position: [0, 4.4, 0], size: [g.width, 3.6, 0.18],
                textExpr: `concat(${T('msgCount')}, ' in flight')`,
                ports: [{ id: 'req', side: 'top', offset: 0 }, ...nodeBlocks.map((b, i) => ({ id: 'n' + i, side: 'bottom', offset: g.x(i) / (g.width / 2) }))],
                elements: [messages(prefix)] },
            ...nodeBlocks,
        ],
        connections: [
            wire('req', ['clients', 'req'], ['net', 'req'], { activeExpr: `ddCount(${T('ops')}) > 0`, direction: 'both', activeColor: '#9ad7ff' }),
            // Network ↔ node: client requests reaching their coordinator node.
            ...nodeBlocks.map((b, i) => wire('link' + i, ['net', 'n' + i], [b.id, 'net'], {
                activeExpr: `ddAt(${T('clientLinks')}, ${i}) == 1`, colorExpr: `ddLinkColor2(${T('linkCodes')}, ${i})`, direction: 'both', activeColor: '#9ad7ff',
            })),
            // Node ↔ node: lit while a message travels between the two; red while a partition cuts them.
            ...g.pairs.map(([a, b]) => {
                const y = g.laneY([a, b]);
                const xa = g.x(a) + peerOffset(a, b, nodes) * NODE_W / 2, xb = g.x(b) + peerOffset(b, a, nodes) * NODE_W / 2;
                return wire(`p${a}${b}`, ['n' + a, 'peer' + b], ['n' + b, 'peer' + a], {
                    via: [{ position: [xa, y, 0.15] }, { position: [xb, y, 0.15] }], radius: 0.05,
                    activeExpr: `ddPair(${T('pairCodes')}, ${T('nodeCount')}, ${a}, ${b})`, colorExpr: `ddPairColor(${T('pairCodes')}, ${T('nodeCount')}, ${a}, ${b})`,
                    // No fixed arrowheads: the pulse shows which way this tick's messages travel.
                    direction: 'none', directionExpr: `ddPairDir(${T('pairDirs')}, ${T('nodeCount')}, ${a}, ${b})`, activeColor: '#f1c96b',
                });
            }),
        ],
    };
    return [dag, metricsStrip(prefix, metrics, [g.left, g.bottom - 3.6, 0])];
}

export const DEFAULT_METRICS = [['Available %', 'm_availability'], ['p99 latency', 'm_p99'], ['Stale reads', 'm_stale'], ['Lost writes', 'm_lost'], ['Failed ops', 'm_unavailable'], ['Messages', 'm_msgs']];
export function metricsStrip(prefix, metrics, origin, table = 'dd') {
    const field = f => `dataTable('${table}', frame, '${f}')`;
    const pick = metrics.map(([, f], i) => (i < metrics.length - 1 ? `col == ${i} ? ${field(f)} : ` : field(f))).join('');
    return {
        id: prefix + 'metrics', type: 'tensor', shape: [1, metrics.length], origin, cellSize: 2.6, gap: 0.06, plane: 'xy',
        valueExpr: pick, textExpr: 'value', textColor: '#edf4ff',
        colorMap: { stops: [{ t: 0, color: '#22384d' }, { t: 1, color: '#22384d' }] }, colorDomain: [0, 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labels: metrics.map(m => m[0]), color: '#b8cee0', labelBand: 0.4 }], axisLabels: 'plane',
        prompt: 'Explain these counters for the run so far: the share of operations that succeeded, the slowest latency, reads that broke a consistency guarantee, acknowledged writes that were later lost, operations rejected or timed out, and messages sent. Relate them to the trade-off the current settings make.',
    };
}

/** A computed comparison matrix (rows × cols) with outcome codes (see COLORS.outcome). */
export function matrix({ id, origin, rows, cols, valueExpr, textExpr, rowLabelExpr, colLabels, colLabelExpr, label, prompt, cellSize = 2.5 }) {
    return {
        type: 'tensor', id, shape: [rows, cols], origin, cellSize, gap: 0.08, plane: 'xy',
        valueExpr, textExpr, textColor: 'auto',
        colorMap: codeColorMap(COLORS.outcome), colorDomain: [0, COLORS.outcome.length - 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: rowLabelExpr, color: '#b8cee0' }, colLabelExpr ? { labelExpr: colLabelExpr, color: '#b8cee0' } : { labels: colLabels, color: '#b8cee0' }], axisLabels: 'plane',
        label, prompt,
    };
}

/** Two Merkle trees side by side: rows are levels (root on top), cells the hashes; red = differs, green = matches. */
export function merkleTrees(prefix, origin) {
    const tree = which => ({
        type: 'tensor', id: `${prefix}merkle-${which}`, shape: [4, 8], origin: [origin[0], origin[1] - which * 4.6, 0], cellSize: 1.05, gap: 0.06, plane: 'xy',
        valueExpr: `ddMerkleCode(${T('merkle')}, row, col)`, textExpr: `ddMerkleText(${T('merkle')}, ${which}, row, col)`, textColor: 'auto',
        colorMap: codeColorMap(['#1c2631', '#2f6b4f', '#b5524f']), colorDomain: [0, 2], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: `row == 0 ? ddMerkleTitle(${T('merkle')}, ${which}) : (row == 3 ? 'keys' : concat('level ', row))`, color: '#b8cee0' }, {}], axisLabels: 'plane',
        prompt: 'Explain this Merkle tree comparison from the last anti-entropy pass: leaves hash one key each, every parent hashes its two children, and the comparison starts at the root. Matching hashes (green) mean the whole subtree agrees and is skipped; red ones are descended into, down to the keys that actually differ, which are the only ones exchanged.',
    });
    return [tree(0), tree(1)];
}

// ── Scene 1 · capacity ───────────────────────────────────────────────────────
const CAP_ARGS = 'capOption, rate, writePct, extra, crashAt';
export function capacityBoard(origin = [0, 0, 0]) {
    const [ox, oy] = origin;
    const servers = {
        type: 'tensor', id: 'cap-servers', shape: [1, 5], origin: [ox - 13, oy + 4, 0], cellSize: 5.2, gap: 0.12, plane: 'xy',
        valueExpr: `ddCapNodeCode(${CAP_ARGS}, frame, col)`, textExpr: `ddCapNodeText(${CAP_ARGS}, frame, col)`, textColor: 'auto',
        colorMap: codeColorMap(['#1c2631', '#3f9a6c', '#d9a441', '#c5413f', '#3a3f46']), colorDomain: [0, 4], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, {}], label: 'Servers · role and how busy each is',
        prompt: 'Explain each server cell: its role (single server, primary, replica, shard, region), how busy it is, and why. Green is comfortable, amber near capacity, red overloaded (a queue builds and latency grows without bound), grey crashed.',
    };
    const series = (field, color, label) => ({ xExpr: 'i', yExpr: `ddCapAt(${CAP_ARGS}, i, '${field}')`, n: FRAMES + 1, color, label });
    const chart = {
        type: 'chart', id: 'cap-latency', origin: [ox - 13, oy - 10.5, 0], size: [26, 11], xDomain: [0, FRAMES], yDomain: [0, 30],
        series: [series('latR', '#7fd1a0', 'read latency'), series('latW', '#e7a14a', 'write latency'),
            { xExpr: 'frame', yExpr: `ddCapAt(${CAP_ARGS}, frame, 'latW')`, n: 2, kind: 'points', color: '#ffffff', size: 10, label: 'now' }],
        axes: [{ title: 'tick', ticks: 8, labelExpr: 'toFixed(value, 0)' }, { title: 'latency (ticks)', ticks: 6, labelExpr: 'toFixed(value, 0)' }],
        label: 'Latency over time (0 = request failed)',
        prompt: 'Explain the latency curves: load ramps up over the first ten ticks; while a server has spare capacity latency stays flat, and once arrivals exceed its capacity a queue grows every tick and latency climbs steadily. A drop to zero means requests are failing outright.',
    };
    const metricCells = [['Read latency', 'latR'], ['Write latency', 'latW'], ['Reads available', 'availR'], ['Writes available', 'availW'], ['Requests / tick', 'arrivals']];
    const pick = metricCells.map(([, f], i) => (i < metricCells.length - 1 ? `col == ${i} ? ddCapAt(${CAP_ARGS}, frame, '${f}') : ` : `ddCapAt(${CAP_ARGS}, frame, '${f}')`)).join('');
    const metrics = {
        id: 'cap-metrics', type: 'tensor', shape: [1, metricCells.length], origin: [ox - 13, oy + 0.4, 0], cellSize: 2.6, gap: 0.06, plane: 'xy',
        valueExpr: pick, textExpr: 'value', textColor: '#edf4ff',
        colorMap: { stops: [{ t: 0, color: '#22384d' }, { t: 1, color: '#22384d' }] }, colorDomain: [0, 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labels: metricCells.map(m => m[0]), color: '#b8cee0', labelBand: 0.4 }], axisLabels: 'plane',
        prompt: 'Explain these numbers at the current tick: read and write latency in ticks, the fraction of reads and writes that can be served at all (1 = all, 0 = none), and the incoming request rate.',
    };
    return [servers, metrics, chart];
}

// ── Scene 7 · partitioning ───────────────────────────────────────────────────
const SHARD_ARGS = 'strategy, shards, 120, celebrity';
export function shardBoard(origin = [0, 0, 0]) {
    const [ox, oy] = origin;
    const shardColors = COLORS.node.slice(0, 8);
    const records = {
        type: 'tensor', id: 'records', shape: [6, 20], origin: [ox - 15, oy + 2, 0], cellSize: 1.5, gap: 0.06, plane: 'xy',
        valueExpr: `ddRecShard(strategy, shards, 120, row * 20 + col)`, textExpr: `ddRecText(120, row * 20 + col)`, textColor: 'auto',
        colorMap: codeColorMap(shardColors), colorDomain: [0, 7], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{ labelExpr: "row == 0 ? 'oldest' : (row == 5 ? 'newest' : '')", color: '#b8cee0' }, {}], axisLabels: 'plane',
        label: '120 users in signup order (id, country) · colour = shard',
        prompt: 'Explain how the selected strategy placed these 120 user records: each cell is a user (id and country) in signup order, coloured by the shard that stores it. Range strategies make contiguous bands; hashing scatters neighbours across shards.',
    };
    const bars = (id, fn, label, y, prompt) => ({
        type: 'tensor', id, shape: [1, 8], origin: [ox - 15, oy + y, 0], cellSize: 3.6, gap: 0.2, plane: 'xy',
        valueExpr: 'col', heightExpr: `col < shards ? max(0.04, ${fn}(${SHARD_ARGS}, col) / max(1, ddShardMax(${SHARD_ARGS}))) : 0.02`, anchor: 'bottom',
        textExpr: `col < shards ? ${fn}(${SHARD_ARGS}, col) : ''`, textColor: '#0b1118',
        colorMap: codeColorMap(shardColors), colorDomain: [0, 7], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labelExpr: "concat('shard ', idx + 1)", color: '#b8cee0' }], axisLabels: 'plane', label, prompt,
    });
    const queries = {
        type: 'tensor', id: 'queries', shape: [1, 4], origin: [ox - 15, oy - 11.5, 0], cellSize: 3.6, gap: 0.2, plane: 'xy',
        valueExpr: `ddShardsTouched(${SHARD_ARGS}, col) == 1 ? 0 : (ddShardsTouched(${SHARD_ARGS}, col) == shards ? 2 : 1)`,
        textExpr: `concat(ddShardsTouched(${SHARD_ARGS}, col), ' / ', shards, ' shards')`, textColor: 'auto',
        colorMap: codeColorMap(['#3f9a6c', '#d9a441', '#b5524f']), colorDomain: [0, 2], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labelExpr: 'ddQuery(idx)', color: '#b8cee0' }], axisLabels: 'plane', label: 'Shards each query must ask',
        prompt: 'Explain query routing: a query that filters on the partition key can go to one shard (green); otherwise the router must scatter it to every shard and gather the answers (red). Which strategy routes which query?',
    };
    return [records,
        bars('shard-writes', 'ddShardLoad', 'Write load per shard (now)', -5, 'Explain the write load on each shard right now: new signups plus updates to existing users, plus the celebrity\'s traffic when enabled. The tallest bar is the hot partition that limits the whole system.'),
        queries];
}

// ── Scene 8 · consistent hashing ─────────────────────────────────────────────
const RING = 'nodes, vnodes, change, phase';
export function ringBoard(origin = [0, 0, 0]) {
    const [ox, oy] = origin;
    const series = [{ xExpr: 'cos(2 * pi * i / 120)', yExpr: 'sin(2 * pi * i / 120)', n: 121, color: '#4a5a6c', width: 2 }];
    for (let n = 0; n < 9; n++) {
        series.push({ xExpr: `ddKeyOn(${RING}, i, ${n}, 0, 0, 0.84)`, yExpr: `ddKeyOn(${RING}, i, ${n}, 0, 1, 0.84)`, n: 48, kind: 'points', color: COLORS.node[n], size: 7 });
        series.push({ xExpr: `ddTokenX(${RING}, i, ${n}, 1)`, yExpr: `ddTokenY(${RING}, i, ${n}, 1)`, n: 64, kind: 'points', color: COLORS.node[n], size: 13, ...(n < 6 ? { label: `N${n + 1} tokens` } : {}) });
    }
    series.push({ xExpr: `ddKeyMoved(${RING}, i, 0, 0.72)`, yExpr: `ddKeyMoved(${RING}, i, 1, 0.72)`, n: 48, kind: 'points', color: '#ffffff', size: 9, label: 'moved keys' });
    const ring = {
        type: 'chart', id: 'ring', origin: [ox - 12, oy - 12, 0], size: [20, 20], xDomain: [-1.15, 1.15], yDomain: [-1.15, 1.15], grid: false,
        series, axes: [{ ticks: 0, labelExpr: "''" }, { ticks: 0, labelExpr: "''" }],
        label: 'Hash ring · big dots = node tokens (virtual nodes), small = keys (owner colour), white = moved',
        prompt: 'Explain the hash ring: node tokens (large dots) and keys (small dots) are hashed onto the same circle; each key belongs to the first token clockwise from it. With virtual nodes each server owns many small arcs. White dots are the keys that changed owner after the node change.',
    };
    const share = {
        type: 'tensor', id: 'ring-share', shape: [1, 9], origin: [ox + 11, oy + 1, 0], cellSize: 1.9, gap: 0.12, plane: 'xy',
        valueExpr: 'col', heightExpr: `col < ddRingNodes(nodes, change) ? max(0.04, ddRingShare(${'nodes, vnodes, change'}, col) / 50) : 0.02`, anchor: 'bottom',
        textExpr: `col < ddRingNodes(nodes, change) ? concat(ddRingShare(nodes, vnodes, change, col), '%') : ''`, textColor: '#0b1118',
        colorMap: codeColorMap(COLORS.node), colorDomain: [0, 8], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labelExpr: "concat('N', idx + 1)", color: '#b8cee0' }], axisLabels: 'plane', label: 'Share of the ring after the change',
        prompt: 'Explain each node\'s share of the hash ring (and so of the keys and load) after the change. With one token per node the shares are very uneven; with many virtual nodes they approach the fair share.',
    };
    const moved = {
        type: 'tensor', id: 'ring-moved', shape: [1, 2], origin: [ox + 11, oy - 4.5, 0], cellSize: 4.2, gap: 0.2, plane: 'xy',
        valueExpr: 'col', heightExpr: `max(0.04, (col == 0 ? ddRingMoved(nodes, vnodes, change) : ddRingMovedMod(nodes, vnodes, change)) / ddRingKeys())`, anchor: 'bottom',
        textExpr: `concat(col == 0 ? ddRingMoved(nodes, vnodes, change) : ddRingMovedMod(nodes, vnodes, change), ' / ', ddRingKeys())`, textColor: '#0b1118',
        colorMap: codeColorMap(['#5aa0c8', '#c5413f']), colorDomain: [0, 1], opacity: 0.95, shader: { ignorePlaneOpacity: true },
        axes: [{}, { labels: ['consistent hash', 'hash mod N'], color: '#b8cee0' }], axisLabels: 'plane', label: 'Keys that move for this change',
        prompt: 'Compare how many of the 48 keys change owner under consistent hashing versus hash-mod-N for the same change of node count, and explain why the numbers differ so much.',
    };
    const pref = {
        type: 'array', id: 'ring-pref', itemType: 'string', stringQuotes: false, origin: [ox + 15.2, oy - 8.5, 0], cellSize: 8.6, fontSize: 12, showIndices: false, axisLabels: 'plane',
        lengthExpr: '1', valueExpr: `concat('key ', prefKey, ' → ', ddPreference(nodes, vnodes, change, prefKey, rf))`,
        label: 'Preference list (RF distinct nodes clockwise)', labelPosition: 'top',
        prompt: 'Explain the preference list: the replicas of a key are the first RF distinct physical nodes found walking clockwise from the key (skipping further virtual nodes of a server already chosen). This is where the N replicas of the quorum scene live.',
    };
    return [ring, share, moved, pref];
}
