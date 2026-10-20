"""Write scenes/draft/test-graph.json: one scene per graph-object feature (layouts, node shapes, edge routes,
list targets, links between objects, highlights, markers), most layouts written as expressions.

Run: ./run.sh scripts/lesson_builders/test-graph/build.py
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from _json_format import dumps_compact_leaves  # noqa: E402

GOLD, PINK, BLUE, TEAL, GREY, PURPLE = '#f1c65b', '#e67db0', '#9dbde3', '#77bfae', '#7f93aa', '#b69bea'
RANGE = [[-7, 7], [-5, 5], [-2, 2]]
grid = {'id': 'grid', 'type': 'grid', 'plane': 'xy', 'range': [[-7, 7], [-5, 5]], 'divisions': [14, 10], 'opacity': 0.08}
cam = lambda x=0, y=0, z=13: {'position': [x, y, z], 'target': [x, y, 0]}
slider = lambda i, label, lo, hi, d, step=1: {'id': i, 'label': label, 'min': lo, 'max': hi, 'step': step, 'default': d}

def scene(id, title, md, elements, sliders=None, camera=None, data=None):
    s = {'id': id, 'title': title, 'description': md.split('\n')[0].lstrip('# '), 'range': RANGE, 'camera': camera or cam(),
         'markdown': md, 'elements': [grid]}
    if data: s['data'] = data
    s['steps'] = [{'id': 'try', 'title': 'Try it', 'description': 'Move the sliders.', 'sliders': sliders or [], 'add': elements}]
    return s

scenes = []

# 1 · A directed ring: nodes placed on a circle by expression, edges drawn as arcs round its centre.
scenes.append(scene('ring', 'Directed ring (arc edges)', '''# Directed ring

Six **point** nodes placed by `positionExpr` alone: `2.4·cos(2π·idx/n)`, `2.4·sin(2π·idx/n)`. Each node points at the next (`indexExpr: "mod(idx + 1, n)"`), and `arcCenterExpr: ["0","0","0"]` draws every edge as an arc of the ring's own circle.

Move **k**: node k glows (`highlightExpr`), the index marker **k** follows it, and the edge leaving k lights up (`highlightExpr` on the link).''', [
    {'id': 'ring', 'type': 'graph', 'label': 'ring', 'lengthExpr': 'n', 'valueExpr': 'idx * 10',
     'positionExpr': ['2.4 * cos(2 * pi * idx / n)', '2.4 * sin(2 * pi * idx / n)', '0'],
     'nodeShape': 'point', 'nodeSize': 0.5, 'highlightExpr': 'idx == k',
     'connectTo': {'indexExpr': 'mod(idx + 1, n)', 'pinned': True, 'arrow': True, 'color': GREY,
                   'arcCenterExpr': ['0', '0', '0'], 'highlightExpr': 'idx == k', 'colorExpr': "idx == k ? '%s' : ''" % GOLD},
     'markers': [{'indexName': 'k', 'indexExpr': 'k', 'color': GOLD}]},
], [slider('n', 'Nodes n', 3, 10, 6), slider('k', 'Highlighted node k', 0, 9, 0)]))

# 2 · A binary tree of rounded blocks: positions from the heap index, two children per node via a list.
tree_x = '(idx + 1 - 2^floor(log2(idx + 1)) + 0.5) * (8 / 2^floor(log2(idx + 1))) - 4'
scenes.append(scene('tree', 'Binary tree (rect nodes, list targets)', '''# Binary tree

Seven **rect** nodes (`nodeWidth` 1, `nodeHeight` 0.7, `nodeCornerRadius` 0.15), the value written **inside**. Positions come from the heap index: level `floor(log2(idx + 1))`, spread across its row.

Each node links to **both** children with one list: `indexExpr: "[2*idx + 1, 2*idx + 2]"`. Children past the last node simply draw nothing. Edges are straight (`bendExpr: "0"`).

Move **target**: the path from the root to it lights up, nodes and edges alike.''', [
    {'id': 'tree', 'type': 'graph', 'label': 'tree', 'itemType': 'number', 'values': [8, 12, 10, 20, 15, 18, 25],
     'positionExpr': [tree_x, '2.6 - 1.6 * floor(log2(idx + 1))', '0'],
     'nodeShape': 'rect', 'nodeWidth': 1, 'nodeHeight': 0.7, 'nodeCornerRadius': 0.15,
     # idx is on the path to target when target, shifted down by the levels between them, lands on idx.
     'highlightExpr': 'floor(log2(target + 1)) >= floor(log2(idx + 1)) and floor((target + 1) / 2^(floor(log2(target + 1)) - floor(log2(idx + 1)))) == idx + 1',
     'connectTo': {'indexExpr': '[2 * idx + 1, 2 * idx + 2]', 'pinned': True, 'arrow': True, 'color': GREY, 'bendExpr': '0',
                   'highlightExpr': 'floor(log2(target + 1)) >= floor(log2(to + 1)) and floor((target + 1) / 2^(floor(log2(target + 1)) - floor(log2(to + 1)))) == to + 1',
                   'colorExpr': "''"},
     'markers': [{'indexName': 'target', 'indexExpr': 'target', 'color': PINK}]},
], [slider('target', 'Target node', 0, 6, 5)], camera=cam(0, 0.6, 12)))

# 3 · Circles, a self-loop and two-way edges, from an adjacency list in a data table.
adj = [{'to': [1, 2]}, {'to': [0, 3]}, {'to': [3]}, {'to': [3, 4]}, {'to': [0]}]
pos = [(-2.5, 1.5), (0, 2.6), (-0.8, -0.6), (2.2, 0.4), (0.8, -2.6)]
scenes.append(scene('adjacency', 'Adjacency list (circle nodes, self-loop, two-way edges)', '''# Adjacency list

Five **circle** nodes: `rect` with `nodeCornerRadius` half the side. Edges come from a data table, `dataTable('adj', idx, 'to')`, a list per node.

- 0 ⇄ 1 points both ways: the two edges bow apart (`edgeBend` 0.18), never on top of each other.
- 3 → 3 is a **self-loop**, drawn as a loop over the node.
- **Edge bend** changes how much every edge bows (0 is straight).''', [
    {'id': 'adj', 'type': 'graph', 'label': 'adjacency', 'lengthExpr': '5', 'valueExpr': "concat('v', idx)",
     'positionExpr': ["dataTable('pos', idx, 'x')", "dataTable('pos', idx, 'y')", '0'],
     'nodeShape': 'rect', 'nodeWidth': 0.9, 'nodeHeight': 0.9, 'nodeCornerRadius': 0.45, 'edgeBend': 0.18,
     'colorExpr': "idx == 3 ? '%s' : ''" % TEAL,
     'connectTo': {'indexExpr': "dataTable('adj', idx, 'to')", 'pinned': True, 'arrow': True, 'color': BLUE, 'bendExpr': 'bend'}},
], [slider('bend', 'Edge bend', 0, 0.5, 0.18, 0.02)], data={'adj': adj, 'pos': [{'x': x, 'y': y} for x, y in pos]}))

# 4 · Graph to graph, graph to array and array to graph: links between objects by name.
scenes.append(scene('graph-to-graph', 'Graph to graph (and to an array)', '''# Graph to graph

Two separate graphs. **left** is a column of keys; each key links **into the other graph** with `connectTo: {object: "right", indexExpr: …}`. **right** is a small ring with its own internal edges (no `object`: same graph).

The **slots** array links up into **left** with an array `connectTo` whose target is a graph: links reach nodes exactly as they reach cells.

Move **shift**: every key's target in **right** rotates, and the links follow.''', [
    {'id': 'left', 'type': 'graph', 'label': 'left', 'lengthExpr': '4', 'valueExpr': "concat('k', idx)",
     'positionExpr': ['-4.5', '2.2 - 1.4 * idx', '0'], 'nodeShape': 'rect', 'nodeWidth': 1, 'nodeHeight': 0.6, 'nodeCornerRadius': 0.12,
     'connectTo': {'object': 'right', 'indexExpr': 'mod(idx + shift, 5)', 'pinned': True, 'arrow': True, 'color': PURPLE, 'bendExpr': '0.08'}},
    {'id': 'right', 'type': 'graph', 'label': 'right', 'lengthExpr': '5', 'valueExpr': 'idx',
     'positionExpr': ['2.6 + 1.7 * cos(2 * pi * idx / 5 + pi / 2)', '0.2 + 1.7 * sin(2 * pi * idx / 5 + pi / 2)', '0'],
     'nodeShape': 'point', 'nodeSize': 0.5, 'valueLabel': 'none',
     'connectTo': {'indexExpr': 'mod(idx + 1, 5)', 'pinned': True, 'arrow': True, 'color': GREY, 'arcCenterExpr': ['2.6', '0.2', '0']}},
    {'id': 'slots', 'type': 'array', 'label': 'slots', 'labelSide': 'left', 'itemType': 'number', 'values': [0, 2, 3],
     'origin': [-3.2, -3.8, 0], 'cellSize': 1.2, 'showIndices': True,
     'connectTo': {'object': 'left', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': GOLD}},
], [slider('shift', 'Shift', 0, 4, 0)]))

# 5 · Playback: a frontier sweeping a grid graph, nodes and edges coloured by expression, a walking marker.
scenes.append(scene('sweep', 'Sweep (expression colours, walking marker)', '''# Sweep

A 4 × 3 grid of points, each linked right and down (a list of two targets, `-1` where there is none). Move **step**: nodes the sweep has reached turn teal, the current one gold, the edges into reached nodes light up, and the **at** marker glides from node to node.''', [
    {'id': 'grid-graph', 'type': 'graph', 'label': 'grid', 'lengthExpr': '12', 'valueExpr': 'idx',
     'positionExpr': ['-3 + 2 * mod(idx, 4)', '2 - 2 * floor(idx / 4)', '0'], 'nodeShape': 'point', 'nodeSize': 0.55, 'valueLabel': 'none',
     'colorExpr': "idx == step ? '%s' : (idx < step ? '%s' : '')" % (GOLD, TEAL),
     'connectTo': {'indexExpr': '[mod(idx, 4) < 3 ? idx + 1 : -1, idx + 4 < 12 ? idx + 4 : -1]', 'pinned': True, 'arrow': True,
                   'color': GREY, 'bendExpr': '0', 'highlightExpr': 'to <= step', 'colorExpr': "to <= step ? '%s' : ''" % TEAL},
     'markers': [{'indexName': 'at', 'indexExpr': 'step', 'color': GOLD}]},
], [slider('step', 'Step', 0, 11, 0)], camera=cam(0, 0, 12)))

# 6 · A DAG laid out in layers (topological levels), revealed in topological order.
dag_nodes = ['fetch', 'parse', 'lint', 'types', 'build', 'test', 'ship']
dag_edges = {0: [1], 1: [2, 3], 2: [4], 3: [4, 5], 4: [6], 5: [6], 6: []}
layer = {0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 5: 3, 6: 4}
order = [0, 1, 2, 3, 4, 5, 6]
def layered(layers):
    pos = {}
    for L in sorted(set(layers.values())):
        members = [n for n in layers if layers[n] == L]
        for k, n in enumerate(members): pos[n] = (-5 + 2.5 * L, (len(members) - 1) * 0.9 - 1.8 * k)
    return pos
dpos = layered(layer)
scenes.append(scene('dag', 'DAG (layers, topological order)', """# Directed acyclic graph

A build pipeline as a **DAG**: every edge points to a later layer, so there is no way back. Nodes are blocks named by their task; positions come from each node's **layer** (its longest path from the start).

Move **done**: tasks are finished in topological order. A task can only run once every edge into it is lit; finished tasks turn teal, the next one gold.""", [
    {'id': 'dag', 'type': 'graph', 'label': 'pipeline', 'lengthExpr': str(len(dag_nodes)), 'valueExpr': "dataTable('dag', idx, 'name')",
     'positionExpr': ["dataTable('dag', idx, 'x')", "dataTable('dag', idx, 'y')", '0'],
     'nodeShape': 'rect', 'nodeWidth': 1.4, 'nodeHeight': 0.6, 'nodeCornerRadius': 0.12, 'showIndices': False,
     'colorExpr': "dataTable('dag', idx, 'order') < done ? '%s' : (dataTable('dag', idx, 'order') == done ? '%s' : '')" % (TEAL, GOLD),
     'connectTo': {'indexExpr': "dataTable('dag', idx, 'to')", 'pinned': True, 'arrow': True, 'color': GREY, 'bendExpr': '0',
                   'highlightExpr': "dataTable('dag', idx, 'order') < done"}},
], [slider('done', 'Tasks done', 0, 7, 0)], camera=cam(0, 0, 12),
    data={'dag': [{'name': n, 'x': dpos[i][0], 'y': round(dpos[i][1], 2), 'to': dag_edges[i], 'order': order.index(i)} for i, n in enumerate(dag_nodes)]}))

# 7 · A cyclic graph: two cycles sharing a node, a 2-cycle and a self-loop; the cycle through `start` lights up.
cyc_pos = [(-3.6, 1.6), (-1.2, 2.6), (-0.6, 0.2), (-2.6, -1.2), (1.8, 1.4), (3.4, -0.4), (1.4, -2.2), (4.6, 2.4)]
cyc_to = {0: [1], 1: [2], 2: [3, 4], 3: [0], 4: [5], 5: [6, 7], 6: [2], 7: [7]}
cycles = {'a': [0, 1, 2, 3], 'b': [2, 4, 5, 6]}
scenes.append(scene('cyclic', 'Cyclic graph (shared node, self-loop)', """# Cyclic graph

A directed graph with **cycles**: 0 → 1 → 2 → 3 → 0 and 2 → 4 → 5 → 6 → 2 share node 2, and node 7 points at itself. Edges bow apart (`edgeBend` 0.15) so the shared node stays readable.

Move **cycle**: 1 lights the left loop, 2 the right one; their nodes and edges glow. 0 shows the bare graph.""", [
    {'id': 'cyc', 'type': 'graph', 'label': 'cyclic', 'lengthExpr': '8', 'valueExpr': 'idx',
     'positionExpr': ["dataTable('cyc', idx, 'x')", "dataTable('cyc', idx, 'y')", '0'],
     'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False, 'edgeBend': 0.15,
     'highlightExpr': "(cycle == 1 and dataTable('cyc', idx, 'a') == 1) or (cycle == 2 and dataTable('cyc', idx, 'b') == 1)",
     'connectTo': {'indexExpr': "dataTable('cyc', idx, 'to')", 'pinned': True, 'arrow': True, 'color': BLUE,
                   'highlightExpr': "(cycle == 1 and dataTable('cyc', idx, 'a') == 1 and dataTable('cyc', to, 'a') == 1) or (cycle == 2 and dataTable('cyc', idx, 'b') == 1 and dataTable('cyc', to, 'b') == 1)",
                   'colorExpr': "cycle == 1 and dataTable('cyc', idx, 'a') == 1 and dataTable('cyc', to, 'a') == 1 ? '%s' : (cycle == 2 and dataTable('cyc', idx, 'b') == 1 and dataTable('cyc', to, 'b') == 1 ? '%s' : '')" % (GOLD, PINK)}},
], [slider('cycle', 'Cycle', 0, 2, 1)],
    data={'cyc': [{'x': x, 'y': y, 'to': cyc_to[i], 'a': int(i in cycles['a']), 'b': int(i in cycles['b'])} for i, (x, y) in enumerate(cyc_pos)]}))

# 8 · Trees: an n-ary tree of blocks, a BST with a search path, and a radial tree of points.
def tidy(children, root=0, dx=1.4, dy=1.5):
    """A simple tidy layout: leaves left to right, parents centred over their children."""
    pos, nxt = {}, [0.0]
    def walk(n, d):
        kids = children.get(n, [])
        for c in kids: walk(c, d + 1)
        if kids: x = (pos[kids[0]][0] + pos[kids[-1]][0]) / 2
        else: x = nxt[0]; nxt[0] += dx
        pos[n] = (x, -d * dy)
    walk(root, 0)
    xs = [p[0] for p in pos.values()]; mid = (min(xs) + max(xs)) / 2
    return {n: (round(x - mid, 2), round(y, 2)) for n, (x, y) in pos.items()}
nary = {0: [1, 2, 3], 1: [4, 5], 2: [6], 3: [7, 8, 9], 6: [10]}
nary_names = ['/', 'src', 'docs', 'tests', 'app', 'util', 'guide', 'a', 'b', 'c', 'img']
npos = tidy(nary, dx=1.45)
bst_vals = [50, 30, 70, 20, 40, 60, 80, 35, 45, 65]
bst_kids = {}
def bst_insert():
    left, right = {}, {}
    for i, v in enumerate(bst_vals[1:], start=1):
        n = 0
        while True:
            side = left if v < bst_vals[n] else right
            if n in side: n = side[n]
            else: side[n] = i; break
    return left, right
L, R = bst_insert()
for n in range(len(bst_vals)): bst_kids[n] = [k for k in (L.get(n), R.get(n)) if k is not None]
bpos = tidy(bst_kids, dx=1.1, dy=1.3)
def search_path(key):
    path, n = [], 0
    while n is not None:
        path.append(n)
        if bst_vals[n] == key: break
        n = (L if key < bst_vals[n] else R).get(n)
    return path
import math
radial = {0: [1, 2, 3, 4], 1: [5, 6], 2: [7], 3: [8, 9, 10], 4: [11]}
def radial_layout(children, r=1.7):
    leaves = []
    def collect(n):
        kids = children.get(n, [])
        if not kids: leaves.append(n)
        for c in kids: collect(c)
    collect(0)
    ang = {leaf: 2 * math.pi * k / len(leaves) for k, leaf in enumerate(leaves)}
    def fill(n):
        kids = children.get(n, [])
        for c in kids: fill(c)
        if kids: ang[n] = sum(ang[c] for c in kids) / len(kids)
    fill(0)
    depth = {0: 0}
    for n in sorted(children):
        for c in children[n]: depth[c] = depth[n] + 1
    return {n: (round(r * depth[n] * math.cos(ang[n]), 2), round(r * depth[n] * math.sin(ang[n]), 2)) for n in depth}
rpos = radial_layout(radial)
tree_rows = lambda pos, kids, extra=lambda i: {}: [{'x': pos[i][0], 'y': pos[i][1], 'to': kids.get(i, []), **extra(i)} for i in range(len(pos))]
scenes.append(scene('trees', 'Trees (n-ary, BST search, radial)', """# Trees

Three trees, three looks, one object type:

- **n-ary** (top): a folder tree of named blocks, parents centred over their children.
- **BST** (bottom left): circle nodes with their key inside. Move **key**: the search path from the root lights up, and the **at** marker sits where the search ends.
- **radial** (bottom right): points spreading out from the centre by depth.""", [
    {'id': 'nary', 'type': 'graph', 'label': 'files', 'lengthExpr': str(len(nary_names)), 'valueExpr': "dataTable('nary', idx, 'name')",
     'positionExpr': ["dataTable('nary', idx, 'x')", "dataTable('nary', idx, 'y') * 0.75 + 4.2", '0'],
     'nodeShape': 'rect', 'nodeWidth': 1.1, 'nodeHeight': 0.45, 'nodeCornerRadius': 0.08, 'showIndices': False,
     'connectTo': {'indexExpr': "dataTable('nary', idx, 'to')", 'pinned': True, 'arrow': False, 'color': GREY, 'bendExpr': '0'}},
    {'id': 'bst', 'type': 'graph', 'label': 'BST', 'lengthExpr': str(len(bst_vals)), 'valueExpr': "dataTable('bst', idx, 'key')",
     'positionExpr': ["dataTable('bst', idx, 'x') * 0.8 - 3.2", "dataTable('bst', idx, 'y') * 0.75 - 0.9", '0'],
     'nodeShape': 'rect', 'nodeWidth': 0.62, 'nodeHeight': 0.62, 'nodeCornerRadius': 0.31, 'showIndices': False,
     'highlightExpr': "dataTable('bst', idx, concat('p', key)) == 1",
     'connectTo': {'indexExpr': "dataTable('bst', idx, 'to')", 'pinned': True, 'arrow': True, 'color': GREY, 'bendExpr': '0',
                   'highlightExpr': "dataTable('bst', idx, concat('p', key)) == 1 and dataTable('bst', to, concat('p', key)) == 1"},
     'markers': [{'indexName': 'at', 'indexExpr': "dataTable('bst', 0, concat('end', key))", 'color': PINK}]},
    {'id': 'radial', 'type': 'graph', 'label': 'radial', 'lengthExpr': str(len(rpos)), 'valueExpr': 'idx',
     'positionExpr': ["dataTable('radial', idx, 'x') * 0.62 + 3.6", "dataTable('radial', idx, 'y') * 0.62 - 2.0", '0'],
     'nodeShape': 'point', 'nodeSize': 0.35, 'valueLabel': 'none', 'showIndices': False, 'colorExpr': "idx == 0 ? '%s' : ''" % GOLD,
     'connectTo': {'indexExpr': "dataTable('radial', idx, 'to')", 'pinned': True, 'arrow': False, 'color': TEAL, 'bendExpr': '0'}},
], [{'id': 'key', 'label': 'Search key', 'min': 0, 'max': 9, 'step': 1, 'default': 7}], camera=cam(0, 0.6, 15),
    data={
        'nary': [{**r, 'name': nary_names[i]} for i, r in enumerate(tree_rows(npos, nary))],
        # Each search key (by position in the key list) has its path as columns p<k>, and where it ends as end<k>.
        'bst': [{**r, 'key': bst_vals[i], **{f'p{k}': int(i in search_path(bst_vals[k])) for k in range(len(bst_vals))},
                 **({f'end{k}': search_path(bst_vals[k])[-1] for k in range(len(bst_vals))} if i == 0 else {})}
                for i, r in enumerate(tree_rows(bpos, bst_kids))],
        'radial': tree_rows(rpos, radial),
    }))

# 9 · A B-tree: cell-row nodes (nodeCellsExpr) whose child links start at the gaps between keys (fromPortExpr:
# "slot"), driven frame by frame by a recorded run of insertions with splits.
MAX_KEYS = 2   # order 3: a node holds at most two keys; a third splits it
class BNode:
    def __init__(self, keys=None, children=None): self.keys, self.children = keys or [], children or []
def bfs(root):
    out, queue = [], [root]
    while queue: n = queue.pop(0); out.append(n); queue.extend(n.children)
    return out
CELL, GAP, LEVEL = 0.7, 0.5, 1.6
def layout(root):
    """Leaves left to right by their width; each parent centred over its children; levels 1.6 apart."""
    pos, cursor = {}, [0.0]
    def walk(n, d):
        for c in n.children: walk(c, d + 1)
        width = max(1, len(n.keys)) * CELL
        if n.children: x = (pos[id(n.children[0])][0] + pos[id(n.children[-1])][0]) / 2
        else: x = cursor[0] + width / 2; cursor[0] += width + GAP
        pos[id(n)] = (x, -d * LEVEL)
    walk(root, 0)
    xs = [p[0] for p in pos.values()]; mid = (min(xs) + max(xs)) / 2
    return {k: (round(x - mid, 3), round(y + 2.6, 3)) for k, (x, y) in pos.items()}
bt_frames, bt_tables = [], {}
def snap(root, message, key, over=None):
    nodes = bfs(root); index = {id(n): i for i, n in enumerate(nodes)}; pos = layout(root)
    bt_tables[f'bt{len(bt_frames)}'] = [{'keys': n.keys, 'children': [index[id(c)] for c in n.children],
                                          'x': pos[id(n)][0], 'y': pos[id(n)][1], 'over': int(n is over)} for n in nodes]
    bt_frames.append({'n': len(nodes), 'key': key, 'message': message})
def insert(root, key):
    path, n = [], root
    while n.children:
        path.append(n); n = n.children[sum(k < key for k in n.keys)]
    n.keys = sorted(n.keys + [key])
    snap(root, f'Insert {key} into its leaf.' + (' It now holds three keys: too many.' if len(n.keys) > MAX_KEYS else ''), key, over=n if len(n.keys) > MAX_KEYS else None)
    while len(n.keys) > MAX_KEYS:
        mid = len(n.keys) // 2; up = n.keys[mid]
        left, right = BNode(n.keys[:mid], n.children[:mid + 1]), BNode(n.keys[mid + 1:], n.children[mid + 1:])
        if path:
            parent = path.pop(); at = parent.children.index(n)
            parent.children[at:at + 1] = [left, right]; parent.keys = sorted(parent.keys + [up])
            n = parent
        else:
            root = BNode([up], [left, right]); n = root
        snap(root, f'Split: {up} moves up, the halves become siblings.' + (' The parent now holds three keys: split again.' if len(n.keys) > MAX_KEYS else ''), key, over=n if len(n.keys) > MAX_KEYS else None)
    return root
root = BNode()
snap(root, 'An empty B-tree of order 3: each node holds at most two keys.', -1)
for k in [10, 20, 5, 6, 12, 30, 7, 17, 3, 25]:
    root = insert(root, k)
snap(root, 'Done: every leaf is at the same depth, and each node holds one or two keys.', -1)
bt = lambda col: f"dataTable(concat('bt', frame), idx, '{col}')"
btree = scene('btree', 'B-tree (cell-row nodes, ports, splits)', """# B-tree

A **B-tree of order 3** (at most two keys per node), built by inserting 10, 20, 5, 6, 12, 30, 7, 17, 3, 25.

Each node is a **row of key cells** (`nodeCellsExpr`), as wide as its keys. A node with k keys has k + 1 **ports**, under and between its keys, and child i starts at port i (`fromPortExpr: "slot"`), exactly between the keys that bound it.

Play **frame**: the key being inserted is gold. A node that overflows to three keys turns pink; it then **splits**, pushing its middle key up, and splits can climb to a new root. The tree grows at the top, so every leaf stays at the same depth.""", [
    {'id': 'btree', 'type': 'graph', 'label': 'B-tree', 'lengthExpr': "dataTable('frames', frame, 'n')", 'valueExpr': 'idx',
     'positionExpr': [bt('x'), bt('y'), '0'], 'nodeShape': 'rect', 'nodeHeight': 0.6, 'nodeCornerRadius': 0.1,
     'nodeCellsExpr': bt('keys'), 'nodeCellWidth': CELL, 'showIndices': False,
     'colorExpr': f"{bt('over')} == 1 ? '{PINK}' : ''",
     'cellHighlightExpr': "value == dataTable('frames', frame, 'key')",
     'connectTo': {'indexExpr': bt('children'), 'fromPortExpr': 'slot', 'pinned': True, 'arrow': True, 'color': GREY}},
], [slider('frame', 'Frame', 0, len(bt_frames) - 1, 0)], camera=cam(0, 0.8, 8.5), data={'frames': bt_frames, **bt_tables})
btree['steps'][0]['descriptionExpr'] = "dataTable('frames', frame, 'message')"
btree['stepPlayback'] = {'slider': 'frame', 'intervalMs': 1300}
scenes.append(btree)

# 10+ · treeLayout: the same graph object laid out as a tree from each node's parent (src/objects/tree-layout.ts).
def tree_scene(id, title, md, layout, values, parents, sides=None, sliders=None, camera=None, length=None, extra=None):
    rows = [{'v': v, 'p': p, **({'s': sides[i]} if sides else {})} for i, (v, p) in enumerate(zip(values, parents))]
    layout = {**layout, 'parentExpr': "dataTable('t', idx, 'p')", **({'sideExpr': "dataTable('t', idx, 's')"} if sides else {})}
    # Nodes come and go in index order with the slider n, and the layout re-runs on the nodes that exist.
    if sliders is None: sliders, length = [slider('n', 'Nodes n', 1, len(values), len(values))], 'n'
    g = {'id': id, 'type': 'graph', 'label': title.split(' (')[0], 'lengthExpr': length or str(len(values)), 'valueExpr': "dataTable('t', idx, 'v')",
         'treeLayout': layout, 'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'showIndices': False,
         'connectTo': {'indexExpr': "dataTable('t', idx, 'p')", 'pinned': True, 'bendExpr': '0', 'color': GREY}, **(extra or {})}
    scenes.append(scene(id, title, md, [g], sliders, camera, data={'t': rows}))

# One n-ary tree for tidy, radial and the growing tree: node i's parent is parents[i].
nary_v = list('ABCDEFGHIJKL'); nary_p = [-1, 0, 0, 0, 1, 1, 2, 3, 3, 3, 7, 7]
tree_scene('layout-tidy', 'Tidy tree (n-ary)', """# Tidy tree

`treeLayout: {type: "tidy", parentExpr}` lays any tree out from each node's parent: **leaves evenly spaced** in depth-first order, **each parent centred over its children**, one row per depth. No `positionExpr`.

The edges are the same parent relation, drawn by `connectTo` (`indexExpr` = the parent).

Move **n** to add or remove nodes: the layout runs on the nodes that exist, so a new leaf pushes its siblings apart and recentres their parents, and removing it pulls them back. Every tree scene below has the same slider.""",
    {'type': 'tidy', 'origin': [0, 3, 0], 'spacing': 1.1, 'levelGap': 1.6}, nary_v, nary_p)

# A binary search tree, built by inserting in this order: each node knows its parent and its side.
bst_order = [50, 30, 70, 20, 40, 60, 80, 35, 45, 65, 85, 10]
bst_p, bst_s = [-1], [0]
for i, v in enumerate(bst_order[1:], 1):
    at = 0
    while True:
        side = 1 if v > bst_order[at] else 0
        child = next((j for j in range(i) if bst_p[j] == at and bst_s[j] == side and j != 0), None)
        if child is None: bst_p.append(at); bst_s.append(side); break
        at = child
tree_scene('layout-binary', 'Binary search tree (inorder layout)', """# Binary search tree

`type: "binary"` with `sideExpr` (0 left, 1 right): nodes go **left to right in inorder**, so every left subtree sits left of its parent and reading the tree left to right gives the keys **sorted**: 10, 20, 30 … 85.

Built by inserting 50, 30, 70, 20, 40, 60, 80, 35, 45, 65, 85, 10. A lone right child (65 under 60) still hangs to the right.""",
    {'type': 'binary', 'origin': [0, 3, 0], 'spacing': 0.95, 'levelGap': 1.6}, bst_order, bst_p, bst_s)

tree_scene('layout-complete', 'Complete tree (heap slots)', """# Complete tree

`type: "complete"` ignores parents: slot i sits where a heap keeps it, level ⌊log₂(i + 1)⌋ spread evenly across `width`. It is what the `heap` element uses for its tree. Move **n** to fill the tree level by level.""",
    {'type': 'complete', 'origin': [0, 3, 0], 'width': 11, 'levelGap': 1.6}, [3, 7, 9, 12, 8, 10, 14, 20, 15, 11, 9, 16, 13, 18, 21],
    [-1] + [(i - 1) // 2 for i in range(1, 15)])

tree_scene('layout-radial', 'Radial tree', """# Radial tree

`type: "radial"`: the root at the centre (`origin`), each depth on its own ring `levelGap` further out, leaves spread evenly round the circle. Good for wide, shallow trees that would run off the side as rows.""",
    {'type': 'radial', 'origin': [0, 0, 0], 'levelGap': 1.7}, nary_v, nary_p)

files = [('src', -1), ('objects', 0), ('graph.ts', 1), ('array.ts', 1), ('heap.ts', 1), ('labels.ts', 0), ('tests', -1), ('graph.test.ts', 6), ('heap.test.ts', 6)]
tree_scene('layout-indented', 'Indented tree (outline, a forest)', """# Indented tree

`type: "indented"`: an outline, one row per node in **preorder**, indented by depth: a file tree. `src` and `tests` are both roots (parent −1), so this is a **forest**: their outlines follow one another.""",
    {'type': 'indented', 'origin': [-3, 3.5, 0], 'spacing': 1.3, 'levelGap': 0.9}, [f for f, _ in files], [p for _, p in files],
    extra={'nodeShape': 'rect', 'nodeWidth': 2.2, 'nodeHeight': 0.6, 'nodeCornerRadius': 0.12, 'connectTo': {'indexExpr': "dataTable('t', idx, 'p')", 'pinned': True, 'bendExpr': '0', 'color': GREY}})

# A union-find parent array: a root is its own parent, so parentExpr maps it to -1.
uf = [0, 0, 1, 3, 3, 5, 5, 6, 3]
tree_scene('layout-forest', 'Forest (union-find parents)', """# Forest

Union-find stores a **parent array** where a root is its own parent. `parentExpr: "p == idx ? -1 : p"` turns those into roots, and `type: "tidy"` lays the **three trees side by side**, each tidy on its own. The node shows its index; the edge goes to its parent.""",
    {'type': 'tidy', 'origin': [0, 2.5, 0], 'spacing': 1.2, 'levelGap': 1.6}, list(range(len(uf))), [-1 if p == i else p for i, p in enumerate(uf)])

# A trie, a word at a time: nodes are numbered as they are created, so the first k words own a prefix of them.
trie_words = ['car', 'cat', 'cart', 'care', 'dog', 'do', 'dot', 'cab']
trie_v, trie_p, trie_end, made_after = [''], [-1], [0], []
kids = {0: {}}
for w in trie_words:
    at = 0
    for ch in w:
        if ch not in kids[at]:
            kids[at][ch] = len(trie_v); kids[len(trie_v)] = {}; trie_v.append(ch); trie_p.append(at); trie_end.append(0)
        at = kids[at][ch]
    trie_end[at] = trie_end[at] or len(made_after) + 1   # the word number that first ends here
    made_after.append(len(trie_v))
tree_scene('layout-trie', 'Trie (words added and removed)', """# Trie

A trie built from **car, cat, cart, care, dog, do, dot, cab**: a `tidy` tree whose nodes are letters. Nodes are numbered as they are created, so the first k words own the first nodes, and **words** adds or removes whole words: their new nodes appear or vanish, and the tree re-lays itself.

Teal nodes end a word among those inserted ("do" ends inside "dog").""",
    {'type': 'tidy', 'origin': [0, 3.4, 0], 'spacing': 1.0, 'levelGap': 1.4}, trie_v, trie_p,
    sliders=[slider('words', 'Words inserted', 0, len(trie_words), len(trie_words))],
    length=f"words == 0 ? 1 : arrayAt({made_after}, words - 1)",
    extra={'colorExpr': f"dataTable('t', idx, 'end') > 0 and dataTable('t', idx, 'end') <= words ? '{TEAL}' : ''"})
scenes[-1]['data']['t'] = [{**r, 'end': e} for r, e in zip(scenes[-1]['data']['t'], trie_end)]

# Every scene: an overlay listing each graph's important properties, so what a scene exercises is visible at a
# glance. Long expressions are shortened; the node count is live when it is an expression.
def short(v, n=34):
    t = v if isinstance(v, str) else json.dumps(v)
    return t if len(t) <= n else t[:n - 1] + '…'
def graph_props(g):
    rows = [('shape', g.get('nodeShape', 'point') + (' (cells)' if 'nodeCellsExpr' in g else ''))]
    if 'treeLayout' in g:
        t = g['treeLayout']
        rows.append(('layout', f"treeLayout · {t['type']}"))
        rows += [(k, short(t[k])) for k in ('parentExpr', 'sideExpr', 'origin', 'spacing', 'levelGap', 'width') if k in t]
    else:
        rows.append(('layout', 'positionExpr'))
        rows += [(a, short(e)) for a, e in zip('xy', g.get('positionExpr', []))]
    count = g.get('lengthExpr')
    rows.append(('nodes', f'{{{{{count}}}}}' if count and not count.isdigit() else str(count or len(g.get('values', [])))))
    for c in (g['connectTo'] if isinstance(g.get('connectTo'), list) else [g['connectTo']] if g.get('connectTo') else []):
        feats = [f for f, on in (('arrow', c.get('arrow')), ('straight', c.get('bendExpr') == '0'), ('arcs', 'arcCenterExpr' in c),
                                 ('ports', 'fromPortExpr' in c), ('lit', 'highlightExpr' in c)) if on]
        rows.append(('edges → ' + c.get('object', 'self'), short(c['indexExpr']) + (f" · {', '.join(feats)}" if feats else '')))
    if 'edgeBend' in g: rows.append(('edgeBend', str(g['edgeBend'])))
    if 'markers' in g: rows.append(('markers', ', '.join(m['indexName'] for m in g['markers'])))
    return rows
for sc in scenes:
    step = sc['steps'][0]
    graphs = [e for e in step['add'] if e.get('type') == 'graph']
    if not graphs: continue
    md = '\n\n'.join(f"**{g.get('label', g['id'])}**\n\n| property | value |\n| --- | --- |\n" + '\n'.join(f'| {k} | `{v}` |' if k != 'nodes' else f'| {k} | {v} |' for k, v in graph_props(g)) for g in graphs)
    step['info'] = [{'id': f"{sc['id']}-props", 'title': 'Graph properties', 'position': 'top-left', 'content': md}]

lesson = {'title': 'Graph object · test scenes', 'scenes': scenes}
out = ROOT / 'scenes/draft/test-graph.json'
out.write_text(dumps_compact_leaves(lesson) + '\n')
print('wrote', out, len(scenes), 'scenes')
