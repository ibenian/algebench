"""Write scenes/draft/graph-algorithms.json: graph algorithms for coding interviews. An index scene (a clickable
map of every algorithm, most important first) and one scene per algorithm, each a placeholder until it gets its
visualization.

Run: ./run.sh scripts/lesson_builders/graph-algorithms/build.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from _json_format import dumps_compact_leaves  # noqa: E402

GOLD, BLUE, GREY = '#f1c65b', '#9dbde3', '#7f93aa'
RANGE = [[-7, 10], [-5, 5], [-2, 2]]
grid = {'id': 'grid', 'type': 'grid', 'plane': 'xy', 'range': [[-7, 10], [-5, 5]], 'divisions': [17, 10], 'opacity': 0.09}
cam = {'position': [1.5, 0, 15], 'target': [1.5, 0, 0]}

# In learning order: each algorithm comes after everything it builds on (builds: scene ids), simplest first.
# tier is its interview importance, shown as colour: 0 core (expect it), 1 common, 2 advanced (rare, senior or
# specialist rounds). Each: id, short name, title, tier, builds on, signal, idea, cost, practice.
ALGORITHMS = [
    ("representations", "Representations", "Store a graph (adjacency list, matrix, edge list)", 0, [],
     "any graph problem: the first decision is how to hold the edges.",
     "An **adjacency list** maps each node to its neighbours: compact for sparse graphs and the default in interviews. An **adjacency matrix** answers \"is there an edge?\" in O(1) but costs O(V²) space. An **edge list** suits algorithms that sort or scan edges (Kruskal, Bellman-Ford). Many problems hand you edges or a grid; building the list is step one.",
     "Build: O(V + E) for a list, O(V²) for a matrix.",
     ["Find if Path Exists in Graph", "Clone Graph", "Find the Town Judge"]),
    ("dfs", "DFS", "Go deep first (depth-first search)", 0, ["representations"],
     "explore everything reachable, count components, find any path, or anything that backtracks.",
     "Follow one path as far as it goes, then back up and try the next branch, with recursion or an explicit stack. Mark nodes visited so cycles do not loop forever. DFS is the engine under cycle detection, topological sort, components, bridges and strongly connected components.",
     "O(V + E) time, O(V) space for the visited set and the recursion stack.",
     ["Number of Connected Components", "Clone Graph", "All Paths From Source to Target", "Keys and Rooms"]),
    ("bfs", "BFS", "Level by level (breadth-first search)", 0, ["representations"],
     "shortest path in steps on an unweighted graph, \"minimum moves\", nearest X, or anything level by level.",
     "A queue visits nodes in order of distance from the start: all nodes one step away, then two, and so on. Mark a node visited when it is **enqueued**, not when it is dequeued, or it is queued twice. The first time BFS reaches a node is along a shortest path. **Multi-source BFS** starts with every source in the queue (rotting oranges, distance to the nearest gate).",
     "O(V + E) time, O(V) space for the queue and the visited set.",
     ["Word Ladder", "Rotting Oranges", "Shortest Path in Binary Matrix", "Open the Lock"]),
    ("degrees", "Count degrees", "Count degrees (in, out, and peeling)", 0, ["representations"],
     "a node defined by how many edges touch it (\"trusted by everyone\", \"the centre\"), sources and sinks, or peeling a graph layer by layer.",
     "One pass over the edges counts each node's **in-degree** and **out-degree**, with no traversal. Sometimes the counts are the answer: the town judge has in-degree n − 1 and out-degree 0; nodes nothing points at (in-degree 0) are the ones every search must start from. Degrees also prove shape: they sum to 2E, a tree has V − 1 edges, and an Euler path needs balanced degrees. **Peeling** repeatedly removes the nodes whose degree hits a threshold: leaves (degree 1) layer by layer find a tree's centre, and nodes with in-degree 0 give Kahn's topological sort.",
     "O(V + E) to count; peeling is O(V + E) too.",
     ["Find the Town Judge", "Find Center of Star Graph", "Minimum Number of Vertices to Reach All Nodes", "Maximal Network Rank", "Minimum Height Trees"]),
    ("grid-graphs", "Grid graphs", "A grid is a graph (islands, flood fill)", 0, ["bfs", "dfs"],
     "a 2D grid of cells with moves up, down, left and right.",
     "Each cell is a node and each allowed move an edge, so BFS and DFS work unchanged; no adjacency list is needed, just the four direction offsets and a bounds check. Mark cells visited in place or in a set. Counting islands is counting connected components.",
     "O(rows × cols) time and space.",
     ["Number of Islands", "Max Area of Island", "Flood Fill", "Pacific Atlantic Water Flow", "Surrounded Regions"]),
    ("cycle-detection", "Cycle detection", "Is there a cycle?", 0, ["dfs", "degrees"],
     "can every task finish, is the graph a tree, deadlock, or a \"redundant\" edge.",
     "**Directed:** DFS with three colours: white (new), grey (on the current path), black (done); reaching a grey node is a cycle. **Undirected:** DFS that ignores the edge back to its parent, or union-find: an edge whose ends are already connected closes a cycle. A graph is a tree exactly when it is connected and has V − 1 edges.",
     "O(V + E).",
     ["Course Schedule", "Graph Valid Tree", "Redundant Connection", "Find Eventual Safe States"]),
    ("bipartite", "Bipartite check", "Two teams (bipartite check)", 1, ["bfs", "dfs"],
     "split into two groups with every edge between groups, two-colouring, \"possible bipartition\".",
     "Colour the start node, then colour each neighbour the opposite colour with BFS or DFS. A neighbour that already has the same colour is an odd cycle: not bipartite. Run it from every uncoloured node, since the graph may be disconnected.",
     "O(V + E).",
     ["Is Graph Bipartite?", "Possible Bipartition"]),
    ("topological-sort", "Topo sort (Kahn / DFS)", "Order by dependencies (topological sort)", 0, ["degrees", "bfs", "dfs", "cycle-detection"],
     "prerequisites, build order, task scheduling: \"in what order can everything run?\"",
     "**Kahn's algorithm** counts in-degrees and repeatedly takes a node that waits on nothing. **DFS** appends a node after everything that depends on it and reverses the list. Both detect a cycle: Kahn by leftover nodes, DFS by meeting a node still on its path. The common algorithm patterns lesson plays both step by step.",
     "O(V + E).",
     ["Course Schedule II", "Alien Dictionary", "Parallel Courses", "Minimum Height Trees"]),
    ("union-find", "Union-find", "Group as edges arrive (union-find)", 0, ["representations"],
     "connectivity that grows edge by edge, counting groups, \"are these two connected?\", merging accounts.",
     "Each node points to a parent; following parents reaches the group's root. **Union** links one root under another; **find** returns the root. With path compression and union by rank both are almost O(1). It answers connectivity questions without traversing the graph again after each edge.",
     "About O(α(n)) per operation: effectively constant.",
     ["Number of Provinces", "Redundant Connection", "Accounts Merge", "Number of Connected Components"]),
    ("mst", "Kruskal / Prim", "Connect everything cheaply (minimum spanning tree)", 1, ["union-find"],
     "connect all points or cities at the lowest total cost.",
     "**Kruskal** sorts edges by weight and adds each one that does not close a cycle (union-find tells). **Prim** grows one tree from a start node, always adding the cheapest edge that leaves it (a min-heap). Both are greedy and both are correct because the cheapest edge across any cut is safe.",
     "Kruskal O(E log E); Prim O(E log V).",
     ["Min Cost to Connect All Points", "Connecting Cities With Minimum Cost"]),
    ("dijkstra", "Dijkstra", "Cheapest route (Dijkstra)", 1, ["bfs"],
     "shortest or cheapest path when edges have non-negative weights.",
     "A **min-heap** of (distance, node) always pops the closest unsettled node, which is then final; relaxing its edges may improve its neighbours. It is BFS with a priority queue instead of a plain queue. Skip stale heap entries whose distance is worse than the one recorded. Negative edges break it.",
     "O((V + E) log V) with a binary heap.",
     ["Network Delay Time", "Path with Minimum Effort", "Cheapest Flights Within K Stops", "Swim in Rising Water"]),
    ("zero-one-bfs", "0-1 BFS", "Weights of 0 or 1 (0-1 BFS)", 1, ["dijkstra"],
     "shortest path where every edge costs 0 or 1: free moves and paid moves.",
     "A deque replaces the heap: push a node reached by a 0-edge to the **front** and one reached by a 1-edge to the **back**. The deque stays sorted by distance, so it is Dijkstra without the log factor.",
     "O(V + E).",
     ["Minimum Cost to Make at Least One Valid Path", "Minimum Obstacle Removal"]),
    ("a-star", "A*", "Guided search (A*)", 2, ["dijkstra"],
     "shortest path with a good estimate of the remaining distance, such as grid pathfinding.",
     "Dijkstra ordered by distance so far **plus** a heuristic estimate of the distance left. With an admissible heuristic (never overestimating, like Manhattan distance on a grid) the first time the goal is popped is optimal, and far fewer nodes are explored.",
     "Same worst case as Dijkstra; usually much faster.",
     ["Shortest Path in a Grid with Obstacles Elimination", "Sliding Puzzle"]),
    ("bellman-ford", "Bellman-Ford", "Negative edges (Bellman-Ford)", 1, ["dijkstra"],
     "weights can be negative, at most k edges, or \"detect a negative cycle\".",
     "Relax every edge V − 1 times; after round i, every shortest path that uses at most i edges is found. If a round V still improves something, there is a negative cycle. Limiting the rounds to k (relaxing from a copy of the last round's distances) gives \"cheapest with at most k stops\".",
     "O(V · E).",
     ["Cheapest Flights Within K Stops", "Network Delay Time"]),
    ("floyd-warshall", "Floyd-Warshall", "Every pair at once (Floyd-Warshall)", 2, ["bellman-ford"],
     "shortest distances between every pair of nodes, on a small graph.",
     "Dynamic programming over intermediate nodes: for each k, allow paths through node k and update dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j]). Three nested loops, k outermost.",
     "O(V³) time, O(V²) space.",
     ["Find the City With the Smallest Number of Neighbors at a Threshold Distance", "Course Schedule IV"]),
    ("bridges", "Bridges", "Critical edges (bridges and articulation points)", 2, ["dfs"],
     "edges or nodes whose removal disconnects the graph: \"critical connections\".",
     "One DFS records each node's discovery time and **low-link**, the earliest time reachable from its subtree with one back edge. Edge (u, v) is a bridge when low[v] > disc[u]: nothing below v climbs back above u.",
     "O(V + E).",
     ["Critical Connections in a Network"]),
    ("scc", "Kosaraju / Tarjan", "Mutual reachability (strongly connected components)", 2, ["dfs", "bridges"],
     "groups where every node reaches every other in a directed graph; condensing a graph into a DAG.",
     "**Kosaraju:** DFS for finish order, reverse the edges, then DFS in reverse finish order; each search is one component. **Tarjan:** one DFS with discovery times and low-links; a node whose low-link equals its own time roots a component.",
     "O(V + E).",
     ["Critical Connections in a Network (related)", "Count the Number of Complete Components"]),
    ("euler-path", "Euler path (Hierholzer)", "Use every edge once (Hierholzer)", 2, ["degrees", "dfs"],
     "use every edge exactly once: itineraries, domino chains, \"valid arrangement of pairs\".",
     "A path exists when at most one node has out-degree − in-degree = 1 (the start) and one has −1 (the end). **Hierholzer:** walk unused edges until stuck, append the stuck node, then back up; reverse at the end.",
     "O(E).",
     ["Reconstruct Itinerary", "Valid Arrangement of Pairs"]),
    ("max-flow", "Max flow (Edmonds-Karp)", "Push as much as fits (max flow, matching)", 2, ["bfs"],
     "capacities on edges, assignments, bipartite matching.",
     "Repeatedly find a path from source to sink with spare capacity in the **residual graph** (BFS: Edmonds-Karp) and push flow along it. Max flow equals min cut. Bipartite matching is max flow with unit capacities. Rare in interviews; worth recognizing.",
     "Edmonds-Karp O(V · E²).",
     ["Maximum Students Taking Exam (matching)"]),
]
TIERS = [('Core', GOLD, 'expect these'), ('Common', BLUE, 'often asked'), ('Advanced', GREY, 'rare; worth recognizing')]

scenes = []

# ── Index: every algorithm as a node, in importance order, three columns; a click opens its scene ──
cols, rows = 3, (len(ALGORITHMS) + 2) // 3
index_rows = [{'id': a[0], 'name': f'{i + 1}. {a[1]}', 'tier': a[3],
               'x': -4.6 + (i // rows) * 6.1, 'y': 4.1 - (i % rows) * 1.35} for i, a in enumerate(ALGORITHMS)]
SHORT = {a[0]: a[1] for a in ALGORITHMS}
builds = lambda a: ', '.join(SHORT[b] for b in a[4]) or '—'
table = '\n'.join(f'| {i + 1} | {a[2]} | {TIERS[a[3]][0]} | {builds(a)} | {a[5][0].upper() + a[5][1:]} | {a[7]} |' for i, a in enumerate(ALGORITHMS))
scenes.append({
    'id': 'index', 'title': 'Graph algorithms: where to start', 'description': 'Every graph algorithm in this lesson, in learning order.',
    'range': RANGE, 'camera': cam, 'data': {'index': index_rows},
    'markdown': f"""# Graph algorithms

Graphs show up in interviews as networks, dependencies, grids, maps and social connections, often in disguise. Most problems need only a handful of algorithms; the rest are worth recognizing.

The map lists them **in learning order**: each one builds on those before it, so read down the columns. Colour shows how often interviews ask for it: **gold** core (expect these), **blue** common, **grey** advanced (worth recognizing). Click one to open it.

| # | Algorithm | Tier | Builds on | Signal | Cost |
| --- | --- | --- | --- | --- | --- |
{table}

Each scene starts with the signal to look for and the idea; visualizations are being added one by one.""",
    'prompt': 'Help the learner choose where to start among these graph algorithms, and how to recognize which one a problem needs.',
    'elements': [grid],
    'steps': [{
        'id': 'map', 'title': 'The map', 'description': 'Click an algorithm to open it.',
        'add': [{
            'id': 'algorithms', 'type': 'graph', 'label': 'graph algorithms', 'lengthExpr': str(len(ALGORITHMS)),
            'valueExpr': "dataTable('index', idx, 'name')", 'itemType': 'string',
            'positionExpr': ["dataTable('index', idx, 'x')", "dataTable('index', idx, 'y')", '0'],
            'nodeShape': 'rect', 'nodeWidth': 5.4, 'nodeHeight': 1.05, 'nodeCornerRadius': 0.25, 'valueLabel': 'inside',
            'showIndices': False, 'axisLabels': 'plane',
            'colorExpr': f"dataTable('index', idx, 'tier') == 0 ? '{GOLD}' : (dataTable('index', idx, 'tier') == 1 ? '{BLUE}' : '{GREY}')",
            'onClick': [{'action': 'goToScene', 'sceneExpr': "dataTable('index', idx, 'id')"}],
        }],
    }],
})

# ── Recorded runs: each scene plays a trace (one frame per executed line) with the Code panel following it ──
def recorder(state):
    """emit(line, message) appends a frame: a copy of the state with the line and the message."""
    trace = []
    def emit(line, message):
        trace.append({**{k: (list(v) if isinstance(v, list) else v) for k, v in state.items()}, 'line': line, 'message': message})
    return trace, emit


def line_of(source, text):
    """The 1-based line of source holding text, so traces never hard-code line numbers."""
    return next(i + 1 for i, l in enumerate(source.split('\n')) if text in l)


tr = lambda col: f"dataTable('trace', frame, '{col}')"
label = lambda id, text, connect=None, line=None, file=None: {
    'id': id, 'type': 'expression_label', 'position': [7.6, -3.7, 0], 'textExpr': text,
    **({'connectTo': {'object': connect[0], 'indexExpr': connect[1]}} if connect else {}),
    **({'codeRef': {'file': file, 'line': line}} if line else {})}


def run_scene(id, title, header, markdown, prompt, file, source, trace, elements, data=None, call_entry=None):
    """A scene that plays one recorded run: the frame slider, a caption from each frame's message, and the Code
    panel on the executing line (codeRef), with each line linked back to its frames."""
    codeFiles.append({'id': id, 'path': f'graphs/{file}', 'language': 'python', 'source': source,
                      'locations': [{'line': f['line'], 'scene': id, 'step': 'run', 'snapshot': k, 'label': f"{title} · {f['message']}"}
                                    for k, f in enumerate(trace)]})
    return {
        'id': id, 'title': title, 'description': trace[0]['message'], 'range': RANGE, 'camera': cam,
        'data': {'trace': trace, **(data or {})}, 'markdown': f'# {title}\n\n{header}\n\n{markdown}', 'prompt': prompt,
        'elements': [grid],
        'steps': [{'id': 'run', 'title': 'Run it', 'description': 'Step through the run.', 'descriptionExpr': tr('message'),
                   'sliders': [{'id': 'frame', 'label': 'Execution state', 'min': 0, 'max': len(trace) - 1, 'step': 1, 'default': 0}],
                   'add': elements}],
        'stepPlayback': {'slider': 'frame', 'intervalMs': 1200},
        # call_entry: a recursive run's function line; the trace's calls column lists the waiting call sites.
        'codeRef': {'file': id, 'lineExpr': tr('line'), **({'callsExpr': tr('calls'), 'callEntryLine': call_entry} if call_entry else {})},
    }


# ── 1. Representations: one graph built into an adjacency list and an adjacency matrix, edge by edge ──
REPR_SOURCE = """def build(n, edges):
    adj = [[] for _ in range(n)]
    matrix = [[0] * n for _ in range(n)]
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
        matrix[u][v] = matrix[v][u] = 1
    return adj, matrix"""
REPR_N, REPR_EDGES = 5, [(0, 1), (0, 2), (1, 2), (1, 3), (2, 4), (3, 4)]


def representations_trace(n, edges):
    """Per frame: k, the edge being added (−1 none), u and v its ends; adj0 … adj{n−1}, each node's neighbour list
    so far; m, the matrix flattened row by row; lit, the matrix cells just set (row * n + col)."""
    L = lambda t: line_of(REPR_SOURCE, t)
    state = {'k': -1, 'u': -1, 'v': -1, **{f'adj{i}': [] for i in range(n)}, 'm': [0] * (n * n), 'lit': [], 'hasMatrix': 0}
    trace, emit = recorder(state)
    emit(L('adj = '), f'{n} nodes: one empty neighbour list per node.')
    state['hasMatrix'] = 1
    emit(L('matrix = '), f'An {n} × {n} matrix of zeros: one cell per possible edge, {n * n} cells whatever the graph.')
    for k, (u, v) in enumerate(edges):
        state.update(k=k, u=u, v=v, lit=[])
        emit(L('for u, v in edges'), f'Edge {k}: ({u}, {v}).')
        state[f'adj{u}'] = state[f'adj{u}'] + [v]
        emit(L('adj[u].append(v)'), f'{v} is a neighbour of {u}: adj[{u}] = {state[f"adj{u}"]}.')
        state[f'adj{v}'] = state[f'adj{v}'] + [u]
        emit(L('adj[v].append(u)'), f'Undirected, so {u} is a neighbour of {v} too: adj[{v}] = {state[f"adj{v}"]}. Each edge is stored twice.')
        state['m'] = [1 if c in (u * n + v, v * n + u) else x for c, x in enumerate(state['m'])]
        state['lit'] = [u * n + v, v * n + u]
        emit(L('matrix[u][v]'), f'matrix[{u}][{v}] = matrix[{v}][{u}] = 1: the matrix is symmetric for an undirected graph.')
    state.update(k=-1, u=-1, v=-1, lit=[])
    e = len(edges)
    emit(L('return adj, matrix'), f'Done. The list holds 2E = {2 * e} entries for {e} edges; the matrix always holds V² = {n * n} cells.')
    return trace


def representations_scene(header):
    n, edges = REPR_N, REPR_EDGES
    trace = representations_trace(n, edges)
    L = lambda t: line_of(REPR_SOURCE, t)
    import math
    pos = [(-4.4 + 1.9 * math.cos(math.pi / 2 + 2 * math.pi * i / n), 2.0 + 1.9 * math.sin(math.pi / 2 + 2 * math.pi * i / n)) for i in range(n)]
    current = f"(idx == {tr('u')} and to == {tr('v')}) or (idx == {tr('v')} and to == {tr('u')})"
    edge_text = [f'({u}, {v})' for u, v in edges]
    elements = [
        # The graph as drawn: each node's edges are its neighbour list so far; the edge being added is lit.
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(n), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('nodes', idx, 'x')", "dataTable('nodes', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         'colorExpr': f"idx == {tr('u')} or idx == {tr('v')} ? '{GOLD}' : ''",
         'connectTo': {'indexExpr': f"dataTable('trace', frame, concat('adj', idx))", 'pinned': True, 'bendExpr': '0', 'color': '#7f93aa',
                       'colorExpr': f"{current} ? '{GOLD}' : ''", 'highlightExpr': current}},
        # The input: the edge list, with the edge being read marked.
        {'id': 'edges', 'type': 'array', 'label': 'edges', 'labelSide': 'left', 'itemType': 'text', 'values': edge_text,
         'origin': [-5.2, -3.0, 0], 'cellSize': 1.35, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'highlightExpr': f"idx == {tr('k')}",
         'markers': [{'type': 'step_marker', 'indexName': 'k', 'indexExpr': tr('k'), 'visibleExpr': f"{tr('k')} >= 0", 'color': GOLD}]},
        # adj: one neighbour list per node, as Python holds it: adj[u] is a list.
        *[{'id': f'adj-{i}', 'type': 'array', 'label': f'adj[{i}]', 'labelSide': 'left', 'origin': [1.9, 3.7 - 1.05 * i, 0],
           'cellSize': 1.0, 'fontSize': 15, 'indexFontSize': 9, 'axisLabels': 'plane',
           'lengthExpr': f"arrayCount({tr(f'adj{i}')})", 'valueExpr': f"arrayAt({tr(f'adj{i}')}, idx)",
           # The neighbour just appended to this list.
           'highlightExpr': f"idx == arrayCount({tr(f'adj{i}')}) - 1 and (({i} == {tr('u')} and {tr('line')} == {L('adj[u].append(v)')}) or ({i} == {tr('v')} and {tr('line')} == {L('adj[v].append(u)')}))"}
          for i in range(n)],
        # matrix: cell (u, v) is 1 when there is an edge; the two cells just set are lit.
        {'id': 'matrix', 'type': 'tensor', 'label': 'matrix', 'shape': [n, n], 'origin': [6.6, 0.4, 0], 'cellSize': 0.9,
         'shader': {'ignorePlaneOpacity': True},
         # 0 no edge, 1 an edge, 2 an edge just set (lit).
         'valueExpr': f"arrayAt({tr('m')}, row * {n} + col) == 0 ? 0 : (keyIndex({tr('lit')}, row * {n} + col) >= 0 ? 2 : 1)",
         'visibleExpr': f"{tr('hasMatrix')} == 1",
         'textExpr': f"arrayAt({tr('m')}, row * {n} + col)",
         'colorMap': {'stops': [{'t': 0, 'color': '#2a3644'}, {'t': 0.5, 'color': BLUE}, {'t': 1, 'color': GOLD}]}, 'colorDomain': [0, 2],
         'axes': [{'labels': [str(i) for i in range(n)], 'title': 'u'}, {'labels': [str(i) for i in range(n)], 'title': 'v'}]},
        label('u', f"{tr('u')} < 0 ? 'u: —' : concat('u = ', {tr('u')})", ['graph', tr('u')], L('for u, v in edges'), 'representations'),
        label('v', f"{tr('v')} < 0 ? 'v: —' : concat('v = ', {tr('v')})", ['graph', tr('v')], L('for u, v in edges'), 'representations'),
    ]
    return run_scene('representations', 'Store a graph (adjacency list, matrix, edge list)', header, f"""**Signal:** any graph problem: the first decision is how to hold the edges.

Problems usually hand you an **edge list**: pairs `(u, v)`, one per connection. It is easy to store but slow to ask "who are `u`'s neighbours?", so step one is almost always to build one of these:

- **Adjacency list** (`adj[u]` = the neighbours of `u`): space O(V + E), and listing a node's neighbours costs exactly as many steps as it has. The default for interviews, since most graphs are sparse.
- **Adjacency matrix** (`matrix[u][v]` = 1 for an edge): "is there an edge?" in O(1), but O(V²) space and O(V) to list neighbours, however few there are. Fine for small, dense graphs.

The run builds both from the edge list, one edge at a time. The graph is **undirected**, so each edge goes into two lists (`adj[u]` and `adj[v]`) and two matrix cells, which is why the matrix is symmetric. For a directed graph, drop the second line: store `u → v` only.

| | Edge list | Adjacency list | Adjacency matrix |
| --- | --- | --- | --- |
| Space | O(E) | O(V + E) | O(V²) |
| Neighbours of u | O(E) | O(deg u) | O(V) |
| Is (u, v) an edge? | O(E) | O(deg u) | O(1) |
| Best for | scanning or sorting edges | traversals (BFS, DFS) | dense graphs, quick edge checks |

Use the execution player to step through, or open **Code** to follow the active line.

**Practice:** Find if Path Exists in Graph, Clone Graph, Find the Town Judge.""",
        'Explain why problems give an edge list but algorithms want an adjacency list, and when a matrix wins. Ask the learner to predict which lists and cells change before each edge is added.',
        'build_graph.py', REPR_SOURCE, trace, elements,
        data={'nodes': [{'x': round(x, 3), 'y': round(y, 3)} for x, y in pos]})


# ── 2. DFS: go deep first, recursively, on an undirected graph with a cycle ──
DFS_SOURCE = """def dfs_order(n, adj):
    visited = [False] * n
    order = []

    def dfs(u):
        visited[u] = True
        order.append(u)
        for v in adj[u]:
            if not visited[v]:
                dfs(v)

    dfs(0)
    return order"""
DFS_N, DFS_EDGES = 6, [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4), (2, 5)]
DFS_POS = [(-5.6, 2.2), (-3.6, 3.4), (-3.6, 1.0), (-1.6, 2.2), (0.4, 3.4), (-1.6, -0.2)]


def adjacency(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].append(v); adj[v].append(u)
    return [sorted(a) for a in adj]


def dfs_trace(n, edges):
    """Recursive DFS from node 0. Per frame: u, the call the code is in (−1 none); v, the neighbour being looked at
    (vi its place in adj[u]; −1 none); check, the last `not visited[v]` (−1 none, 0 visited, 1 new); visited (0/1
    per node), order, stack (the nodes of the calls not yet returned, outermost first) and calls (their call-site
    lines); parent (per node, the node it was discovered from; −1 none) and kids0 … kids{n−1} (each node's
    discovered children, for the tree edges); done (0/1 per node: its call returned)."""
    adj = adjacency(n, edges)
    L = lambda t: line_of(DFS_SOURCE, t)
    st = {'u': -1, 'v': -1, 'vi': -1, 'check': -1, 'visited': [0] * n, 'order': [], 'stack': [], 'calls': [],
          'parent': [-1] * n, **{f'kids{i}': [] for i in range(n)}, 'done': [0] * n, 'adjU': [], 'vTip': ''}
    trace, emit = recorder(st)
    # vTip: every value v takes in the current call's loop, the current one in gold bold (LaTeX, for the v row's
    # tooltip in the Code panel).
    def tip():
        u, vi = st['u'], st['vi']
        if u < 0: return ''
        cells = [rf'\textcolor{{#f1c65b}}{{\mathbf{{{x}}}}}' if k == vi else str(x) for k, x in enumerate(adj[u])]
        return rf'v \in [{", ".join(cells)}]'
    emit0 = emit
    def emit(line, message):
        st['vTip'] = tip(); emit0(line, message)
    emit(L('visited = [False]'), f'No node visited yet. adj lists each node\'s neighbours: {adj}.')
    emit(L('order = []'), 'order will record nodes in the order DFS first reaches them.')

    def dfs(u, site):
        st['stack'] = st['stack'] + [u]; st['calls'] = st['calls'] + [site]
        st.update(u=u, v=-1, vi=-1, check=-1, adjU=adj[u])
        st['visited'] = [1 if i == u else x for i, x in enumerate(st['visited'])]
        emit(L('visited[u] = True'), f'Visit {u}: mark it visited first, so no other path enters it again.')
        st['order'] = st['order'] + [u]
        emit(L('order.append(u)'), f'order = {st["order"]}.')
        for vi, v in enumerate(adj[u]):
            st.update(u=u, v=v, vi=vi, check=-1, adjU=adj[u])
            emit(L('for v in adj[u]'), f'Neighbour {vi + 1} of {len(adj[u])} of {u}: {v}.')
            new = not st['visited'][v]
            st['check'] = 1 if new else 0
            emit(L('if not visited[v]'), f'{v} is new: go deeper before trying {u}\'s other neighbours.' if new
                 else f'{v} is already visited' + (' (it is where we came from)' if st['parent'][u] == v else ': an edge back into explored territory, a cycle') + '. Skip it.')
            if new:
                st['parent'] = [u if i == v else x for i, x in enumerate(st['parent'])]
                st[f'kids{u}'] = st[f'kids{u}'] + [v]
                emit(L('dfs(v)'), f'Call dfs({v}): {u} waits until everything reachable from {v} is done.')
                dfs(v, L('dfs(v)'))
                st.update(u=u, v=v, vi=vi, check=1, adjU=adj[u])
        st['done'] = [1 if i == u else x for i, x in enumerate(st['done'])]
        st['stack'] = st['stack'][:-1]; st['calls'] = st['calls'][:-1]
        back = st['stack'][-1] if st['stack'] else -1
        st.update(u=back, v=-1, vi=-1, check=-1, adjU=adj[back] if back >= 0 else [])
        if back >= 0:
            emit(L('dfs(v)'), f'dfs({u}) has run out of neighbours and returns: back in dfs({back}), at the next neighbour.')

    emit(L('dfs(0)'), 'Start the search at node 0.')
    dfs(0, L('dfs(0)'))
    emit(L('return order'), f'Done: order = {st["order"]}. Every node and every edge was looked at once: O(V + E).')
    return trace, adj


def dfs_scene(header):
    n, edges = DFS_N, DFS_EDGES
    trace, adj = dfs_trace(n, edges)
    L = lambda t: line_of(DFS_SOURCE, t)
    on = lambda col, i: f"arrayAt({tr(col)}, {i}) == 1"
    current = f"(idx == {tr('u')} and to == {tr('v')}) or (idx == {tr('v')} and to == {tr('u')})"
    elements = [
        # Every edge, grey; the DFS tree's edges (discovered through) brighter; the edge being looked at lit.
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(n), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('nodes', idx, 'x')", "dataTable('nodes', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         'colorExpr': f"idx == {tr('u')} ? '{GOLD}' : (keyIndex({tr('stack')}, idx) >= 0 ? '#e67db0' : ({on('done', 'idx')} ? '#77bfae' : ''))",
         'connectTo': [
             {'indexExpr': "dataTable('nodes', idx, 'adj')", 'pinned': True, 'bendExpr': '0', 'color': '#4a5868',
              'colorExpr': f"{current} ? '{GOLD}' : ''", 'highlightExpr': current},
             # The DFS tree: an arrow from each node to the children it discovered.
             {'indexExpr': f"dataTable('trace', frame, concat('kids', idx))", 'pinned': True, 'arrow': True, 'bendExpr': '0', 'color': '#77bfae',
              'highlightExpr': 'true'}]},
        # The current node's neighbour list, with v walking along it.
        {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [4.6, 3.4, 0], 'cellSize': 1.1,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'lengthExpr': f"arrayCount({tr('adjU')})", 'valueExpr': f"arrayAt({tr('adjU')}, idx)",
         'highlightExpr': f"idx == {tr('vi')}",
         # Each neighbour links to its node in the graph; the one being looked at is lit.
         'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8',
                       'highlightExpr': f"idx == {tr('vi')}"},
         # The marker sits on v's place in the list and names its value.
         'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': tr('vi'), 'valueExpr': tr('v'), 'visibleExpr': f"{tr('vi')} >= 0", 'color': GOLD}]},
        {'id': 'visited', 'type': 'array', 'label': 'visited', 'labelSide': 'left', 'origin': [-4.4, -2.2, 0], 'cellSize': 1.15,
         'itemType': 'text', 'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(n),
         'valueExpr': f"{on('visited', 'idx')} ? 'T' : 'F'", 'highlightExpr': f"idx == {tr('v')} and {tr('check')} >= 0",
         'colorExpr': f"{on('visited', 'idx')} ? '#77bfae' : ''"},
        {'id': 'stack', 'type': 'array', 'label': 'call stack', 'labelSide': 'left', 'origin': [-4.4, -3.6, 0], 'cellSize': 1.15,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({tr('stack')})", 'valueExpr': f"arrayAt({tr('stack')}, idx)",
         'highlightExpr': f"idx == arrayCount({tr('stack')}) - 1"},
        {'id': 'order', 'type': 'array', 'label': 'order', 'labelSide': 'left', 'origin': [4.6, 1.6, 0], 'cellSize': 1.1,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'color': '#b69bea',
         'lengthExpr': f"arrayCount({tr('order')})", 'valueExpr': f"arrayAt({tr('order')}, idx)",
         'highlightExpr': f"idx == arrayCount({tr('order')}) - 1 and {tr('line')} == {L('order.append(u)')}"},
        label('u', f"{tr('u')} < 0 ? 'u: —' : concat('u = ', {tr('u')})", ['graph', tr('u')], L('def dfs(u)'), 'dfs'),
        {**label('v', f"{tr('v')} < 0 ? 'v: —' : concat('v = ', {tr('v')})", ['graph', tr('v')], L('for v in adj[u]'), 'dfs'),
         'tooltipExpr': tr('vTip')},
        {**label('check', f"{tr('check')} < 0 ? 'not visited[v]: —' : ({tr('check')} == 1 ? 'not visited[v] → True' : 'not visited[v] → False')",
                 ['visited', f"{tr('check')} >= 0 ? {tr('v')} : -1"], L('if not visited[v]'), 'dfs'),
         'highlightExpr': f"{tr('line')} == {L('if not visited[v]')}"},
    ]
    return run_scene('dfs', 'Go deep first (depth-first search)', header, """**Signal:** explore everything reachable, count components, find any path, or anything that backtracks.

DFS follows one path as far as it goes, then **backs up** to the last node with an untried neighbour and goes deep again. Recursion does the backing up for free: each `dfs(v)` call waits on the stack until everything reachable from `v` is done.

**Mark a node visited the moment you reach it.** A graph, unlike a tree, has cycles and several paths into one node; without `visited`, DFS would walk round a cycle forever. Here node 2 sees 0 again through the edge 0–2: already visited, so it is skipped, and that edge closes a cycle.

The arrows show the **DFS tree**: each node points to the nodes it discovered. Gold is the call running now, pink calls wait on the stack (the current path from 0), teal calls have returned. Open **Code** to see each waiting `dfs(v)` call's arrow into the function, the call stack drawn in the code.

**Cost:** each node is visited once and each adjacency list read once: O(V + E) time, O(V) space for `visited` and the recursion. On a very deep graph the recursion can overflow; an explicit stack does the same walk iteratively.

**Practice:** Number of Connected Components, Clone Graph, All Paths From Source to Target, Keys and Rooms.""",
        'Explain going deep, backing up, and why visited must be marked on arrival. Ask the learner to predict which node DFS visits next, and what happens when a neighbour is already visited.',
        'dfs.py', DFS_SOURCE, trace, elements,
        data={'nodes': [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(DFS_POS, adj)]}, call_entry=line_of(DFS_SOURCE, 'def dfs(u)'))


# ── One scene per algorithm: a built one where there is a builder, else a placeholder ──
codeFiles = []
BUILT = {'representations': representations_scene, 'dfs': dfs_scene}
for i, (sid, short, title, tier, after, signal, idea, cost, practice) in enumerate(ALGORITHMS):
    header = f"**Step {i + 1}** of {len(ALGORITHMS)} · **Tier:** {TIERS[tier][0]} ({TIERS[tier][2]})" + (' · **Builds on:** ' + ', '.join(SHORT[b] for b in after) if after else '')
    if sid in BUILT:
        scenes.append(BUILT[sid](header))
        continue
    scenes.append({
        'id': sid, 'title': title, 'description': f'Signal: {signal}', 'range': RANGE, 'camera': cam,
        'markdown': f"""# {title}

**Step {i + 1}** of {len(ALGORITHMS)} · **Tier:** {TIERS[tier][0]} ({TIERS[tier][2]}){' · **Builds on:** ' + ', '.join(SHORT[b] for b in after) if after else ''}

**Signal:** {signal}

{idea}

**Cost:** {cost}

*Visualization coming soon.*

**Practice:** {', '.join(practice)}.""",
        'prompt': f'Explain {short}: when a problem calls for it, the core idea, and the common mistakes. This scene has no visualization yet.',
        'elements': [grid, {'id': 'placeholder', 'type': 'text', 'text': 'Visualization coming soon', 'position': [1.5, 0, 0], 'color': BLUE}],
    })

lesson = {'title': 'Graph algorithms', 'codeFiles': codeFiles, 'scenes': scenes}
out = ROOT / 'scenes/draft/graph-algorithms.json'
out.write_text(dumps_compact_leaves(lesson) + '\n')
print('wrote', out, len(scenes), 'scenes')
