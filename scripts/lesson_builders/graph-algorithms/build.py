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
PALE = "'#3b4654'"   # a node peeled off its graph (degree peeling, Kahn's taken nodes), as an expression literal
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


def line_of(source, text, after=None):
    """The 1-based line of source holding text, so traces never hard-code line numbers; after (a text) starts the
    search at the line holding it, to tell apart lines that read the same in two functions."""
    lines = source.split('\n')
    start = next(i for i, l in enumerate(lines) if after in l) if after else 0
    return next(i + 1 for i, l in enumerate(lines) if i >= start and text in l)


def section(source, id, title, start, end, after=None, hint=None, prompt=None):
    """One section of a code file's teaching structure: the lines from the one holding start to the one holding end
    (both searched from after, a text, to tell functions apart), a short title, and optionally a hint that stands
    without the code and the tutor's prompt."""
    a = line_of(source, start, after)
    lines = source.split('\n')
    find = lambda text, k: next(i + 1 for i, l in enumerate(lines) if i >= k - 1 and text in l)
    # end may be (text, anchor): the text found from the line holding anchor, for a text that repeats.
    b = (find(end[0], find(end[1], a)) if isinstance(end, tuple) else find(end, a)) if end else a
    return {'id': id, 'title': title, 'from': a, 'to': b,
            **({'hint': hint} if hint else {}), **({'prompt': prompt} if prompt else {})}


tr = lambda col: f"dataTable('trace', frame, '{col}')"
label = lambda id, text, connect=None, line=None, file=None: {
    'id': id, 'type': 'expression_label', 'position': [7.6, -3.7, 0], 'textExpr': text,
    **({'connectTo': {'object': connect[0], 'indexExpr': connect[1]}} if connect else {}),
    **({'codeRef': {'file': file, 'line': line}} if line else {})}


def run_scene(id, title, header, markdown, prompt, file, source, trace, elements, data=None, call_entry=None,
              first=None, more=(), sections=()):
    """A scene that plays one recorded run: the frame slider, a caption from each frame's message, and the Code
    panel on the executing line (codeRef), with each line linked back to its frames. first retitles the run step
    ({'title', 'description'}); more adds steps that each play their own run from their own table, in the same code
    file: {'id', 'title', 'description', 'table', 'trace', 'elements'}, plus 'call_entry' (its function's line) for a
    recursive one, for the Code panel's call arrows. sections is the code's teaching structure
    (see section())."""
    sections = sections or code_sections(id)
    codeFiles.append({'id': id, 'path': f'graphs/{file}', 'language': 'python', 'source': source,
                      **({'sections': list(sections)} if sections else {}),
                      'locations': [{'line': f['line'], 'scene': id, 'step': 'run', 'snapshot': k, 'label': f"{title} · {f['message']}"}
                                    for k, f in enumerate(trace)]
                      + [{'line': f['line'], 'scene': id, 'step': m['id'], 'snapshot': k, 'label': f"{m['title']} · {f['message']}"}
                         for m in more for k, f in enumerate(m['trace'])]})
    col = lambda table, c: f"dataTable('{table}', frame, '{c}')"
    extra = [{'id': m['id'], 'title': m['title'], 'description': m['description'], 'descriptionExpr': col(m['table'], 'message'),
              'remove': [{'id': '*'}, {'type': 'slider'}],
              'sliders': [{'id': 'frame', 'label': 'Execution state', 'min': 0, 'max': len(m['trace']) - 1, 'step': 1, 'default': 0}],
              # A recursive run's step names its function's line (call_entry); its table's calls column lists the waiting call sites.
              'codeRef': {'file': id, 'lineExpr': col(m['table'], 'line'),
                          **({'callsExpr': col(m['table'], 'calls'), 'callEntryLine': m['call_entry']} if m.get('call_entry') else {})},
              'add': m['elements']} for m in more]
    return {
        'id': id, 'title': title, 'description': trace[0]['message'], 'range': RANGE, 'camera': cam,
        'data': {'trace': trace, **{m['table']: m['trace'] for m in more}, **(data or {})},
        'markdown': f'# {title}\n\n{header}\n\n{markdown}', 'prompt': prompt,
        'elements': [grid],
        'steps': [{'id': 'run', 'title': (first or {}).get('title', 'Run it'), 'description': (first or {}).get('description', 'Step through the run.'),
                   'descriptionExpr': tr('message'),
                   'sliders': [{'id': 'frame', 'label': 'Execution state', 'min': 0, 'max': len(trace) - 1, 'step': 1, 'default': 0}],
                   'add': elements}, *extra],
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
        {'id': 'stack', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'call stack', 'origin': [-4.4, -3.6, 0], 'cellSize': 1.15,
         'showTop': False, 'containerColor': '#e67db0', 'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0',
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


def loop_tip(values, vi):
    """LaTeX for a loop variable's tooltip: every value it takes, the current one in gold bold."""
    cells = [rf'\textcolor{{#f1c65b}}{{\mathbf{{{x}}}}}' if k == vi else str(x) for k, x in enumerate(values)]
    return rf'v \in [{", ".join(cells)}]'


# ── 3. BFS: level by level from node 0, on the DFS scene's graph, so the two orders can be compared ──
BFS_SOURCE = """from collections import deque

def bfs(n, adj, start):
    dist = [-1] * n
    dist[start] = 0
    queue = deque([start])
    while queue:
        u = queue.popleft()
        for v in adj[u]:
            if dist[v] == -1:
                dist[v] = dist[u] + 1
                queue.append(v)
    return dist"""


def bfs_trace(n, edges, start=0):
    """BFS from start. Per frame: u, the node just taken from the queue (−1 none); v and vi as in DFS; check, the
    last `dist[v] == -1` (−1 none, 0 already reached, 1 new); dist (−1 unreached); queue, front first; order, the
    nodes in the order they leave the queue; state per node (0 unreached, 1 queued, 2 processed); kids0 … the
    BFS tree; adjU, adj[u]; vTip, v's tooltip."""
    adj = adjacency(n, edges)
    L = lambda t: line_of(BFS_SOURCE, t)
    st = {'u': -1, 'v': -1, 'vi': -1, 'check': -1, 'dist': [-1] * n, 'queue': [], 'order': [], 'state': [0] * n,
          **{f'kids{i}': [] for i in range(n)}, 'adjU': [], 'vTip': ''}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    emit(L('dist = [-1] * n'), 'dist = -1 everywhere: no node reached yet. dist doubles as "visited".')
    st['dist'] = [0 if i == start else d for i, d in enumerate(st['dist'])]
    emit(L('dist[start] = 0'), f'The start, {start}, is 0 steps from itself.')
    st['queue'] = [start]; st['state'] = [1 if i == start else x for i, x in enumerate(st['state'])]
    emit(L('queue = deque'), f'The queue holds the frontier: nodes reached but not yet processed. It starts with {start}.')
    while st['queue']:
        st.update(u=-1, v=-1, vi=-1, check=-1, adjU=[])
        emit(L('while queue'), f'The queue holds {st["queue"]}: keep going.')
        u = st['queue'][0]; st['queue'] = st['queue'][1:]
        st['order'] = st['order'] + [u]
        st.update(u=u, adjU=adj[u])
        emit(L('u = queue.popleft()'), f'Take {u} from the front: it is {st["dist"][u]} step{"" if st["dist"][u] == 1 else "s"} from {start}, and every node nearer was taken before it.')
        for vi, v in enumerate(adj[u]):
            st.update(v=v, vi=vi, check=-1)
            emit(L('for v in adj[u]'), f'Neighbour {vi + 1} of {len(adj[u])} of {u}: {v}.')
            new = st['dist'][v] == -1
            st['check'] = 1 if new else 0
            emit(L('if dist[v] == -1'), f'{v} has not been reached: it is one step further than {u}.' if new
                 else f'{v} was already reached (dist {st["dist"][v]}): a shorter or equal path got there first. Skip it.')
            if new:
                st['dist'] = [st['dist'][u] + 1 if i == v else d for i, d in enumerate(st['dist'])]
                st[f'kids{u}'] = st[f'kids{u}'] + [v]
                emit(L('dist[v] = dist[u] + 1'), f'dist[{v}] = {st["dist"][v]}, set now, as {v} joins the queue: no later path can be shorter.')
                st['queue'] = st['queue'] + [v]; st['state'] = [1 if i == v else x for i, x in enumerate(st['state'])]
                emit(L('queue.append(v)'), f'{v} joins the back of the queue: queue = {st["queue"]}.')
        st['state'] = [2 if i == u else x for i, x in enumerate(st['state'])]
    st.update(u=-1, v=-1, vi=-1, check=-1, adjU=[])
    emit(L('while queue'), 'The queue is empty: every node reachable from the start has been processed.')
    emit(L('return dist'), f'dist = {st["dist"]}: the fewest edges from {start} to each node. O(V + E).')
    return trace, adj


def bfs_scene(header):
    n, edges = DFS_N, DFS_EDGES
    trace, adj = bfs_trace(n, edges)
    L = lambda t: line_of(BFS_SOURCE, t)
    state = lambda i, k: f"arrayAt({tr('state')}, {i}) == {k}"
    current = f"(idx == {tr('u')} and to == {tr('v')}) or (idx == {tr('v')} and to == {tr('u')})"
    reached = f"arrayAt({tr('dist')}, idx) >= 0"
    elements = [
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(n), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('nodes', idx, 'x')", "dataTable('nodes', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         'colorExpr': f"idx == {tr('u')} ? '{GOLD}' : ({state('idx', 1)} ? '#e67db0' : ({state('idx', 2)} ? '#77bfae' : ''))",
         'connectTo': [
             {'indexExpr': "dataTable('nodes', idx, 'adj')", 'pinned': True, 'bendExpr': '0', 'color': '#4a5868',
              'colorExpr': f"{current} ? '{GOLD}' : ''", 'highlightExpr': current},
             # The BFS tree: an arrow from each node to the nodes it reached first.
             {'indexExpr': "dataTable('trace', frame, concat('kids', idx))", 'pinned': True, 'arrow': True, 'bendExpr': '0',
              'color': '#77bfae', 'highlightExpr': 'true'}]},
        {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [4.6, 3.4, 0],
         'cellSize': 1.1, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'lengthExpr': f"arrayCount({tr('adjU')})", 'valueExpr': f"arrayAt({tr('adjU')}, idx)", 'highlightExpr': f"idx == {tr('vi')}",
         'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8',
                       'highlightExpr': f"idx == {tr('vi')}"},
         'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': tr('vi'), 'valueExpr': tr('v'), 'visibleExpr': f"{tr('vi')} >= 0", 'color': GOLD}]},
        # The frontier, front on the left: nodes leave from the front and join at the back.
        {'id': 'queue', 'type': 'array', 'label': 'queue', 'labelSide': 'left', 'origin': [4.6, 1.6, 0], 'cellSize': 1.1,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({tr('queue')})", 'valueExpr': f"arrayAt({tr('queue')}, idx)",
         'highlightExpr': f"idx == arrayCount({tr('queue')}) - 1 and {tr('line')} == {L('queue.append(v)')}",
         'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#e67db0'}},
        {'id': 'dist', 'type': 'array', 'label': 'dist', 'labelSide': 'left', 'origin': [-4.4, -2.2, 0], 'cellSize': 1.15,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(n),
         'valueExpr': f"arrayAt({tr('dist')}, idx)", 'colorExpr': f"{reached} ? '#77bfae' : ''",
         'highlightExpr': f"idx == {tr('v')} and {tr('check')} >= 0"},
        {'id': 'order', 'type': 'array', 'label': 'order', 'labelSide': 'left', 'origin': [-4.4, -3.6, 0], 'cellSize': 1.15,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'color': '#b69bea',
         'lengthExpr': f"arrayCount({tr('order')})", 'valueExpr': f"arrayAt({tr('order')}, idx)",
         'highlightExpr': f"idx == arrayCount({tr('order')}) - 1 and {tr('line')} == {L('u = queue.popleft()')}"},
        label('u', f"{tr('u')} < 0 ? 'u: —' : concat('u = ', {tr('u')})", ['graph', tr('u')], L('u = queue.popleft()'), 'bfs'),
        {**label('v', f"{tr('v')} < 0 ? 'v: —' : concat('v = ', {tr('v')})", ['graph', tr('v')], L('for v in adj[u]'), 'bfs'),
         'tooltipExpr': tr('vTip')},
        {**label('check', f"{tr('check')} < 0 ? 'dist[v] == -1: —' : ({tr('check')} == 1 ? 'dist[v] == -1 → True' : 'dist[v] == -1 → False')",
                 ['dist', f"{tr('check')} >= 0 ? {tr('v')} : -1"], L('if dist[v] == -1'), 'bfs'),
         'highlightExpr': f"{tr('line')} == {L('if dist[v] == -1')}"},
    ]
    return run_scene('bfs', 'Level by level (breadth-first search)', header, """**Signal:** shortest path in steps on an unweighted graph, "minimum moves", nearest X, or anything level by level.

BFS explores in rings: first every node one step from the start, then every node two steps away, and so on. A **queue** makes that happen: nodes leave from the front in the order they joined at the back, so nearer nodes are always processed first.

**Mark a node when it joins the queue, not when it leaves.** Here `dist` is the mark: `-1` means unreached. Setting `dist[v]` at the moment `v` is queued stops another node from queueing it again, and the first time BFS reaches a node is along a **shortest** path, so its distance is final then.

This is the DFS scene's graph, from the same start. DFS went 0, 1, 3, 2, 5, 4, deep before wide; BFS goes 0, 1, 2, 3, 5, 4, near before far. Gold is the node being processed, pink nodes wait in the queue, teal nodes are done; the arrows are the **BFS tree**, and following them from 0 gives a shortest path to every node.

**Multi-source BFS** starts with several nodes in the queue at distance 0, for "distance to the nearest gate" or "rotting oranges".

**Cost:** O(V + E) time, O(V) space for the queue and `dist`.

**Practice:** Word Ladder, Rotting Oranges, Shortest Path in Binary Matrix, Open the Lock.""",
        'Explain why a queue gives shortest paths in steps, and why a node is marked when queued. Ask the learner to predict the queue after each node is processed, and each new dist value.',
        'bfs.py', BFS_SOURCE, trace, elements,
        data={'nodes': [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(DFS_POS, adj)]})


# ── 4. Count degrees: read the counts (the town judge), then peel by degree (a tree's centre) ──
DEGREES_SOURCE = """from collections import deque

def find_judge(n, trust):
    indeg = [0] * n
    outdeg = [0] * n
    for a, b in trust:
        outdeg[a] += 1
        indeg[b] += 1
    for p in range(n):
        if indeg[p] == n - 1 and outdeg[p] == 0:
            return p
    return -1

def tree_centers(n, edges):
    adj = [[] for _ in range(n)]
    degree = [0] * n
    for u, v in edges:
        adj[u].append(v)
        adj[v].append(u)
        degree[u] += 1
        degree[v] += 1
    leaves = deque(i for i in range(n) if degree[i] == 1)
    remaining = n
    while remaining > 2:
        for _ in range(len(leaves)):
            leaf = leaves.popleft()
            remaining -= 1
            for nb in adj[leaf]:
                degree[nb] -= 1
                if degree[nb] == 1:
                    leaves.append(nb)
    return list(leaves)"""
JUDGE_N, JUDGE_TRUST = 4, [(0, 2), (1, 2), (3, 2), (0, 1)]
JUDGE_POS = [(-5.6, 3.4), (-5.6, 0.6), (-3.2, 2.0), (-0.8, 3.4)]
TREE_N, TREE_EDGES = 7, [(0, 3), (1, 3), (2, 3), (3, 4), (4, 5), (5, 6)]
TREE_POS = [(-5.0, 2.7), (-5.4, 1.2), (-5.0, -0.3), (-3.5, 1.2), (-2.0, 1.2), (-0.5, 1.2), (1.0, 1.2)]


def judge_trace(n, trust):
    """Per frame: k, the trust pair being counted (−1 none), a and b its ends; indeg and outdeg; counted (the trust
    edges counted into an indegree so far); p, the person
    being checked (−1 none); ok, that check (−1 none, 0 no, 1 yes); result ('—' before the end)."""
    L = lambda t: line_of(DEGREES_SOURCE, t, 'def find_judge')
    st = {'k': -1, 'a': -1, 'b': -1, 'indeg': [0] * n, 'outdeg': [0] * n, 'counted': [], 'p': -1, 'ok': -1, 'result': '—'}
    trace, emit = recorder(st)
    emit(L('indeg = [0] * n'), f'{n} people. indeg counts how many trust each person; it starts at 0.')
    emit(L('outdeg = [0] * n'), 'outdeg counts how many each person trusts.')
    for k, (a, b) in enumerate(trust):
        st.update(k=k, a=a, b=b)
        emit(L('for a, b in trust'), f'{a} trusts {b}: an edge {a} → {b}.')
        st['outdeg'] = [x + 1 if i == a else x for i, x in enumerate(st['outdeg'])]
        emit(L('outdeg[a] += 1'), f'outdeg[{a}] = {st["outdeg"][a]}: {a} trusts {st["outdeg"][a]} {"person" if st["outdeg"][a] == 1 else "people"}.')
        st['indeg'] = [x + 1 if i == b else x for i, x in enumerate(st['indeg'])]
        st['counted'] = st['counted'] + [[a, b]]
        emit(L('indeg[b] += 1'), f'indeg[{b}] = {st["indeg"][b]}: {st["indeg"][b]} {"person trusts" if st["indeg"][b] == 1 else "people trust"} {b}.')
    st.update(k=-1, a=-1, b=-1)
    for p in range(n):
        st.update(p=p, ok=-1)
        emit(L('for p in range(n)'), f'Check {p}: the judge is trusted by everyone else ({n - 1}) and trusts no one.')
        ok = st['indeg'][p] == n - 1 and st['outdeg'][p] == 0
        st['ok'] = 1 if ok else 0
        emit(L('if indeg[p] == n - 1'), f'indeg[{p}] = {st["indeg"][p]}, outdeg[{p}] = {st["outdeg"][p]}: ' + ('both fit.' if ok else 'not the judge.'))
        if ok:
            st['result'] = str(p)
            emit(L('return p'), f'{p} is the judge, found from the counts alone: one pass over the edges and one over the people, O(V + E).')
            return trace
    st.update(p=-1, ok=-1, result='-1')
    emit(L('return -1'), 'No one fits: there is no judge.')
    return trace


def centers_trace(n, edges):
    """Every line the code runs. Per frame: degree; leaves (the queue); k, u and v, the edge being counted (−1
    none); i and ci, the node the leaves line checks and its `degree[i] == 1` (−1 none, 0 no, 1 yes); leaf, the leaf
    being removed (−1 none); nb and ni, its neighbour and that neighbour's place in adj[leaf] (−1 none); cnb, the
    last `degree[nb] == 1` (−1 none); counted (the edges counted into both ends' degrees so far); removed (0/1 per node) and round (the peeling round each removed node left
    in, −1 not yet); remaining; rnd, the round now (0 before the loop); adjLeaf, adj[leaf]; result."""
    L = lambda t: line_of(DEGREES_SOURCE, t, 'def tree_centers')
    adj = adjacency(n, edges)
    st = {'degree': [0] * n, 'leaves': [], 'k': -1, 'u': -1, 'v': -1, 'i': -1, 'ci': -1, 'leaf': -1, 'nb': -1, 'ni': -1,
          'cnb': -1, 'removed': [0] * n, 'round': [-1] * n, 'remaining': n, 'rnd': 0, 'adjLeaf': [], 'result': '—',
          'adjU': [], 'adjV': [], 'counted': []}
    trace, emit = recorder(st)
    built = [[] for _ in range(n)]   # adj as the counting loop fills it; adjU / adjV show adj[u] / adj[v]
    bump = lambda node, by: [d + by if j == node else d for j, d in enumerate(st['degree'])]
    emit(L('adj = [[] for _ in range(n)]'), f'{n} empty neighbour lists.')
    emit(L('degree = [0] * n'), 'Every degree starts at 0.')
    for k, (u, v) in enumerate(edges):
        st.update(k=k, u=u, v=v)
        st.update(adjU=list(built[u]), adjV=list(built[v]))
        emit(L('for u, v in edges'), f'Edge {u}–{v}.')
        built[u].append(v); st['adjU'] = list(built[u])
        emit(L('adj[u].append(v)'), f'{v} is a neighbour of {u}: adj[{u}] = {built[u]}.')
        built[v].append(u); st['adjV'] = list(built[v])
        emit(L('adj[v].append(u)'), f'{u} is a neighbour of {v}: adj[{v}] = {built[v]}.')
        st['degree'] = bump(u, 1)
        emit(L('degree[u] += 1'), f'degree[{u}] = {st["degree"][u]}.')
        st['degree'] = bump(v, 1)
        st['counted'] = st['counted'] + [[u, v]]
        emit(L('degree[v] += 1'), f'degree[{v}] = {st["degree"][v]}.')
    st.update(k=-1, u=-1, v=-1, adjU=[], adjV=[])
    for i in range(n):
        leaf_now = st['degree'][i] == 1
        st.update(i=i, ci=1 if leaf_now else 0)
        if leaf_now: st['leaves'] = st['leaves'] + [i]
        emit(L('leaves = deque'), f'degree[{i}] = {st["degree"][i]}: ' + ('a leaf, queued.' if leaf_now else 'not a leaf.'))
    st.update(i=-1, ci=-1)
    emit(L('remaining = n'), f'The leaves {st["leaves"]} can never be a centre: a tree is tallest from them. {n} nodes remain.')
    while True:
        more = st['remaining'] > 2
        emit(L('while remaining > 2'), f'{st["remaining"]} remain, more than 2: peel round {st["rnd"] + 1} removes every current leaf.' if more
             else f'{st["remaining"]} remain: stop.')
        if not more: break
        st['rnd'] += 1
        for _ in range(len(st['leaves'])):
            leaf = st['leaves'][0]; st['leaves'] = st['leaves'][1:]
            st['removed'] = [1 if j == leaf else x for j, x in enumerate(st['removed'])]
            st['round'] = [st['rnd'] if j == leaf else x for j, x in enumerate(st['round'])]
            st.update(leaf=leaf, nb=-1, ni=-1, cnb=-1, adjLeaf=adj[leaf])
            emit(L('leaf = leaves.popleft()'), f'Peel leaf {leaf}.')
            st['remaining'] -= 1
            emit(L('remaining -= 1'), f'{st["remaining"]} remain.')
            # Every neighbour, as the code does: one already peeled drops to 0 and never becomes a leaf again.
            for ni, nb in enumerate(adj[leaf]):
                st.update(nb=nb, ni=ni, cnb=-1)
                emit(L('for nb in adj[leaf]'), f'Neighbour {ni + 1} of {len(adj[leaf])} of {leaf}: {nb}.')
                st['degree'] = bump(nb, -1)
                emit(L('degree[nb] -= 1'), f'{nb} loses an edge: degree[{nb}] = {st["degree"][nb]}.' if not st['removed'][nb]
                     else f'{nb} was peeled already: its count drops to {st["degree"][nb]}, and it stays out.')
                st['cnb'] = 1 if st['degree'][nb] == 1 else 0
                emit(L('if degree[nb] == 1'), f'degree[{nb}] is 1: {nb} has just become a leaf.' if st['cnb'] else f'degree[{nb}] is {st["degree"][nb]}: not a leaf.')
                if st['cnb']:
                    st['leaves'] = st['leaves'] + [nb]
                    emit(L('leaves.append(nb)'), f'{nb} waits for the next round. leaves = {st["leaves"]}.')
        st.update(leaf=-1, nb=-1, ni=-1, cnb=-1, adjLeaf=[])
    st['result'] = str(st['leaves'])
    emit(L('return list(leaves)'), f'{st["leaves"]} is the centre: rooting the tree there gives the smallest height. Each node and edge is handled once: O(V).')
    return trace, adj


def degrees_scene(header):
    jt, (ct, tadj) = judge_trace(JUDGE_N, JUDGE_TRUST), centers_trace(TREE_N, TREE_EDGES)
    LJ = lambda t: line_of(DEGREES_SOURCE, t, 'def find_judge')
    LC = lambda t: line_of(DEGREES_SOURCE, t, 'def tree_centers')
    n = JUDGE_N
    outs = [[b for a, b in JUDGE_TRUST if a == i] for i in range(n)]
    cur = f"idx == {tr('a')} and to == {tr('b')}"
    judge_elements = [
        # Who trusts whom: an arrow a → b per trust pair; the pair being counted lit.
        {'id': 'people', 'type': 'graph', 'label': 'trust', 'lengthExpr': str(n), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('people', idx, 'x')", "dataTable('people', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         'colorExpr': f"idx == {tr('p')} ? ({tr('ok')} == 1 ? '#77bfae' : '{GOLD}') : (idx == {tr('a')} or idx == {tr('b')} ? '{GOLD}' : '')",
         'connectTo': {'indexExpr': "dataTable('people', idx, 'out')", 'pinned': True, 'arrow': True, 'bendExpr': '0', 'color': '#7f93aa',
                       'colorExpr': f"{cur} ? '{GOLD}' : ''", 'highlightExpr': cur,
                       # A counted trust edge is thick and carries its target's indegree so far.
                       'widthExpr': f"keyIndex({tr('counted')}, [idx, to]) >= 0 ? 2.6 : 1.2",
                       'labelExpr': f"keyIndex({tr('counted')}, [idx, to]) >= 0 ? concat(arrayAt({tr('indeg')}, to)) : ''"}},
        {'id': 'trust', 'type': 'array', 'label': 'trust', 'labelSide': 'left', 'itemType': 'text', 'origin': [2.6, 3.4, 0], 'cellSize': 1.35,
         'values': [f'({a}, {b})' for a, b in JUDGE_TRUST], 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'highlightExpr': f"idx == {tr('k')}"},
        {'id': 'indeg', 'type': 'array', 'label': 'indeg', 'labelSide': 'left', 'origin': [-3.2, -1.6, 0], 'cellSize': 1.2,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(n), 'valueExpr': f"arrayAt({tr('indeg')}, idx)",
         'highlightExpr': f"(idx == {tr('b')} and {tr('line')} == {LJ('indeg[b] += 1')}) or idx == {tr('p')}",
         'markers': [{'type': 'step_marker', 'indexName': 'p', 'indexExpr': tr('p'), 'visibleExpr': f"{tr('p')} >= 0", 'color': GOLD}]},
        {'id': 'outdeg', 'type': 'array', 'label': 'outdeg', 'labelSide': 'left', 'origin': [-3.2, -3.2, 0], 'cellSize': 1.2,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(n), 'valueExpr': f"arrayAt({tr('outdeg')}, idx)",
         'highlightExpr': f"(idx == {tr('a')} and {tr('line')} == {LJ('outdeg[a] += 1')}) or idx == {tr('p')}"},
        label('a', f"{tr('a')} < 0 ? 'a: —' : concat('a = ', {tr('a')})", ['people', tr('a')], LJ('for a, b in trust'), 'degrees'),
        label('b', f"{tr('b')} < 0 ? 'b: —' : concat('b = ', {tr('b')})", ['people', tr('b')], LJ('for a, b in trust'), 'degrees'),
        # The counts the code reads and writes, each wired to its cell.
        *[label(f'{arr}-{v}', f"{tr(v)} < 0 ? '{arr}[{v}]: —' : concat('{arr}[{v}] = ', arrayAt({tr(arr)}, {tr(v)}))", [arr, tr(v)], LJ(line), 'degrees')
          for arr, v, line in [('outdeg', 'a', 'outdeg[a] += 1'), ('indeg', 'b', 'indeg[b] += 1'),
                               ('indeg', 'p', 'if indeg[p] == n - 1'), ('outdeg', 'p', 'if indeg[p] == n - 1')]],
        {**label('cond', f"{tr('ok')} < 0 ? 'indeg[p] == n - 1 and outdeg[p] == 0: —' : ({tr('ok')} == 1 ? 'indeg[p] == n - 1 and outdeg[p] == 0 → True' : 'indeg[p] == n - 1 and outdeg[p] == 0 → False')",
                 ['people', tr('p')], LJ('if indeg[p] == n - 1'), 'degrees'), 'highlightExpr': f"{tr('line')} == {LJ('if indeg[p] == n - 1')}"},
    ]
    c = lambda col: f"dataTable('deg_peel', frame, '{col}')"
    removed = f"arrayAt({c('removed')}, idx) == 1"
    pair = lambda a, b: f"((idx == {c(a)} and to == {c(b)}) or (idx == {c(b)} and to == {c(a)}))"
    edge_now = f"{pair('u', 'v')} or ({c('nb')} >= 0 and {pair('leaf', 'nb')})"
    tree_live = (f"(keyIndex({c('counted')}, [idx, to]) >= 0 or keyIndex({c('counted')}, [to, idx]) >= 0)"
                 f" and arrayAt({c('removed')}, idx) == 0 and arrayAt({c('removed')}, to) == 0")
    tn = TREE_N
    center_elements = [
        # The tree: removed nodes dim by the round they left in; the leaf being peeled gold, queued leaves pink.
        {'id': 'tree', 'type': 'graph', 'label': 'tree', 'lengthExpr': str(tn), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('treeNodes', idx, 'x')", "dataTable('treeNodes', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         'colorExpr': f"idx == {c('leaf')} ? '{GOLD}' : ({removed} ? '#3b4654' : (keyIndex({c('leaves')}, idx) >= 0 ? '#e67db0' : (idx == {c('nb')} ? '#9dbde3' : '')))",
         # The edge being counted (u–v), or the one a peeled leaf drops (leaf–nb), lit; peeled edges dim.
         'connectTo': {'indexExpr': "dataTable('treeNodes', idx, 'adj')", 'pinned': True, 'bendExpr': '0', 'color': '#7f93aa',
                       'colorExpr': f"{edge_now} ? '{GOLD}' : ({removed} or arrayAt({c('removed')}, to) == 1 ? '#2c3540' : '')",
                       'highlightExpr': edge_now,
                       # A counted edge still in the tree is thick; once (from its smaller end) it carries both ends'
                       # degrees, so a leaf's edge reads 1 at one end.
                       'widthExpr': f"({tree_live}) ? 2.6 : 1.2",
                       'labelExpr': f"({tree_live}) and idx < to ? concat(arrayAt({c('degree')}, idx), ' · ', arrayAt({c('degree')}, to)) : ''"}},
        # While counting: adj[u] and adj[v] as they fill, the neighbour just appended lit.
        *[{'id': f'adj-{w}', 'type': 'array', 'label': f'adj[{w}]', 'codeSymbol': f'adj[{w}]', 'labelSide': 'left',
           'origin': [6.6, y, 0], 'cellSize': 1.15, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
           'visibleExpr': f"{c('u')} >= 0", 'lengthExpr': f"arrayCount({c(col)})", 'valueExpr': f"arrayAt({c(col)}, idx)",
           'highlightExpr': f"idx == arrayCount({c(col)}) - 1 and {c('line')} == {LC(line)}",
           'connectTo': {'object': 'tree', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8'}}
          for w, col, y, line in [('u', 'adjU', 1.8, 'adj[u].append(v)'), ('v', 'adjV', 0.6, 'adj[v].append(u)')]],
        # The leaf's neighbours, nb's cell lit as it walks along them, each linked to its node (no marker: the title
        # sits above the row, and nb is the lit cell's own value).
        # Alone on the tree's right while peeling, so its long title goes above the row, clear of the tree.
        {'id': 'adj-leaf', 'visibleExpr': f"{c('leaf')} >= 0", 'type': 'array', 'label': 'adj[leaf]', 'codeSymbol': 'adj[leaf]', 'labelSide': 'top', 'origin': [4.0, 1.2, 0],
         'cellSize': 1.15, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'lengthExpr': f"arrayCount({c('adjLeaf')})", 'valueExpr': f"arrayAt({c('adjLeaf')}, idx)", 'highlightExpr': f"idx == {c('ni')}",
         'connectTo': {'object': 'tree', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8',
                       'highlightExpr': f"idx == {c('ni')}"}},
        {'id': 'tree-edges', 'type': 'array', 'label': 'edges', 'labelSide': 'left', 'itemType': 'text', 'origin': [-3.4, 4.3, 0],
         'cellSize': 1.3, 'values': [f'({u}, {v})' for u, v in TREE_EDGES], 'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane',
         'highlightExpr': f"idx == {c('k')}"},
        {'id': 'degree', 'type': 'array', 'label': 'degree', 'labelSide': 'left', 'origin': [-3.4, -2.6, 0], 'cellSize': 1.05,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(tn), 'valueExpr': f"arrayAt({c('degree')}, idx)",
         'colorExpr': f"{removed} ? '#3b4654' : ''",
         'highlightExpr': f"idx == {c('nb')} or (idx == {c('leaf')} and {c('nb')} < 0) or idx == {c('i')} or idx == {c('u')} or idx == {c('v')}"},
        {'id': 'leaves', 'type': 'array', 'label': 'leaves', 'labelSide': 'left', 'origin': [-3.4, -3.8, 0], 'cellSize': 1.05,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({c('leaves')})", 'valueExpr': f"arrayAt({c('leaves')}, idx)",
         'connectTo': {'object': 'tree', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#e67db0'}},
        label('uv', f"{c('u')} < 0 ? '(u, v): —' : concat('(u, v) = (', {c('u')}, ', ', {c('v')}, ')')", ['tree-edges', c('k')], LC('for u, v in edges'), 'degrees'),
        label('degree-u', f"{c('u')} < 0 ? 'degree[u]: —' : concat('degree[u] = ', arrayAt({c('degree')}, {c('u')}))", ['degree', c('u')], LC('degree[u] += 1'), 'degrees'),
        label('degree-v', f"{c('v')} < 0 ? 'degree[v]: —' : concat('degree[v] = ', arrayAt({c('degree')}, {c('v')}))", ['degree', c('v')], LC('degree[v] += 1'), 'degrees'),
        label('i', f"{c('i')} < 0 ? 'i: —' : concat('i = ', {c('i')})", ['tree', c('i')], LC('leaves = deque'), 'degrees'),
        {**label('ci', f"{c('ci')} < 0 ? 'degree[i] == 1: —' : ({c('ci')} == 1 ? 'degree[i] == 1 → True' : 'degree[i] == 1 → False')",
                 ['degree', c('i')], LC('leaves = deque'), 'degrees'), 'highlightExpr': f"{c('ci')} >= 0"},
        label('leaf', f"{c('leaf')} < 0 ? 'leaf: —' : concat('leaf = ', {c('leaf')})", ['tree', c('leaf')], LC('leaf = leaves.popleft()'), 'degrees'),
        label('nb', f"{c('nb')} < 0 ? 'nb: —' : concat('nb = ', {c('nb')})", ['tree', c('nb')], LC('for nb in adj[leaf]'), 'degrees'),
        label('degree-nb', f"{c('nb')} < 0 ? 'degree[nb]: —' : concat('degree[nb] = ', arrayAt({c('degree')}, {c('nb')}))",
              ['degree', c('nb')], LC('degree[nb] -= 1'), 'degrees'),
        {**label('cnb', f"{c('cnb')} < 0 ? 'degree[nb] == 1: —' : ({c('cnb')} == 1 ? 'degree[nb] == 1 → True' : 'degree[nb] == 1 → False')",
                 ['degree', f"{c('cnb')} >= 0 ? {c('nb')} : -1"], LC('if degree[nb] == 1'), 'degrees'), 'highlightExpr': f"{c('line')} == {LC('if degree[nb] == 1')}"},
        label('remaining', f"concat('remaining = ', {c('remaining')})", None, LC('remaining = n'), 'degrees'),
        label('round', f"{c('rnd')} < 1 ? 'round: —' : concat('round = ', {c('rnd')})", None, LC('while remaining > 2'), 'degrees'),
    ]
    return run_scene('degrees', 'Count degrees (in, out, and peeling)', header, """**Signal:** a node defined by how many edges touch it ("trusted by everyone", "the centre"), sources and sinks, or peeling a graph layer by layer.

A node's **degree** is how many edges touch it. In a directed graph it splits in two: **in-degree** (edges arriving) and **out-degree** (edges leaving). One pass over the edge list counts them all, with no traversal: O(V + E).

## 1. Read the counts (this step)

In Find the Town Judge, an edge `a → b` means "a trusts b". The judge is trusted by everyone else and trusts no one: in-degree n − 1, out-degree 0. Count, then scan; no search needed.

## 2. Peel by degree (next step)

Repeatedly remove the nodes whose degree has hit a threshold, updating their neighbours as you go. Peeling a tree's **leaves** (degree 1) round by round, with a queue, closes in from every side at once; the one or two nodes left last are the tree's **centre**, the roots that make it shortest (Minimum Height Trees). Removed nodes dim; pink nodes are queued for the next round.

## Where degree counting is used

- **The counts are the answer:** the town judge (in n − 1, out 0); the centre of a star graph (degree n − 1); the smallest set of starting points that reach everything (exactly the nodes with in-degree 0); maximal network rank (two degrees added, minus 1 if the two are joined).
- **The counts prove a shape:** degrees always add up to 2E (each edge has two ends); a connected graph is a tree exactly when it has V − 1 edges; a path has two nodes of degree 1 and the rest degree 2; an **Euler path** needs balanced degrees (in = out everywhere, except one start and one end), which tells you up front whether an itinerary can use every ticket.
- **Peeling:** Kahn's **topological sort** peels nodes with in-degree 0 (leftovers mean a cycle); **eventual safe states** peels out-degree 0 on the reversed graph; **parallel courses** counts the peeling rounds (one per semester); and the tree centre above.

**Practice:** Find the Town Judge, Find Center of Star Graph, Minimum Number of Vertices to Reach All Nodes, Maximal Network Rank, Minimum Height Trees.""",
        'Explain in-degree and out-degree, and peeling by degree. Ask the learner to predict the counts after each edge, who the judge is, and which nodes become leaves after each peeling round.',
        'degrees.py', DEGREES_SOURCE, jt, judge_elements,
        data={'people': [{'x': x, 'y': y, 'out': o} for (x, y), o in zip(JUDGE_POS, outs)],
              'treeNodes': [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(TREE_POS, tadj)]},
        first={'title': 'Read the counts (town judge)', 'description': 'Count in- and out-degrees, then find who everyone trusts.'},
        more=[{'id': 'peel', 'title': 'Peel by degree (tree centre)', 'description': "Peel a tree's leaves round by round to find its centre.",
               'table': 'deg_peel', 'trace': ct, 'elements': center_elements}])


# ── 5. A grid is a graph: flood fill, a recursive DFS whose neighbours come from four offsets ──
GRID_SOURCE = """from collections import deque

def flood_fill(image, sr, sc, color):
    rows, cols = len(image), len(image[0])
    old = image[sr][sc]
    if old == color:
        return image

    def fill(r, c):
        if not (0 <= r < rows and 0 <= c < cols) or image[r][c] != old:
            return
        image[r][c] = color
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            fill(r + dr, c + dc)

    fill(sr, sc)
    return image

def flood_fill_bfs(image, sr, sc, color):
    rows, cols = len(image), len(image[0])
    old = image[sr][sc]
    if old == color:
        return image
    image[sr][sc] = color
    queue = deque([(sr, sc)])
    while queue:
        r, c = queue.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and image[nr][nc] == old:
                image[nr][nc] = color
                queue.append((nr, nc))
    return image"""
# A winding region of 1s around a 0 hole it encloses (left alone: another colour), and a block of 1s at the bottom
# left that touches the region only at a corner (left alone: corners are not neighbours).
IMAGE = [[1, 1, 0, 2, 2, 2],
         [0, 1, 1, 1, 0, 2],
         [0, 0, 1, 0, 1, 1],
         [1, 0, 1, 1, 1, 0],
         [1, 1, 0, 0, 1, 0],
         [1, 1, 0, 1, 1, 1]]
FILL_START, FILL_COLOR = (1, 1), 3
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]


def grid_trace(image, start, color):
    """Flood fill by recursive DFS. Cells are numbered row by row (r * cols + c). Per frame: img, the pixel values
    flattened; r, c, the call the code is in, and cur its cell (−1 off the grid or none); d, the direction being
    called (−1 none); from, the cell that made the current call (−1 none); ok (−1 none, 0 returned at once, 1
    filled) and checkText; stack, the waiting calls as "(r, c)" texts, and calls their call-site lines."""
    rows, cols = len(image), len(image[0])
    L = lambda t: line_of(GRID_SOURCE, t)
    img = [x for row in image for x in row]
    sr, sc = start
    old = img[sr * cols + sc]
    st = {'img': list(img), 'r': -1, 'c': -1, 'cur': -1, 'd': -1, 'from': -1, 'ok': -1, 'checkText': 'check: —',
          'stack': [], 'calls': [], 'old': old}
    trace, emit = recorder(st)
    emit(L('rows, cols ='), f'A {rows} × {cols} image. Fill the region around ({sr}, {sc}) with colour {color}.')
    emit(L('old = image[sr][sc]'), f'old = {old}: the colour being replaced. The region is every cell of colour {old} joined to the start side by side.')
    emit(L('if old == color'), f'{old} is not {color}, so there is work to do (filling with the same colour would never stop marking).')

    def fill(r, c, site, caller):
        inside = 0 <= r < rows and 0 <= c < cols
        st['stack'] = st['stack'] + [f'({r}, {c})']; st['calls'] = st['calls'] + [site]
        st.update(r=r, c=c, cur=r * cols + c if inside else -1, d=-1, **{'from': caller})
        why = 'off the image' if not inside else (f'colour {st["img"][r * cols + c]}, not {old}' if st['img'][r * cols + c] != old else '')
        st['ok'] = 0 if why else 1
        st['checkText'] = ('✗ ' + why) if why else f'✓ colour {old}: fill it'
        emit(L('if not (0 <= r < rows'), f'fill({r}, {c}): ' + (f'{why}, so return at once.' if why else f'colour {old}, part of the region.'))
        if why:
            emit(line_of(GRID_SOURCE, 'return', 'def fill'), f'Back out of fill({r}, {c}).')
        else:
            st['img'] = [color if i == r * cols + c else x for i, x in enumerate(st['img'])]
            emit(L('image[r][c] = color'), f'Colour ({r}, {c}) with {color}. It no longer matches {old}, so no other path can enter it again: the colour is the visited mark.')
            for d, (dr, dc) in enumerate(DIRS):
                st.update(r=r, c=c, cur=r * cols + c, d=d, ok=-1, checkText='check: —', **{'from': caller})
                emit(L('fill(r + dr, c + dc)'), f'Try the neighbour in direction ({dr}, {dc}): ({r + dr}, {c + dc}).')
                fill(r + dr, c + dc, L('fill(r + dr, c + dc)'), r * cols + c)
            # A filled call finishes too: shown while it is still on the stack, so each pop is visible.
            st.update(r=r, c=c, cur=r * cols + c, d=-1, ok=-1, checkText='check: —', **{'from': caller})
            back = st['stack'][-2] if len(st['stack']) > 1 else None
            emit(L('for dr, dc in'), f'fill({r}, {c}) has tried all four neighbours: it returns' + (f' to fill{back}.' if back else ', and the fill is complete.'))
        st['stack'] = st['stack'][:-1]; st['calls'] = st['calls'][:-1]

    fill(sr, sc, L('fill(sr, sc)'), -1)
    st.update(r=-1, c=-1, cur=-1, d=-1, ok=-1, checkText='check: —', **{'from': -1})
    filled = sum(1 for a, b in zip(img, st['img']) if a != b)
    emit(line_of(GRID_SOURCE, 'return image', 'fill(sr, sc)'),
         f'Done: {filled} cells filled. The 0 the region encloses is another colour, so it stays; the block of {old}s at the bottom left touches the region only at a corner, and corners are not neighbours, so it keeps its colour too. O(rows × cols).')
    return trace


def grid_bfs_trace(image, start, color):
    """Flood fill by BFS. Per frame: img; r, c and cur, the cell just taken from the queue (−1 none); d, nr, nc
    and nbr, the neighbour being tried (nbr −1 off the image); ok and checkText, as in the DFS run; queue as
    "(r, c)" texts, front first."""
    rows, cols = len(image), len(image[0])
    L = lambda t: line_of(GRID_SOURCE, t, 'def flood_fill_bfs')
    img = [x for row in image for x in row]
    sr, sc = start
    old = img[sr * cols + sc]
    at = lambda r, c: r * cols + c
    st = {'img': list(img), 'r': -1, 'c': -1, 'cur': -1, 'd': -1, 'nr': -1, 'nc': -1, 'nbr': -1, 'ok': -1,
          'checkText': 'check: —', 'queue': [], 'old': old}
    trace, emit = recorder(st)
    paint = lambda i: [color if j == i else x for j, x in enumerate(st['img'])]
    emit(L('rows, cols ='), f'The same image, filled level by level from ({sr}, {sc}).')
    emit(L('old = image[sr][sc]'), f'old = {old}.')
    emit(L('if old == color'), f'{old} is not {color}: there is work to do.')
    st['img'] = paint(at(sr, sc))
    emit(L('image[sr][sc] = color'), f'Paint the start as it joins the queue: as in BFS, a cell is marked when queued, so it is never queued twice.')
    q = [(sr, sc)]; st['queue'] = [f'({sr}, {sc})']
    emit(L('queue = deque'), 'The queue holds the cells painted but not yet expanded.')
    while q:
        st.update(r=-1, c=-1, cur=-1, d=-1, nr=-1, nc=-1, nbr=-1, ok=-1, checkText='check: —')
        emit(L('while queue'), f'The queue holds {len(q)} cell{"" if len(q) == 1 else "s"}: keep going.')
        r, c = q.pop(0); st['queue'] = st['queue'][1:]
        st.update(r=r, c=c, cur=at(r, c))
        emit(L('r, c = queue.popleft()'), f'Take ({r}, {c}) from the front.')
        for d, (dr, dc) in enumerate(DIRS):
            nr, nc = r + dr, c + dc
            inside = 0 <= nr < rows and 0 <= nc < cols
            st.update(d=d, nr=nr, nc=nc, nbr=at(nr, nc) if inside else -1, ok=-1, checkText='check: —')
            emit(L('nr, nc = r + dr'), f'Direction ({dr}, {dc}): ({nr}, {nc}).')
            why = 'off the image' if not inside else (f'colour {st["img"][at(nr, nc)]}, not {old}' if st['img'][at(nr, nc)] != old else '')
            st['ok'] = 0 if why else 1
            st['checkText'] = ('✗ ' + why) if why else f'✓ colour {old}: paint and queue it'
            emit(L('if 0 <= nr < rows'), f'({nr}, {nc}) is {why}: skip it.' if why else f'({nr}, {nc}) has colour {old}: part of the region.')
            if not why:
                st['img'] = paint(at(nr, nc))
                emit(L('image[nr][nc] = color'), f'Paint ({nr}, {nc}) now, as it is queued.')
                q.append((nr, nc)); st['queue'] = st['queue'] + [f'({nr}, {nc})']
                emit(L('queue.append((nr, nc))'), f'({nr}, {nc}) joins the back of the queue.')
    st.update(r=-1, c=-1, cur=-1, d=-1, nr=-1, nc=-1, nbr=-1, ok=-1, checkText='check: —')
    emit(L('while queue'), 'The queue is empty.')
    filled = sum(1 for a, b in zip(img, st['img']) if a != b)
    emit(L('return image'), f'Done: the same {filled} cells as the DFS run, reached in rings around the start instead of down one path at a time. O(rows × cols), with a queue in place of the call stack.')
    return trace


def grid_scene(header):
    image, (sr, sc), color = IMAGE, FILL_START, FILL_COLOR
    rows, cols = len(image), len(image[0])
    trace = grid_trace(image, (sr, sc), color)
    bfs_trace = grid_bfs_trace(image, (sr, sc), color)
    L = lambda t: line_of(GRID_SOURCE, t)
    LB = lambda t: line_of(GRID_SOURCE, t, 'def flood_fill_bfs')
    cell = 1.0
    cells = [{'x': round(-5.6 + c * cell, 3), 'y': round(3.5 - r * cell, 3)} for r in range(rows) for c in range(cols)]
    g = lambda col: f"dataTable('cells', idx, '{col}')"
    px = f"arrayAt({tr('img')}, idx)"
    palette = {0: '#3a4a5e', 1: '#9dbde3', 2: '#77bfae', 3: '#b69bea'}
    pal = ' : '.join(f"({px} == {k} ? '{v}'" for k, v in palette.items()) + " : ''" + ')' * len(palette)
    on_stack = f"keyIndex({tr('stack')}, concat('(', floor(idx / {cols}), ', ', mod(idx, {cols}), ')')) >= 0"
    elements = [
        # The image as a graph: one node per pixel, coloured by its value; the call running now gold, calls waiting on
        # the stack outlined by their pink path. The edge from the calling cell to the one being called is lit.
        {'id': 'grid', 'type': 'graph', 'label': 'image', 'lengthExpr': str(rows * cols), 'valueExpr': px,
         'positionExpr': [g('x'), g('y'), '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.88, 'nodeHeight': 0.88, 'nodeCornerRadius': 0.12, 'valueLabel': 'inside', 'showIndices': False,
         'axisLabels': 'plane',
         'colorExpr': f"idx == {tr('cur')} ? '{GOLD}' : ({on_stack} ? '#e67db0' : {pal})",
         'connectTo': {'indexExpr': f"idx == {tr('from')} and {tr('cur')} >= 0 ? {tr('cur')} : -1", 'pinned': True, 'arrow': True,
                       'bendExpr': '0', 'color': '#7f93aa',
                       'colorExpr': f"{tr('ok')} == 1 ? '{GOLD}' : ({tr('ok')} == 0 ? '#e06c75' : '')", 'highlightExpr': 'true'}},
        {'id': 'dirs', 'type': 'array', 'label': 'dirs', 'labelSide': 'left', 'itemType': 'text', 'origin': [2.6, 3.0, 0], 'cellSize': 1.3,
         'values': [f'({dr}, {dc})' for dr, dc in DIRS], 'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane',
         'highlightExpr': f"idx == {tr('d')}"},
        # The recursion: each waiting fill(r, c), outermost first; the top is the call running now.
        {'id': 'calls', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'call stack', 'itemType': 'text', 'origin': [-3.6, -3.1, 0],
         'cellSize': 1.05, 'showTop': False, 'containerColor': '#e67db0',
         'fontSize': 13, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({tr('stack')})", 'valueExpr': f"arrayAt({tr('stack')}, idx)",
         'highlightExpr': f"idx == arrayCount({tr('stack')}) - 1"},
        # The variables box sits right of the grid (labels at one position merge), leaving the bottom to the stack.
        *[{**l, 'position': [7.6, 0.6, 0]} for l in [
        label('rc', f"{tr('r')} == -1 and {tr('c')} == -1 ? '(r, c): —' : concat('(r, c) = (', {tr('r')}, ', ', {tr('c')}, ')')", ['grid', tr('cur')], L('def fill(r, c)'), 'grid-graphs'),
        label('old', f"concat('old = ', {tr('old')})", None, L('old = image[sr][sc]'), 'grid-graphs'),
        {**label('check', tr('checkText'), None, L('if not (0 <= r < rows'), 'grid-graphs'), 'highlightExpr': f"{tr('line')} == {L('if not (0 <= r < rows')}"}]],
    ]
    # The BFS step: the same image, a queue instead of the call stack; the cell just taken gold, queued cells pink.
    b = lambda col: f"dataTable('ff_bfs', frame, '{col}')"
    bpx = f"arrayAt({b('img')}, idx)"
    bpal = ' : '.join(f"({bpx} == {k} ? '{v}'" for k, v in palette.items()) + " : ''" + ')' * len(palette)
    in_queue = f"keyIndex({b('queue')}, concat('(', floor(idx / {cols}), ', ', mod(idx, {cols}), ')')) >= 0"
    bfs_elements = [
        {**elements[0], 'valueExpr': bpx,
         'colorExpr': f"idx == {b('cur')} ? '{GOLD}' : ({in_queue} ? '#e67db0' : {bpal})",
         'connectTo': {'indexExpr': f"idx == {b('cur')} ? {b('nbr')} : -1", 'pinned': True, 'arrow': True, 'bendExpr': '0', 'color': '#7f93aa',
                       'colorExpr': f"{b('ok')} == 1 ? '{GOLD}' : ({b('ok')} == 0 ? '#e06c75' : '')", 'highlightExpr': f"{b('ok')} >= 0"}},
        {**elements[1], 'highlightExpr': f"idx == {b('d')}"},
        # The frontier, front on the left: cells painted but not yet expanded.
        {'id': 'queue', 'type': 'array', 'label': 'queue', 'labelSide': 'left', 'itemType': 'text', 'origin': [-3.6, -3.1, 0],
         'cellSize': 1.05, 'fontSize': 13, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({b('queue')})", 'valueExpr': f"arrayAt({b('queue')}, idx)",
         'highlightExpr': f"idx == arrayCount({b('queue')}) - 1 and {b('line')} == {LB('queue.append((nr, nc))')}"},
        *[{**l, 'position': [7.6, 0.6, 0]} for l in [
            label('rc', f"{b('r')} < 0 ? '(r, c): —' : concat('(r, c) = (', {b('r')}, ', ', {b('c')}, ')')", ['grid', b('cur')], LB('r, c = queue.popleft()'), 'grid-graphs'),
            label('nrnc', f"{b('d')} < 0 ? '(nr, nc): —' : concat('(nr, nc) = (', {b('nr')}, ', ', {b('nc')}, ')')", ['grid', b('nbr')], LB('nr, nc = r + dr'), 'grid-graphs'),
            label('old', f"concat('old = ', {b('old')})", None, LB('old = image[sr][sc]'), 'grid-graphs'),
            {**label('check', b('checkText'), None, LB('if 0 <= nr < rows'), 'grid-graphs'), 'highlightExpr': f"{b('line')} == {LB('if 0 <= nr < rows')}"}]],
    ]
    return run_scene('grid-graphs', 'A grid is a graph (islands, flood fill)', header, f"""**Signal:** a 2D grid of cells, with moves up, down, left and right: flood fill, islands, mazes, rotting oranges.

A grid **is** a graph, just not written as one: every cell is a node, and two cells are joined when they touch side by side. There is no adjacency list to build. The neighbours of `(r, c)` come from four offsets, `(1, 0)`, `(-1, 0)`, `(0, 1)` and `(0, -1)`, and a test: inside the grid, and the right kind of cell. Every traversal from the earlier scenes then works unchanged.

This run is **flood fill** (the paint bucket): recolour every cell of the start's colour that is joined to it side by side. It is a DFS. `fill(r, c)` returns at once when the cell is off the image or a different colour; otherwise it paints the cell and calls itself on the four neighbours. Painting the cell **is** the visited mark: it no longer matches the old colour, so no path enters it twice.

Gold is the call running now, pink cells wait on the call stack, and the edge from the calling cell to the one being called is lit gold when it is filled and red when the call returns at once. Two kinds of cell are left alone: the **0 the region encloses** (another colour, so `fill` returns at once), and the **block of 1s at the bottom left**, which touches the region only at a corner: corners are not neighbours.

**The BFS version** (next step) fills the same cells with a queue instead of the call stack: each cell is painted as it is **queued**, so it is never queued twice, and the region grows in rings around the start rather than down one path at a time. Either works for flood fill; BFS also avoids deep recursion on large images.

**Variations:**
- **Islands** (count groups of 1s): flood fill from every unvisited land cell; each fill is one island. The patterns lesson plays it.
- **Shortest path in a maze:** BFS, since it reaches cells in order of distance; DFS would not.
- **Multi-source BFS** (rotting oranges, distance to the nearest gate): every source starts in the queue at distance 0.
- **Diagonal moves:** eight offsets instead of four.

**Cost:** each cell is painted once and tries 4 neighbours: O(rows × cols) time, and up to O(rows × cols) recursion depth, which an explicit stack avoids on large images.

**Practice:** Flood Fill, Number of Islands, Max Area of Island, Surrounded Regions, Rotting Oranges, Shortest Path in Binary Matrix.""",
        'Explain how a grid is a graph with neighbours from four offsets, and how flood fill uses the new colour as its visited mark. Ask the learner to predict which calls return at once and why, and why the enclosed 0 and the bottom-left block stay unfilled.',
        'flood_fill.py', GRID_SOURCE, trace, elements,
        data={'cells': cells}, call_entry=line_of(GRID_SOURCE, 'def fill(r, c)'),
        first={'title': 'Flood fill by DFS (recursion)', 'description': 'Flood fill with a recursive DFS: one path deep, then back up.'},
        more=[{'id': 'bfs', 'title': 'Flood fill by BFS (queue)', 'description': 'The same fill with a queue: the region grows in rings.',
               'table': 'ff_bfs', 'trace': bfs_trace, 'elements': bfs_elements}])


# ── 6. Is there a cycle? DFS with three states on a directed graph, then DFS that skips its parent on an undirected one ──
CYCLE_SOURCE = """from collections import deque

def has_cycle(n, adj):
    state = [0] * n  # 0 new, 1 on the path, 2 done

    def dfs(u):
        state[u] = 1
        for v in adj[u]:
            if state[v] == 1:
                return True
            if state[v] == 0 and dfs(v):
                return True
        state[u] = 2
        return False

    for u in range(n):
        if state[u] == 0 and dfs(u):
            return True
    return False

def has_cycle_undirected(n, adj):
    visited = [False] * n

    def dfs(u, parent):
        visited[u] = True
        for v in adj[u]:
            if v == parent:
                continue
            if visited[v] or dfs(v, u):
                return True
        return False

    for u in range(n):
        if not visited[u] and dfs(u, -1):
            return True
    return False

def has_cycle_kahn(n, adj):
    indeg = [0] * n
    for u in range(n):
        for v in adj[u]:
            indeg[v] += 1
    queue = deque(u for u in range(n) if indeg[u] == 0)
    taken = 0
    while queue:
        u = queue.popleft()
        taken += 1
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    return taken < n"""
# Directed: 3 → 2 reaches a finished node (not a cycle) before 3 → 4 → 5 → 3 closes one.
CYC_N, CYC_EDGES = 6, [(0, 1), (1, 2), (0, 3), (3, 2), (3, 4), (4, 5), (5, 3)]
CYC_POS = [(-5.6, 2.0), (-3.6, 3.3), (-1.6, 3.3), (-3.6, 0.7), (-1.6, 0.7), (-2.6, -0.8)]
# Undirected: the walk back to the parent is not a cycle; 3 – 4 – 5 – 3 is.
UND_N, UND_EDGES = 6, [(0, 1), (1, 2), (1, 3), (3, 4), (4, 5), (5, 3)]


def cycle_trace(n, edges, directed):
    """DFS cycle detection. Per frame: u (the call running, −1 none), v and vi (the neighbour and its place in
    adj[u], −1 none), adjU and vTip; state (directed: 0 new, 1 on the path, 2 done; undirected: 0/1 visited, with
    on-path nodes as 1 too) and path (the nodes of the calls not yet returned); parent (undirected); checkText;
    calls (call-site lines); kids0 … (the DFS tree); cyc (the edges of the cycle found, as [u, v] pairs) and
    result."""
    fn = 'def has_cycle(' if directed else 'def has_cycle_undirected('
    lines = CYCLE_SOURCE.split('\n')
    def L(text, after=None):
        # The line holding text inside this function; after (a text) starts the search at the line holding it.
        i = next(k for k, l in enumerate(lines) if fn in l)
        if after: i = next(k for k, l in enumerate(lines) if k >= i and after in l)
        return next(k + 1 for k, l in enumerate(lines) if k >= i and text in l)
    adj = [[] for _ in range(n)]
    for a, b in edges:
        adj[a].append(b)
        if not directed: adj[b].append(a)
    adj = [a if directed else sorted(a) for a in adj]
    st = {'u': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'state': [0] * n, 'path': [], 'parent': -1, 'checkText': 'check: —',
          'calls': [], **{f'kids{i}': [] for i in range(n)}, 'cyc': [], 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    setstate = lambda i, k: [k if j == i else x for j, x in enumerate(st['state'])]
    emit(L('state = [0]' if directed else 'visited = [False]'), 'Every node starts new.' if directed else 'No node visited yet.')

    def dfs(u, parent, site):
        st['path'] = st['path'] + [u]; st['calls'] = st['calls'] + [site]
        st.update(u=u, v=-1, vi=-1, adjU=adj[u], parent=parent, checkText='check: —')
        st['state'] = setstate(u, 1)
        emit(L('state[u] = 1' if directed else 'visited[u] = True'),
             f'Visit {u}: it is on the current path now.' if directed else f'Visit {u}' + (f', reached from {parent}.' if parent >= 0 else '.'))
        for vi, v in enumerate(adj[u]):
            st.update(u=u, v=v, vi=vi, adjU=adj[u], parent=parent)
            emit(L('for v in adj[u]'), f'Edge {u} → {v}.' if directed else f'Edge {u} – {v}.')
            if directed:
                on_path, new = st['state'][v] == 1, st['state'][v] == 0
                st['checkText'] = (f'state[{v}] = 1: on the path' if on_path else f'state[{v}] = {st["state"][v]}: ' + ('new' if new else 'done, no loop through it'))
                emit(L('if state[v] == 1'), f'{v} is on the current path: {u} → {v} leads back into it. A cycle!' if on_path
                     else (f'{v} is new.' if new else f'{v} is done: everything reachable from it was explored and returned, so this edge closes no loop.'))
                if on_path: return close(u, v)
                if not new: continue
                st['checkText'] = f'state[{v}] == 0: explore {v}'
                emit(L('if state[v] == 0 and dfs(v)'), f'Go deeper: call dfs({v}).')
                st[f'kids{u}'] = st[f'kids{u}'] + [v]
                if dfs(v, u, L('if state[v] == 0 and dfs(v)')): return unwind(u)
            else:
                if v == parent:
                    st['checkText'] = f'{v} is the parent: skip'
                    emit(L('if v == parent'), f'{v} is where {u} was reached from: the same edge walked back, not a cycle. Skip it.')
                    emit(L('continue'), 'Next neighbour.')
                    continue
                seen = st['state'][v] == 1
                st['checkText'] = f'visited[{v}] = True: a second way in' if seen else f'visited[{v}] = False: explore it'
                emit(L('if visited[v] or dfs(v, u)'), f'{v} was visited already, and not through this edge: a second way to reach it. A cycle!' if seen
                     else f'{v} is new: call dfs({v}, {u}).')
                if seen: return close(u, v)
                st[f'kids{u}'] = st[f'kids{u}'] + [v]
                if dfs(v, u, L('if visited[v] or dfs(v, u)')): return unwind(u)
        st.update(u=u, v=-1, vi=-1, adjU=adj[u], parent=parent, checkText='check: —')
        if directed:
            st['state'] = setstate(u, 2)
            emit(L('state[u] = 2'), f'Every edge out of {u} is explored: {u} is done.')
        emit(L('return False'), f'dfs({u}) found no cycle below {u}.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        back = st['path'][-1] if st['path'] else -1
        st.update(u=back, v=-1, vi=-1, adjU=adj[back] if back >= 0 else [])
        return False

    def close(u, v):
        # The cycle: the path from v down to u, then the edge u → v.
        p = st['path']; loop = p[p.index(v):]
        st['cyc'] = [[loop[k], loop[k + 1]] for k in range(len(loop) - 1)] + [[u, v]]
        emit(L('return True'), f'The cycle: {(" → " if directed else " – ").join(map(str, loop + [v]))}. Return True.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        return True

    def unwind(u):
        st.update(u=u, v=-1, vi=-1, adjU=adj[u])
        emit(L('return True', 'dfs(v)' if directed else 'dfs(v, u)'), f'dfs({u}) passes True back up.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        return True

    for s0 in range(n):
        st.update(u=-1, v=-1, vi=-1, adjU=[])
        if st['state'][s0]:
            continue
        emit(L('for u in range(n)'), f'Start a search from {s0}.')
        if dfs(s0, -1, L('dfs(u)' if directed else 'dfs(u, -1)', 'for u in range(n)')):
            st.update(u=-1, v=-1, vi=-1, adjU=[], result='True')
            emit(L('return True', 'for u in range(n)'), 'There is a cycle. O(V + E): each node and edge is looked at once.')
            return trace, adj
    st['result'] = 'False'
    emit(L('return False', 'for u in range(n)'), 'No cycle.')
    return trace, adj


def kahn_cycle_trace(n, edges):
    """Cycle check by indegree counting (Kahn). Per frame: u, v, vi, adjU, vTip as in the DFS runs; indeg, queue,
    taken (how many nodes came off the queue) and removed (which); checkText; left, 1 on the last frames, when the
    nodes never taken (and the edges among them) are the ones on or behind a cycle; result."""
    L = lambda t, a=None: line_of(CYCLE_SOURCE, t, a or 'def has_cycle_kahn(')
    adj = [[] for _ in range(n)]
    for a, b in edges: adj[a].append(b)
    st = {'u': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'indeg': [0] * n, 'queue': [], 'taken': 0, 'removed': [],
          'checkText': 'check: —', 'left': 0, 'counted': [], 'used': [], 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    emit(L('indeg = [0] * n'), 'indeg[v] counts the edges coming into v: the things v still waits for.')
    for u in range(n):
        for vi, v in enumerate(adj[u]):
            st['indeg'] = [x + 1 if i == v else x for i, x in enumerate(st['indeg'])]
            st['counted'] = st['counted'] + [[u, v]]
            st.update(u=u, v=v, vi=vi, adjU=adj[u])
            emit(L('indeg[v] += 1'), f'Edge {u} → {v}: indeg[{v}] = {st["indeg"][v]}.')
    st.update(u=-1, v=-1, vi=-1, adjU=[])
    st['queue'] = [u for u in range(n) if st['indeg'][u] == 0]
    emit(L('queue = deque('), f'Nodes with nothing coming in can go first: {", ".join(map(str, st["queue"]))}.')
    emit(L('taken = 0'), 'taken counts the nodes that come off the queue.')
    while st['queue']:
        emit(L('while queue'), f'The queue holds {", ".join(map(str, st["queue"]))}.')
        u = st['queue'][0]; st['queue'] = st['queue'][1:]
        st.update(u=u, v=-1, vi=-1, adjU=adj[u], checkText='check: —')
        emit(L('u = queue.popleft()'), f'Take {u}: everything it waits for is done.')
        st['taken'] += 1; st['removed'] = st['removed'] + [u]
        emit(L('taken += 1'), f'taken = {st["taken"]}.')
        for vi, v in enumerate(adj[u]):
            st.update(v=v, vi=vi)
            emit(L('for v in adj[u]', 'taken += 1'), f'Edge {u} → {v}.')
            st['indeg'] = [x - 1 if i == v else x for i, x in enumerate(st['indeg'])]
            st['used'] = st['used'] + [[u, v]]
            emit(L('indeg[v] -= 1'), f'{u} is done, so {v} waits for one thing fewer: indeg[{v}] = {st["indeg"][v]}.')
            free = st['indeg'][v] == 0
            st['checkText'] = f'indeg[{v}] = {st["indeg"][v]}: ' + ('free, queue it' if free else 'still waiting')
            emit(L('if indeg[v] == 0'), f'{v} has nothing left to wait for.' if free else f'{v} still waits for {st["indeg"][v]} more.')
            if free:
                st['queue'] = st['queue'] + [v]
                emit(L('queue.append(v)'), f'Queue {v}.')
        st.update(v=-1, vi=-1, checkText='check: —')
    left = [u for u in range(n) if u not in st['removed']]
    st.update(u=-1, adjU=[], left=1, result='True' if left else 'False')
    emit(L('while queue'), 'The queue is empty.' + (f' {", ".join(map(str, left))} never got free: each still waits on another node that waits too.' if left else ''))
    emit(L('return taken < n'), f'taken = {st["taken"]} < {n}: there is a cycle. Every node never taken lies on a cycle or behind one (2 only waits on 3).'
         if left else f'taken = {n}: every node got free, no cycle.')
    return trace, adj


def cycle_sections():
    """cycle.py's teaching structure: each function split into the steps of its idea."""
    S = lambda *a, **k: section(CYCLE_SOURCE, *a, **k)
    D, U, K = 'def has_cycle(', 'def has_cycle_undirected(', 'def has_cycle_kahn('
    return [
        S('d-init', 'Every node starts new', 'def has_cycle(', 'state = [0]',
          hint='Keep one of three states per node: new, on the current path, or done. All start new.'),
        S('d-enter', 'Enter u: it joins the path', 'def dfs(u)', 'state[u] = 1', D,
          hint='When the search arrives at u, mark it as on the current path.'),
        S('d-edges', 'Follow each edge out of u', 'for v in adj[u]', ('return True', 'and dfs(v)'), D,
          hint='For each neighbour: one already on the path closes a loop; a new one is explored deeper, passing True back up.',
          prompt='Explain this loop over the edges of u: why reaching a node that is on the current path means a cycle, why a node that is done does not, and why the result of the deeper call is passed straight back.'),
        S('d-leave', 'Leave u: it is done', 'state[u] = 2', 'return False', D,
          hint='Once every edge out of u is explored, mark u done: no cycle passes through it.'),
        S('d-roots', 'Start a search from every new node', 'for u in range(n)', 'return False', D,
          hint='The graph may be in pieces: start a search from every node not reached yet.'),
        S('u-init', 'Nothing visited yet', 'def has_cycle_undirected(', 'visited = [False]',
          hint='Undirected edges need only visited or not, plus where each visit came from.'),
        S('u-edges', 'Visit u, skipping the edge back', 'def dfs(u, parent)', 'return False', U,
          hint='Every edge runs both ways: skip the one back to the parent; any other visited neighbour is a second way in.',
          prompt='Explain why the edge back to the parent must be skipped in an undirected graph, and why any other visited neighbour means a cycle.'),
        S('u-roots', 'Start from every unvisited node', 'for u in range(n)', 'return False', U,
          hint='Search each piece of the graph, starting with no parent.'),
        S('k-count', 'Count incoming edges', 'indeg = [0] * n', 'indeg[v] += 1', K,
          hint='For every node, count the edges that point at it: the things it waits for.'),
        S('k-queue', 'Queue the free nodes', 'queue = deque(', 'taken = 0', K,
          hint='Nodes that wait for nothing can be taken now; count how many get taken.'),
        S('k-take', 'Take a node, free its neighbours', 'while queue', 'queue.append(v)', K,
          hint='Take a free node; each edge out of it is one wait fewer for its target, which is queued once it waits for nothing.',
          prompt='Explain this loop: why taking u lowers the indegree of each node it points to, and why a node on a cycle can never reach 0.'),
        S('k-verdict', 'Some node never freed: a cycle', 'return taken < n', None, K,
          hint='If not every node was taken, the ones left wait on each other in a loop.'),
    ]


def cycle_scene(header):
    dtrace, dadj = cycle_trace(CYC_N, CYC_EDGES, True)
    utrace, uadj = cycle_trace(UND_N, UND_EDGES, False)
    LD = lambda t: line_of(CYCLE_SOURCE, t, 'def has_cycle(')
    LU = lambda t: line_of(CYCLE_SOURCE, t, 'def has_cycle_undirected(')

    def elements(c, directed, LL):
        on = lambda k: f"arrayAt({c('state')}, idx) == {k}"
        cur = f"(idx == {c('u')} and to == {c('v')})" + ('' if directed else f" or (idx == {c('v')} and to == {c('u')})")
        incyc = "keyIndex(" + c('cyc') + ", [idx, to]) >= 0" + ('' if directed else " or keyIndex(" + c('cyc') + ", [to, idx]) >= 0")
        done_col = "'#77bfae'"
        return [
            {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(CYC_N), 'valueExpr': 'idx',
             'positionExpr': ["dataTable('cycNodes', idx, 'x')", "dataTable('cycNodes', idx, 'y')", '0'],
             'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
             'colorExpr': f"idx == {c('u')} ? '{GOLD}' : (keyIndex({c('path')}, idx) >= 0 ? '#e67db0' : ({on(2) if directed else on(1)} ? {done_col} : ''))",
             # Every edge; the one being looked at gold, the cycle's edges red once found.
             'connectTo': {'indexExpr': f"dataTable('{'cycNodes' if directed else 'undNodes'}', idx, 'adj')", 'pinned': True, 'arrow': directed,
                           'bendExpr': '0.12' if directed else '0', 'color': '#7f93aa',
                           'colorExpr': f"{incyc} ? '#e06c75' : ({cur} ? '{GOLD}' : '')", 'highlightExpr': f"{incyc} or {cur}"}},
            {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [3.4, 3.0, 0],
             'cellSize': 1.1, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
             'lengthExpr': f"arrayCount({c('adjU')})", 'valueExpr': f"arrayAt({c('adjU')}, idx)", 'highlightExpr': f"idx == {c('vi')}",
             'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8', 'highlightExpr': f"idx == {c('vi')}"},
             'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': c('vi'), 'valueExpr': c('v'), 'visibleExpr': f"{c('vi')} >= 0", 'color': GOLD}]},
            {'id': 'state' if directed else 'visited', 'type': 'array', 'label': 'state' if directed else 'visited', 'labelSide': 'left',
             'origin': [-2.4, -2.4, 0], 'cellSize': 1.15, 'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(CYC_N),
             **({'valueExpr': f"arrayAt({c('state')}, idx)"} if directed else {'itemType': 'text', 'valueExpr': f"{on(1)} ? 'T' : 'F'"}),
             'colorExpr': f"{on(1)} and keyIndex({c('path')}, idx) >= 0 ? '#e67db0' : ({on(2) if directed else on(1)} ? {done_col} : '')",
             'highlightExpr': f"idx == {c('v')}"},
            {'id': 'stack', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'call stack', 'origin': [-2.4, -3.8, 0], 'cellSize': 1.15,
             'showTop': False, 'containerColor': '#e67db0', 'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0',
             'lengthExpr': f"arrayCount({c('path')})", 'valueExpr': f"arrayAt({c('path')}, idx)",
             'highlightExpr': f"idx == arrayCount({c('path')}) - 1"},
            label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], LL('def dfs('), 'cycle-detection'),
            {**label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], LL('for v in adj[u]'), 'cycle-detection'), 'tooltipExpr': c('vTip')},
            {**label('state-v', f"{c('v')} < 0 ? '{'state' if directed else 'visited'}[v]: —' : concat('{'state' if directed else 'visited'}[', {c('v')}, '] = ', "
                     + (f"arrayAt({c('state')}, {c('v')}))" if directed else f"arrayAt({c('state')}, {c('v')}) == 1 ? 'True' : 'False')"),
                     ['state' if directed else 'visited', c('v')], LL('if state[v] == 1' if directed else 'if visited[v]'), 'cycle-detection'),
             'highlightExpr': f"{c('v')} >= 0"},
            *([] if directed else [label('parent', f"{c('parent')} < 0 ? 'parent: —' : concat('parent = ', {c('parent')})", ['graph', c('parent')], LL('def dfs('), 'cycle-detection')]),
            {**label('check', c('checkText'), None, LL('for v in adj[u]') + 1, 'cycle-detection'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
            label('result', f"concat('result: ', {c('result')})", None, LL('return False'), 'cycle-detection'),
        ]

    ktrace, _ = kahn_cycle_trace(CYC_N, CYC_EDGES)
    LK = lambda t: line_of(CYCLE_SOURCE, t, 'def has_cycle_kahn(')
    k = lambda col: f"dataTable('cyc_kahn', frame, '{col}')"
    gone = lambda i: f"keyIndex({k('removed')}, {i}) >= 0"
    kahn = [
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(CYC_N), 'valueExpr': 'idx',
         'positionExpr': ["dataTable('cycNodes', idx, 'x')", "dataTable('cycNodes', idx, 'y')", '0'],
         'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
         # Gold the node taken, pale the ones peeled off, pink the queued; at the end red the ones never freed.
         'colorExpr': f"idx == {k('u')} ? '{GOLD}' : ({gone('idx')} ? {PALE} : (keyIndex({k('queue')}, idx) >= 0 ? '#e67db0' : ({k('left')} == 1 ? '#e06c75' : '')))",
         # An edge out of a taken node is used up: dim it. At the end, the edges among the nodes never taken turn red.
         'connectTo': {'indexExpr': "dataTable('cycNodes', idx, 'adj')", 'pinned': True, 'arrow': True, 'bendExpr': '0.12', 'color': '#7f93aa',
                       'colorExpr': f"idx == {k('u')} and to == {k('v')} ? '{GOLD}' : ({gone('idx')} ? '#3d4858' : ({k('left')} == 1 ? '#e06c75' : ''))",
                       'highlightExpr': f"(idx == {k('u')} and to == {k('v')}) or ({k('left')} == 1 and not ({gone('idx')}))",
                       **edge_counts(k)}},
        {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [3.4, 3.0, 0],
         'cellSize': 1.1, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
         'lengthExpr': f"arrayCount({k('adjU')})", 'valueExpr': f"arrayAt({k('adjU')}, idx)", 'highlightExpr': f"idx == {k('vi')}",
         'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8', 'highlightExpr': f"idx == {k('vi')}"},
         'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': k('vi'), 'valueExpr': k('v'), 'visibleExpr': f"{k('vi')} >= 0", 'color': GOLD}]},
        {'id': 'indeg', 'type': 'array', 'label': 'indeg', 'codeSymbol': 'indeg', 'labelSide': 'left', 'origin': [-2.4, -2.4, 0], 'cellSize': 1.15,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(CYC_N), 'valueExpr': f"arrayAt({k('indeg')}, idx)",
         'colorExpr': f"{gone('idx')} ? {PALE} : ({k('left')} == 1 ? '#e06c75' : '')", 'highlightExpr': f"idx == {k('v')}"},
        {'id': 'queue', 'type': 'array', 'label': 'queue', 'codeSymbol': 'queue', 'labelSide': 'left', 'origin': [-2.4, -3.8, 0], 'cellSize': 1.15,
         'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0', 'showIndices': False,
         'lengthExpr': f"arrayCount({k('queue')})", 'valueExpr': f"arrayAt({k('queue')}, idx)",
         'highlightExpr': f"idx == arrayCount({k('queue')}) - 1 and {k('line')} == {LK('queue.append(v)')}"},
        label('u', f"{k('u')} < 0 ? 'u: —' : concat('u = ', {k('u')})", ['graph', k('u')], LK('u = queue.popleft()'), 'cycle-detection'),
        {**label('v', f"{k('v')} < 0 ? 'v: —' : concat('v = ', {k('v')})", ['graph', k('v')], LK('for v in adj[u]'), 'cycle-detection'), 'tooltipExpr': k('vTip')},
        label('n', "'n = %d'" % CYC_N, None, LK('def has_cycle_kahn('), 'cycle-detection'),
        {**label('indeg-v', f"{k('v')} < 0 ? 'indeg[v]: —' : concat('indeg[', {k('v')}, '] = ', arrayAt({k('indeg')}, {k('v')}))",
                 ['indeg', k('v')], LK('indeg[v] -= 1'), 'cycle-detection'), 'highlightExpr': f"{k('v')} >= 0"},
        label('queue-len', f"concat('len(queue) = ', arrayCount({k('queue')}))", ['queue', '0'], LK('while queue'), 'cycle-detection'),
        label('taken', f"concat('taken = ', {k('taken')})", None, LK('taken += 1'), 'cycle-detection'),
        {**label('taken-n', f"concat('taken < n: ', {k('taken')}, ' < {CYC_N} → ', ({k('taken')} < {CYC_N} ? 'True' : 'False'))",
                 None, LK('return taken < n'), 'cycle-detection'), 'highlightExpr': f"{k('left')} == 1"},
        {**label('check', k('checkText'), None, LK('if indeg[v] == 0'), 'cycle-detection'), 'highlightExpr': f"{k('checkText')} != 'check: —'"},
        label('result', f"concat('result: ', {k('result')})", None, LK('return taken < n'), 'cycle-detection'),
    ]
    pos = lambda adj: [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(CYC_POS, adj)]
    return run_scene('cycle-detection', 'Is there a cycle?', header, """**Signal:** can every task finish, is this graph a tree, deadlock, or a "redundant" edge that closes a loop.

A cycle is a path that leads back to where it started. DFS finds one by noticing an edge that leads **back into the current path**; what counts as "back" depends on whether edges have a direction.

## 1. Directed graph: three states (this step)

Each node is **new** (0), **on the current path** (1, pink) or **done** (2, teal). Reaching a node that is on the path means the path loops back into itself: a cycle. Reaching a node that is **done** is not one: everything reachable from it was explored and returned. The graph shows both: `3 → 2` meets a finished node, then `3 → 4 → 5 → 3` closes a loop, drawn red. Two states (just "visited") would wrongly call `3 → 2` a cycle.

## 2. Undirected graph: skip the parent (next step)

Every edge appears in both directions, so the walk straight back to the node you came from is not a cycle: skip the **parent**. Any other already-visited neighbour is a second way in, so it closes a cycle. (Union-find spots the same thing as edges arrive: an edge whose ends are already joined closes a loop.)

## 3. Directed graph: count indegrees (third step)

No recursion: count each node's incoming edges (**indegree**, the things it waits for), queue the nodes with none, and take them one by one; taking u frees each v it points to by one. A node on a cycle waits on the node before it, which waits on it in turn, so its indegree never reaches 0: it is never taken. **taken < n means a cycle.** This is the topological sort's queue (Kahn's algorithm) used as a test; the nodes left over are on a cycle or behind one (here 2, waiting on 3). It tells whether there is a cycle, not which edges form it; DFS finds the loop itself.

A graph is a **tree** exactly when it is connected and has no cycle: equivalently, connected with V − 1 edges.

**Cost:** O(V + E) for all three: each node is visited once and each edge looked at once (twice when undirected).

**Practice:** Course Schedule, Find Eventual Safe States, Graph Valid Tree, Redundant Connection.""",
        'Explain why a directed cycle needs three states while an undirected one needs only the parent. Ask the learner to predict, for each edge, whether it closes a cycle.',
        'cycle.py', CYCLE_SOURCE, dtrace, elements(tr, True, LD),
        sections=cycle_sections(),
        data={'cycNodes': pos(dadj), 'undNodes': pos(uadj)}, call_entry=LD('def dfs(u)'),
        first={'title': 'Directed: three states', 'description': 'A node on the current path, reached again, closes a cycle.'},
        more=[{'id': 'undirected', 'title': 'Undirected: skip the parent', 'description': 'Any visited neighbour other than the parent closes a cycle.',
               'table': 'cyc_und', 'trace': utrace, 'call_entry': LU('def dfs(u, parent)'), 'elements': elements(lambda col: f"dataTable('cyc_und', frame, '{col}')", False, LU)},
              {'id': 'indegree', 'title': 'Directed: count indegrees', 'description': 'Peel off nodes with nothing left to wait for; what never frees up is stuck on a cycle.',
               'table': 'cyc_kahn', 'trace': ktrace, 'elements': kahn}])


# ── 7. Two teams: colour by BFS, the opposite team for every neighbour; an odd cycle forces a clash ──
BIP_SOURCE = """from collections import deque

def is_bipartite(n, adj):
    color = [-1] * n  # -1 no team yet, 0 and 1 the two teams

    for s in range(n):
        if color[s] != -1:
            continue
        color[s] = 0
        queue = deque([s])
        while queue:
            u = queue.popleft()
            for v in adj[u]:
                if color[v] == -1:
                    color[v] = 1 - color[u]
                    queue.append(v)
                elif color[v] == color[u]:
                    return False
    return True

def is_bipartite_dfs(n, adj):
    color = [-1] * n

    def dfs(u, c):
        color[u] = c
        for v in adj[u]:
            if color[v] == -1:
                if not dfs(v, 1 - c):
                    return False
            elif color[v] == c:
                return False
        return True

    for s in range(n):
        if color[s] == -1 and not dfs(s, 0):
            return False
    return True"""
BIP_N = 7
# Two teams: a square with a tail, and a separate pair (the search starts again there).
BIP_EDGES = [(0, 1), (0, 3), (1, 2), (2, 3), (2, 4), (5, 6)]
# The same square, with 4 joined to 2 and 3: the triangle 2 – 3 – 4 is an odd cycle.
ODD_EDGES = [(0, 1), (0, 3), (1, 2), (2, 3), (2, 4), (3, 4), (5, 6)]
TEAM = ['#6ea8e0', '#e5a65c']
# Rows: a node waits on the top row until it gets a team, then drops to its team's row, so the split shows as
# two rows with every edge running between them (an edge inside a row is a clash).
BIP_ROWS = {-1: 3.6, 0: 1.6, 1: -0.4}


def bipartite_trace(n, edges):
    """BFS two-colouring. Per frame: s (the search's start, −1 none), u, v, vi, adjU, vTip; color (−1 none, 0, 1);
    queue; checkText; odd (the edges of the odd cycle found, as [a, b] pairs) and result."""
    L = lambda t, a=None: line_of(BIP_SOURCE, t, a)
    adj = [[] for _ in range(n)]
    for a, b in edges: adj[a].append(b); adj[b].append(a)
    adj = [sorted(a) for a in adj]
    st = {'s': -1, 'u': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'color': [-1] * n, 'queue': [], 'checkText': 'check: —',
          'odd': [], 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    paint = lambda i, k: [k if j == i else x for j, x in enumerate(st['color'])]
    name = lambda k: 'team 0 (blue)' if k == 0 else 'team 1 (orange)'
    emit(L('color = [-1] * n'), 'Nobody is on a team yet.')
    for s in range(n):
        st.update(s=s, u=-1, v=-1, vi=-1, adjU=[], checkText='check: —')
        emit(L('for s in range(n)'), f'Is {s} on a team?')
        if st['color'][s] != -1:
            emit(L('continue'), f'{s} already is: it was reached from an earlier start.')
            continue
        st['color'] = paint(s, 0)
        emit(L('color[s] = 0'), f'{s} has no team: a new piece of the graph. Put {s} on {name(0)}; either team would do.')
        st['queue'] = [s]
        emit(L('queue = deque([s])'), f'Queue {s}: its neighbours get the other team.')
        while st['queue']:
            emit(L('while queue'), f'The queue holds {", ".join(map(str, st["queue"]))}.')
            u = st['queue'][0]; st['queue'] = st['queue'][1:]
            st.update(u=u, v=-1, vi=-1, adjU=adj[u], checkText='check: —')
            emit(L('u = queue.popleft()'), f'Take {u}, on {name(st["color"][u])}.')
            for vi, v in enumerate(adj[u]):
                st.update(v=v, vi=vi)
                emit(L('for v in adj[u]'), f'Edge {u} – {v}.')
                cu, cv = st['color'][u], st['color'][v]
                if cv == -1:
                    st['checkText'] = f'color[{v}] = -1: no team yet'
                    emit(L('if color[v] == -1'), f'{v} has no team yet.')
                    st['color'] = paint(v, 1 - cu)
                    emit(L('color[v] = 1 - color[u]'), f'{v} goes on the other team from {u}: {name(1 - cu)}.')
                    st['queue'] = st['queue'] + [v]
                    emit(L('queue.append(v)'), f'Queue {v}.')
                    continue
                st['checkText'] = f'color[{v}] = {cv}: ' + ('same team as u!' if cv == cu else 'other team, fine')
                emit(L('if color[v] == -1'), f'{v} already has a team: {name(cv)}.')
                emit(L('elif color[v] == color[u]'), f'{u} and {v} are on the same team, yet an edge joins them. No split can work.' if cv == cu
                     else f'{u} and {v} are on opposite teams: this edge is fine.')
                if cv == cu:
                    loop = shortest_odd_cycle(adj, u, v)
                    st['odd'] = [[loop[k], loop[k + 1]] for k in range(len(loop) - 1)] + [[loop[-1], loop[0]]]
                    st['result'] = 'False'
                    emit(L('return False'), f'The odd cycle: {" – ".join(map(str, loop + [loop[0]]))}, {len(loop)} edges. '
                         'Around a cycle the teams must alternate, and an odd one cannot: not bipartite.')
                    return trace, adj
            st.update(v=-1, vi=-1, checkText='check: —')
    st.update(s=-1, u=-1, adjU=[], result='True')
    emit(L('return True'), 'Every edge joins the two teams: bipartite. O(V + E): each node and edge looked at once (each edge from both ends).')
    return trace, adj


def dfs_line(text, after=None):
    """The line of text inside is_bipartite_dfs, searched from the line holding after (inside it too) when given:
    the BFS version above repeats many of its lines."""
    lines = BIP_SOURCE.split('\n')
    k = next(i for i, l in enumerate(lines) if 'def is_bipartite_dfs(' in l)
    if after: k = next(i for i, l in enumerate(lines) if i >= k and after in l)
    return next(i + 1 for i, l in enumerate(lines) if i >= k and text in l)


def bipartite_dfs_trace(n, edges):
    """Two-colouring by recursive DFS. Per frame: s, u (the call running), c (its team), v, vi, adjU, vTip; color;
    path (the calls not yet returned) and calls (their call-site lines, for the Code panel's call arrows); checkText; odd
    and result, as in the BFS run."""
    L = lambda t, a=None: dfs_line(t, a)
    adj = [[] for _ in range(n)]
    for a, b in edges: adj[a].append(b); adj[b].append(a)
    adj = [sorted(a) for a in adj]
    st = {'s': -1, 'u': -1, 'c': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'color': [-1] * n, 'path': [], 'calls': [], 'checkText': 'check: —',
          'odd': [], 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    name = lambda k: 'team 0 (blue)' if k == 0 else 'team 1 (orange)'
    emit(L('color = [-1] * n'), 'Nobody is on a team yet.')

    def dfs(u, c, site):
        st['path'] = st['path'] + [u]; st['calls'] = st['calls'] + [site]
        st.update(u=u, c=c, v=-1, vi=-1, adjU=adj[u], checkText='check: —')
        st['color'] = [c if j == u else x for j, x in enumerate(st['color'])]
        emit(L('color[u] = c'), f'dfs({u}, {c}): {u} joins {name(c)}.')
        for vi, v in enumerate(adj[u]):
            st.update(u=u, c=c, v=v, vi=vi, adjU=adj[u])
            emit(L('for v in adj[u]'), f'Edge {u} – {v}.')
            cv = st['color'][v]
            if cv == -1:
                st['checkText'] = f'color[{v}] = -1: no team yet'
                emit(L('if color[v] == -1'), f'{v} has no team yet.')
                emit(L('if not dfs(v, 1 - c)'), f'Go deeper: {v} must be on the other team, so call dfs({v}, {1 - c}).')
                if not dfs(v, 1 - c, L('if not dfs(v, 1 - c)')):
                    st.update(u=u, c=c, v=v, vi=vi, adjU=adj[u])
                    emit(L('return False', 'if not dfs(v, 1 - c)'), f'dfs({u}) passes the clash back up: False.')
                    st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
                    return False
                st.update(u=u, c=c, v=v, vi=vi, adjU=adj[u], checkText='check: —')
                emit(L('if not dfs(v, 1 - c)'), f'dfs({v}) came back True: back in {u}.')
                continue
            st['checkText'] = f'color[{v}] = {cv}: ' + ('same team as u!' if cv == c else 'other team, fine')
            emit(L('if color[v] == -1'), f'{v} already has a team: {name(cv)}.')
            emit(L('elif color[v] == c'), f'{u} and {v} are on the same team, yet an edge joins them.' if cv == c
                 else f'{v} is on the other team: this edge is fine.')
            if cv == c:
                loop = shortest_odd_cycle(adj, u, v)
                st['odd'] = [[loop[k], loop[k + 1]] for k in range(len(loop) - 1)] + [[loop[-1], loop[0]]]
                emit(L('return False', 'elif color[v] == c'), f'The odd cycle: {" – ".join(map(str, loop + [loop[0]]))}. Return False.')
                st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
                return False
        st.update(v=-1, vi=-1, checkText='check: —')
        emit(L('return True', 'elif color[v] == c'), f'Every edge out of {u} checks out: dfs({u}) returns True.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        return True

    for s in range(n):
        st.update(s=s, u=-1, c=-1, v=-1, vi=-1, adjU=[], checkText='check: —')
        if st['color'][s] != -1:
            emit(L('if color[s] == -1 and not dfs(s, 0)'), f'{s} already has a team: skip it.')
            continue
        emit(L('if color[s] == -1 and not dfs(s, 0)'), f'{s} has no team: start a search there, on team 0.')
        if not dfs(s, 0, L('if color[s] == -1 and not dfs(s, 0)')):
            st.update(u=-1, c=-1, v=-1, vi=-1, adjU=[], result='False')
            emit(L('return False', 'for s in range(n)'), 'Not bipartite. The DFS found the same clash as BFS, in a different order.')
            return trace, adj
    st.update(s=-1, u=-1, adjU=[], result='True')
    emit(L('return True', 'for s in range(n)'), 'Every edge joins the two teams: bipartite.')
    return trace, adj


def shortest_odd_cycle(adj, u, v):
    """The shortest cycle through the edge u – v with an odd number of edges: a shortest path from v back to u of
    even length that avoids that edge, by BFS over (node, parity). Returns its nodes in order, from u."""
    from collections import deque
    start, prev = (v, 0), {(v, 0): None}
    queue = deque([start])
    while queue:
        x, par = queue.popleft()
        if (x, par) == (u, 0):
            break
        for y in adj[x]:
            if {x, y} == {u, v} or (y, 1 - par) in prev:
                continue
            prev[(y, 1 - par)] = (x, par)
            queue.append((y, 1 - par))
    path, at = [], (u, 0)
    while at:
        path.append(at[0]); at = prev[at]
    return path   # u … v; the edge v – u closes it


def bipartite_sections():
    S = lambda *a, **k: section(BIP_SOURCE, *a, **k)
    return [
        S('p-init', 'Nobody is on a team yet', 'def is_bipartite(', 'color = [-1]',
          hint='Keep a team per node: -1 for none yet, 0 and 1 for the two teams.'),
        S('p-start', 'Start each untouched piece on team 0', 'for s in range(n)', 'queue = deque([s])',
          hint='The graph may come in pieces: from every node with no team yet, put it on team 0 and start a BFS there.'),
        S('p-spread', 'Each new neighbour joins the other team', 'while queue', 'queue.append(v)',
          hint='Take a node; a neighbour with no team goes on the opposite team and joins the queue.',
          prompt='Explain why the neighbour must go on the opposite team, and why the first choice of team at each start does not matter.'),
        S('p-clash', 'Same team on both ends: not bipartite', 'elif color[v] == color[u]', 'return False',
          hint='A neighbour already on the same team means an edge inside one team: no split works.',
          prompt='Explain why two neighbours on the same team mean an odd cycle, and why an odd cycle can never be split into two teams.'),
        S('p-ok', 'No clash anywhere: two teams', 'return True', None, 'return False',
          hint='If every edge joins the two teams, the colouring is the split.'),
        S('q-init', 'Nobody is on a team yet', 'def is_bipartite_dfs(', 'color = [-1]',
          hint='The same team per node as the BFS version.'),
        S('q-enter', 'Join the team you are given', 'def dfs(u, c)', 'color[u] = c', 'def is_bipartite_dfs(',
          hint='The call carries the team: u joins team c.'),
        S('q-edges', 'Each neighbour: go deeper on the other team, or check it', 'for v in adj[u]', ('return False', 'elif color[v] == c'), 'def is_bipartite_dfs(',
          hint='A neighbour with no team is explored on team 1 - c, passing a clash back up; one with a team must not be on team c.',
          prompt='Explain how the recursive call carries the team, why a False from deeper is passed straight back, and how this finds the same clashes as the BFS version.'),
        S('q-done', 'Every edge out of u checks out', 'return True', None, 'def dfs(u, c)',
          hint='No clash below u: return True.'),
        S('q-roots', 'Start each untouched piece on team 0', 'for s in range(n)', 'return True', 'def is_bipartite_dfs(',
          hint='Start a search from every node with no team; any False means not bipartite.'),
    ]


def bipartite_scene(header):
    btrace, badj = bipartite_trace(BIP_N, BIP_EDGES)
    otrace, oadj = bipartite_trace(BIP_N, ODD_EDGES)
    L = lambda t: line_of(BIP_SOURCE, t)

    def elements(c, nodes):
        team = lambda i: f"arrayAt({c('color')}, {i})"
        cur = f"(idx == {c('u')} and to == {c('v')}) or (idx == {c('v')} and to == {c('u')})"
        odd = f"keyIndex({c('odd')}, [idx, to]) >= 0 or keyIndex({c('odd')}, [to, idx]) >= 0"
        fill = lambda i: f"{team(i)} == 0 ? '{TEAM[0]}' : ({team(i)} == 1 ? '{TEAM[1]}' : '')"
        return [
            {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(BIP_N), 'valueExpr': 'idx',
             'positionExpr': [f"dataTable('{nodes}', idx, 'x')",
                              f"{team('idx')} == 0 ? {BIP_ROWS[0]} : ({team('idx')} == 1 ? {BIP_ROWS[1]} : dataTable('{nodes}', idx, 'wait'))", '0'],
             'nodeShape': 'rect', 'nodeWidth': 0.72, 'nodeHeight': 0.72, 'nodeCornerRadius': 0.36, 'valueLabel': 'inside', 'showIndices': False,
             # A node takes its team's colour (the u label points at the one being processed; its edge in turn is gold).
             'colorExpr': fill('idx'),
             'connectTo': {'indexExpr': f"dataTable('{nodes}', idx, 'adj')", 'pinned': True, 'arrow': False, 'color': '#7f93aa',
                           'colorExpr': f"{odd} ? '#e06c75' : ({cur} ? '{GOLD}' : '')", 'highlightExpr': f"{odd} or {cur}"}},
            {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [6.4, 3.0, 0],
             'cellSize': 1.1, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
             'lengthExpr': f"arrayCount({c('adjU')})", 'valueExpr': f"arrayAt({c('adjU')}, idx)", 'highlightExpr': f"idx == {c('vi')}",
             'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8', 'highlightExpr': f"idx == {c('vi')}"},
             'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': c('vi'), 'valueExpr': c('v'), 'visibleExpr': f"{c('vi')} >= 0", 'color': GOLD}]},
            {'id': 'color', 'type': 'array', 'label': 'color', 'codeSymbol': 'color', 'labelSide': 'left', 'origin': [-2.3, -2.4, 0], 'cellSize': 1.15,
             'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(BIP_N), 'valueExpr': f"{team('idx')}",
             'colorExpr': fill('idx'), 'highlightExpr': f"idx == {c('v')}"},
            {'id': 'queue', 'type': 'array', 'label': 'queue', 'codeSymbol': 'queue', 'labelSide': 'left', 'origin': [-2.3, -3.8, 0], 'cellSize': 1.15,
             'fontSize': 15, 'axisLabels': 'plane', 'color': '#8aa0b8', 'showIndices': False,
             'lengthExpr': f"arrayCount({c('queue')})", 'valueExpr': f"arrayAt({c('queue')}, idx)",
             'highlightExpr': f"idx == arrayCount({c('queue')}) - 1 and {c('line')} == {L('queue.append(v)')}"},
            *[{'id': f'row-{k}', 'type': 'text', 'text': t, 'position': [-4.4, y, 0], 'color': col, 'fontSize': 13, 'align': 'right'}
              for k, (t, y, col) in enumerate([('team 0', BIP_ROWS[0], TEAM[0]), ('team 1', BIP_ROWS[1], TEAM[1])])],
            label('s', f"{c('s')} < 0 ? 's: —' : concat('s = ', {c('s')})", ['graph', c('s')], L('for s in range(n)'), 'bipartite'),
            label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], L('u = queue.popleft()'), 'bipartite'),
            {**label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], L('for v in adj[u]'), 'bipartite'), 'tooltipExpr': c('vTip')},
            {**label('color-u', f"{c('u')} < 0 ? 'color[u]: —' : concat('color[', {c('u')}, '] = ', {team(c('u'))})",
                     ['color', c('u')], L('color[v] = 1 - color[u]'), 'bipartite'), 'highlightExpr': f"{c('u')} >= 0"},
            {**label('color-v', f"{c('v')} < 0 ? 'color[v]: —' : concat('color[', {c('v')}, '] = ', {team(c('v'))})",
                     ['color', c('v')], L('if color[v] == -1'), 'bipartite'), 'highlightExpr': f"{c('v')} >= 0"},
            # The other team, as the code computes it for each new neighbour.
            {**label('other', f"{c('u')} < 0 ? '1 - color[u]: —' : concat('1 - color[u] = 1 - ', {team(c('u'))}, ' = ', 1 - {team(c('u'))})",
                     None, L('color[v] = 1 - color[u]'), 'bipartite'), 'highlightExpr': f"{c('line')} == {L('color[v] = 1 - color[u]')}"},
            label('queue-len', f"concat('len(queue) = ', arrayCount({c('queue')}))", ['queue', '0'], L('while queue'), 'bipartite'),
            {**label('check', c('checkText'), None, L('elif color[v] == color[u]'), 'bipartite'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
            label('result', f"concat('result: ', {c('result')})", None, L('return True'), 'bipartite'),
        ]

    dtrace, dadj = bipartite_dfs_trace(BIP_N, ODD_EDGES)
    LD = dfs_line

    def dfs_elements(c, nodes):
        # The BFS view, with the call stack in place of the queue and labels tied to the DFS version's lines.
        keep = [e for e in elements(c, nodes) if e['id'] in ('graph', 'adj-u', 'color', 'row-0', 'row-1')]
        team = lambda i: f"arrayAt({c('color')}, {i})"
        return keep + [
            {'id': 'stack', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'call stack', 'origin': [-2.3, -3.8, 0], 'cellSize': 1.15,
             'showTop': False, 'containerColor': '#e67db0', 'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0',
             'lengthExpr': f"arrayCount({c('path')})", 'valueExpr': f"arrayAt({c('path')}, idx)",
             'highlightExpr': f"idx == arrayCount({c('path')}) - 1"},
            label('s', f"{c('s')} < 0 ? 's: —' : concat('s = ', {c('s')})", ['graph', c('s')], LD('for s in range(n)'), 'bipartite'),
            label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], LD('def dfs(u, c)'), 'bipartite'),
            label('c', f"{c('c')} < 0 ? 'c: —' : concat('c = ', {c('c')})", None, LD('color[u] = c'), 'bipartite'),
            {**label('other', f"{c('c')} < 0 ? '1 - c: —' : concat('1 - c = 1 - ', {c('c')}, ' = ', 1 - {c('c')})",
                     None, LD('if not dfs(v, 1 - c)'), 'bipartite'), 'highlightExpr': f"{c('line')} == {LD('if not dfs(v, 1 - c)')}"},
            {**label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], LD('for v in adj[u]'), 'bipartite'), 'tooltipExpr': c('vTip')},
            {**label('color-v', f"{c('v')} < 0 ? 'color[v]: —' : concat('color[', {c('v')}, '] = ', {team(c('v'))})",
                     ['color', c('v')], LD('if color[v] == -1'), 'bipartite'), 'highlightExpr': f"{c('v')} >= 0"},
            {**label('check', c('checkText'), None, LD('elif color[v] == c'), 'bipartite'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
            label('result', f"concat('result: ', {c('result')})", None, LD('return True', 'for s in range(n)'), 'bipartite'),
        ]

    def pos(trace, adj):
        # Each node's column: the order the run gives it a team, so a row reads in BFS order and nodes never share a column.
        first = lambda i: next((k for k, f in enumerate(trace) if f['color'][i] != -1), len(trace))
        order = sorted(range(BIP_N), key=first)
        # On the top row the nodes zigzag up and down a little, so the edges among them stand apart.
        return [{'x': -3.8 + order.index(i) * 1.0, 'wait': BIP_ROWS[-1] + (0.45 if order.index(i) % 2 else -0.15), 'adj': a}
                for i, a in enumerate(adj)]
    return run_scene('bipartite', 'Two teams (bipartite check)', header, """**Signal:** split the nodes into two groups so that every edge runs between the groups: two-colouring, "possible bipartition", people who dislike each other in different rooms.

A graph is **bipartite** when its nodes fit on two teams with no edge inside a team. You don't have to search for the split: **the first choice forces everything else.** Put one node on team 0; each neighbour must then be on team 1, each of theirs on team 0, and so on. BFS (or DFS) spreads that rule outwards.

## 1. Colour by BFS (this step)

`color[v]` is `-1` until `v` gets a team. Taking `u` off the queue, every neighbour with no team joins **the other team**, `1 - color[u]`, and the queue. A neighbour that already has a team is checked: **the other team is fine; the same team is a clash.** Each node waits on the top row until it gets a team, then drops to that team's row, so the split builds up as two rows. Here every check passes: when the run ends, **every edge runs between the two rows** and none lies inside one. That picture is what bipartite means.

The graph has two pieces. When the first BFS runs dry, node 5 still has no team, so the outer loop starts a new search there: **every untouched node starts a new piece**, as in counting components.

## 2. An odd cycle (next step)

Join 4 to 3 as well, and the triangle 2 – 3 – 4 appears. Around a cycle the teams must alternate, blue, orange, blue, …, which only closes up when the cycle has an **even** number of edges. On a cycle of 3, the third node meets a neighbour on its own team: an edge **inside a row**, the clash, drawn red with the cycle it closes.

**A graph is bipartite exactly when it has no odd cycle.** Trees and grids always are; anything with a triangle is not.

## 3. Colour by DFS (third step)

The rule doesn't care about order, so DFS works as well as BFS. The recursive call carries the team: `dfs(u, c)` puts `u` on team `c` and calls `dfs(v, 1 - c)` for each neighbour with no team. A clash returns `False`, and every call waiting on the stack passes it straight back up. On the odd graph, DFS walks 0 → 1 → 2 → 3 → 4 and meets the same clash, 4 – 2, from the other end.

**Cost:** O(V + E): each node is coloured once and each edge checked from both ends.

**Practice:** Is Graph Bipartite?, Possible Bipartition.""",
        'Explain why the first team choice forces every other node, and why an odd cycle makes a clash unavoidable. Ask the learner to predict each new node\'s team, and on the second graph, which edge will clash.',
        'bipartite.py', BIP_SOURCE, btrace, elements(tr, 'bipNodes'),
        sections=bipartite_sections(),
        data={'bipNodes': pos(btrace, badj), 'oddNodes': pos(otrace, oadj), 'dfsNodes': pos(dtrace, dadj)},
        first={'title': 'Colour by BFS', 'description': 'Every neighbour goes on the other team.'},
        more=[{'id': 'odd', 'title': 'An odd cycle: a clash', 'description': 'A cycle of three cannot alternate two teams.',
               'table': 'bip_odd', 'trace': otrace, 'elements': elements(lambda col: f"dataTable('bip_odd', frame, '{col}')", 'oddNodes')},
              {'id': 'dfs', 'title': 'Colour by DFS', 'description': 'The same rule, spread by recursion: the call carries the team.',
               'table': 'bip_dfs', 'trace': dtrace, 'call_entry': dfs_line('def dfs(u, c)'), 'elements': dfs_elements(lambda col: f"dataTable('bip_dfs', frame, '{col}')", 'dfsNodes')}])


# ── 8. Order by dependencies: Kahn's queue order, then DFS finish order reversed; both end lined up in order ──
TOPO_SOURCE = """from collections import deque

def topo_dfs(n, adj):
    state = [0] * n  # 0 new, 1 on the path, 2 done
    order = []

    def dfs(u):
        state[u] = 1
        for v in adj[u]:
            if state[v] == 1:
                return False
            if state[v] == 0 and not dfs(v):
                return False
        state[u] = 2
        order.append(u)
        return True

    for u in range(n):
        if state[u] == 0 and not dfs(u):
            return []
    return order[::-1]

def topo_kahn(n, adj):
    indeg = [0] * n
    for u in range(n):
        for v in adj[u]:
            indeg[v] += 1
    queue = deque(u for u in range(n) if indeg[u] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                queue.append(v)
    return order if len(order) == n else []"""
# Tasks and what must come first: 4 and 5 wait on nothing; 0 needs 1 and 2; 3 comes last.
TOPO_N, TOPO_EDGES = 6, [(5, 2), (4, 2), (4, 1), (2, 0), (1, 0), (0, 3)]
TOPO_POS = [(-1.6, 2.0), (-3.6, 3.0), (-3.6, 1.0), (0.4, 2.0), (-5.6, 3.0), (-5.6, 1.0)]


def edge_counts(c):
    """Indegree on the edges themselves: an edge counted into its target's indegree and not yet taken off it is drawn
    thick and labelled with that indegree, so the thick edges into a node are what it still waits for."""
    live = f"keyIndex({c('counted')}, [idx, to]) >= 0 and keyIndex({c('used')}, [idx, to]) < 0"
    return {'widthExpr': f"{live} ? 3 : 1.2", 'labelExpr': f"{live} ? concat(arrayAt({c('indeg')}, to)) : ''"}


def topo_line(fn, text, after=None):
    """The line of text inside function fn (searched from the line holding after, when given)."""
    lines = TOPO_SOURCE.split('\n')
    k = next(i for i, l in enumerate(lines) if f'def {fn}(' in l)
    if after: k = next(i for i, l in enumerate(lines) if i >= k and after in l)
    return next(i + 1 for i, l in enumerate(lines) if i >= k and text in l)


def topo_adj():
    adj = [[] for _ in range(TOPO_N)]
    for a, b in TOPO_EDGES: adj[a].append(b)
    return adj


def ranks(order):
    return [order.index(i) if i in order else -1 for i in range(TOPO_N)]


def topo_kahn_trace():
    """Kahn's algorithm. Per frame: u, v, vi, adjU, vTip; indeg; queue; order; checkText; counted and used (the edges
    counted into an indegree, and those taken off it again); rank (each node's place in
    the result, −1 until the end) and lined (1 on the last frames, when the nodes line up in that order); result."""
    L = lambda t, a=None: topo_line('topo_kahn', t, a)
    adj = topo_adj()
    st = {'u': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'indeg': [0] * TOPO_N, 'queue': [], 'order': [], 'checkText': 'check: —',
          'counted': [], 'used': [], 'rank': [-1] * TOPO_N, 'lined': 0, 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    emit(L('indeg = [0] * n'), 'indeg[v] counts what v waits for: the edges coming into it.')
    for u in range(TOPO_N):
        for vi, v in enumerate(adj[u]):
            st['indeg'] = [x + 1 if i == v else x for i, x in enumerate(st['indeg'])]
            st['counted'] = st['counted'] + [[u, v]]
            st.update(u=u, v=v, vi=vi, adjU=adj[u])
            emit(L('indeg[v] += 1'), f'{u} → {v}: {v} waits for {u}. indeg[{v}] = {st["indeg"][v]}.')
    st.update(u=-1, v=-1, vi=-1, adjU=[])
    st['queue'] = [u for u in range(TOPO_N) if st['indeg'][u] == 0]
    emit(L('queue = deque('), f'{" and ".join(map(str, st["queue"]))} wait for nothing: they can go first.')
    emit(L('order = []'), 'The order starts empty.')
    while st['queue']:
        emit(L('while queue'), f'Ready now: {", ".join(map(str, st["queue"]))}.')
        u = st['queue'][0]; st['queue'] = st['queue'][1:]
        st.update(u=u, v=-1, vi=-1, adjU=adj[u], checkText='check: —')
        emit(L('u = queue.popleft()'), f'Take {u}: everything it needs is done.')
        st['order'] = st['order'] + [u]
        emit(L('order.append(u)'), f'{u} is next in the order.')
        for vi, v in enumerate(adj[u]):
            st.update(v=v, vi=vi)
            emit(L('for v in adj[u]', 'order.append(u)'), f'{u} → {v}: {v} was waiting for {u}.')
            st['indeg'] = [x - 1 if i == v else x for i, x in enumerate(st['indeg'])]
            st['used'] = st['used'] + [[u, v]]
            emit(L('indeg[v] -= 1'), f'{u} is done, so {v} waits for one thing fewer: indeg[{v}] = {st["indeg"][v]}.')
            free = st['indeg'][v] == 0
            st['checkText'] = f'indeg[{v}] = {st["indeg"][v]}: ' + ('ready, queue it' if free else 'still waiting')
            emit(L('if indeg[v] == 0'), f'Nothing left for {v} to wait for.' if free else f'{v} still waits for {st["indeg"][v]} more.')
            if free:
                st['queue'] = st['queue'] + [v]
                emit(L('queue.append(v)'), f'Queue {v}.')
        st.update(v=-1, vi=-1, checkText='check: —')
    st.update(u=-1, adjU=[])
    emit(L('while queue'), 'Nothing is left waiting.')
    st.update(rank=ranks(st['order']), lined=1, result=str(st['order']))
    emit(L('return order if'), f'All {TOPO_N} placed: {", ".join(map(str, st["order"]))}. A different order from the DFS one, and just as valid: every arrow points forward.')
    return trace, adj


def topo_dfs_trace():
    """DFS topological sort. Per frame: u, v, vi, adjU, vTip; state (0 new, 1 on the path, 2 done); path (the calls
    waiting) and calls (their call-site lines, for the Code panel's call arrows); order (finish order); checkText; rank,
    lined and result as in Kahn's run."""
    L = lambda t, a=None: topo_line('topo_dfs', t, a)
    adj = topo_adj()
    st = {'u': -1, 'v': -1, 'vi': -1, 'adjU': [], 'vTip': '', 'state': [0] * TOPO_N, 'path': [], 'calls': [], 'order': [], 'checkText': 'check: —',
          'rank': [-1] * TOPO_N, 'lined': 0, 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        st['vTip'] = loop_tip(adj[st['u']], st['vi']) if st['u'] >= 0 else ''
        emit0(line, message)
    put = lambda i, k: [k if j == i else x for j, x in enumerate(st['state'])]
    emit(L('state = [0] * n'), 'Every task starts new.')
    emit(L('order = []'), 'order collects tasks as they finish: each after everything that depends on it.')

    def dfs(u, site):
        st['path'] = st['path'] + [u]; st['calls'] = st['calls'] + [site]
        st.update(u=u, v=-1, vi=-1, adjU=adj[u], checkText='check: —')
        st['state'] = put(u, 1)
        emit(L('state[u] = 1'), f'Visit {u}: on the current path.')
        for vi, v in enumerate(adj[u]):
            st.update(u=u, v=v, vi=vi, adjU=adj[u])
            emit(L('for v in adj[u]'), f'{u} → {v}: {v} depends on {u}.')
            sv = st['state'][v]
            st['checkText'] = f'state[{v}] = {sv}: ' + ('new, go deeper' if sv == 0 else 'done already' if sv == 2 else 'on the path!')
            emit(L('if state[v] == 1'), f'{v} is ' + ('new.' if sv == 0 else 'done: it is in the order already.'))
            if sv == 0:
                emit(L('if state[v] == 0 and not dfs(v)'), f'Finish {v} first: call dfs({v}).')
                dfs(v, L('if state[v] == 0 and not dfs(v)'))
                st.update(u=u, v=v, vi=vi, adjU=adj[u], checkText='check: —')
                emit(L('if state[v] == 0 and not dfs(v)'), f'Back in {u}: {v} is finished.')
        st.update(v=-1, vi=-1, checkText='check: —')
        st['state'] = put(u, 2)
        emit(L('state[u] = 2'), f'Everything after {u} is finished: {u} is done.')
        st['order'] = st['order'] + [u]
        emit(L('order.append(u)'), f'Append {u}: after every task that depends on it.')
        emit(L('return True', 'order.append(u)'), f'dfs({u}) returns.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        back = st['path'][-1] if st['path'] else -1
        st.update(u=back, adjU=adj[back] if back >= 0 else [])
        return True

    for s0 in range(TOPO_N):
        st.update(u=-1, v=-1, vi=-1, adjU=[], checkText='check: —')
        if st['state'][s0]:
            emit(L('if state[u] == 0 and not dfs(u)'), f'{s0} is done already.')
            continue
        emit(L('if state[u] == 0 and not dfs(u)'), f'{s0} is new: start a search there.')
        dfs(s0, L('if state[u] == 0 and not dfs(u)'))
    result = st['order'][::-1]
    st.update(u=-1, adjU=[], rank=ranks(result), lined=1, result=str(result))
    emit(L('return order[::-1]'), f'Finish order {", ".join(map(str, st["order"]))}, reversed: {", ".join(map(str, result))}. '
         'Lined up in that order, every arrow points forward.')
    return trace, adj


def topo_sections():
    S = lambda *a, **k: section(TOPO_SOURCE, *a, **k)
    K, D = 'def topo_kahn(', 'def topo_dfs('
    return [
        S('d-init', 'Every task new, nothing finished', D, 'order = []',
          hint='Track each task as new, on the current path, or done; collect tasks as they finish.'),
        S('d-visit', 'Finish everything after u first', 'def dfs(u)', ('return False', 'not dfs(v)'), D,
          hint='Mark u on the path, then finish each task that depends on it; meeting the path again is a cycle.',
          prompt='Explain why u can only be appended after every task that depends on it is finished, and what meeting a task on the current path means.'),
        S('d-finish', 'Done: append u', 'state[u] = 2', 'return True', D,
          hint='Once everything after u is finished, u is done and goes into the order.'),
        S('d-roots', 'Every task, then reverse', 'for u in range(n)', 'return order[::-1]', D,
          hint='Start from every task not yet done; the finish order reversed puts each task before what depends on it.'),
        S('k-count', 'Count what each task waits for', K, 'indeg[v] += 1',
          hint='For each edge u → v, v waits for one more task.'),
        S('k-start', 'Queue what waits for nothing', 'queue = deque(', 'order = []', K,
          hint='Tasks with no prerequisites can start now; the order starts empty.'),
        S('k-take', 'Take a ready task; free what waited on it', 'while queue', 'queue.append(v)', K,
          hint='The taken task goes next in the order; each task it unblocks waits for one fewer, and joins the queue at zero.',
          prompt='Explain why a task can be placed once its indegree reaches 0, and why every edge then points forward in the order.'),
        S('k-check', 'All placed, or a cycle', 'return order if', None, K,
          hint='If some task never got free, it waits on a cycle: no order exists.'),
    ]


def topo_scene(header):
    ktrace, adj = topo_kahn_trace()
    dtrace, _ = topo_dfs_trace()
    LK = lambda t, a=None: topo_line('topo_kahn', t, a)
    LD = lambda t, a=None: topo_line('topo_dfs', t, a)

    def graph(c, fill, counts=False):
        lined = f"{c('lined')} == 1"
        return {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(TOPO_N), 'valueExpr': 'idx',
                # Lined up at the end: each task at its place in the result, so every arrow points to the right.
                'positionExpr': [f"{lined} ? -5.6 + arrayAt({c('rank')}, idx) * 1.5 : dataTable('topoNodes', idx, 'x')",
                                 f"{lined} ? 2.0 : dataTable('topoNodes', idx, 'y')", '0'],
                'nodeShape': 'rect', 'nodeWidth': 0.8, 'nodeHeight': 0.8, 'nodeCornerRadius': 0.4, 'valueLabel': 'inside', 'showIndices': False,
                # Kahn's placed tasks are pale while peeling; lined up at the end, the order is shown in full colour.
                'colorExpr': f"{lined} ? '#77bfae' : ({fill})" if counts else fill,
                'connectTo': {'indexExpr': "dataTable('topoNodes', idx, 'adj')", 'pinned': True, 'arrow': True,
                              'bendExpr': f"{lined} ? 0.35 : 0.08", 'color': '#7f93aa',
                              'colorExpr': f"idx == {c('u')} and to == {c('v')} ? '{GOLD}' : ''", 'highlightExpr': f"idx == {c('u')} and to == {c('v')}",
                              **(edge_counts(c) if counts else {})}}

    def common(c, L):
        return [
            {'id': 'adj-u', 'type': 'array', 'label': 'adj[u]', 'codeSymbol': 'adj[u]', 'labelSide': 'left', 'origin': [6.4, 3.0, 0],
             'cellSize': 1.1, 'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane',
             'lengthExpr': f"arrayCount({c('adjU')})", 'valueExpr': f"arrayAt({c('adjU')}, idx)", 'highlightExpr': f"idx == {c('vi')}",
             'connectTo': {'object': 'graph', 'indexExpr': 'value', 'pinned': True, 'arrow': True, 'color': '#8aa0b8', 'highlightExpr': f"idx == {c('vi')}"},
             'markers': [{'type': 'step_marker', 'indexName': 'v', 'indexExpr': c('vi'), 'valueExpr': c('v'), 'visibleExpr': f"{c('vi')} >= 0", 'color': GOLD}]},
            {'id': 'order', 'type': 'array', 'label': 'order', 'codeSymbol': 'order', 'labelSide': 'left', 'origin': [-2.3, -3.8, 0], 'cellSize': 1.15,
             'fontSize': 15, 'axisLabels': 'plane', 'color': '#77bfae',
             'lengthExpr': f"arrayCount({c('order')})", 'valueExpr': f"arrayAt({c('order')}, idx)",
             'highlightExpr': f"idx == arrayCount({c('order')}) - 1 and {c('line')} == {L('order.append(u)')}"},
            label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], L('def dfs(u)') if L is LD else L('u = queue.popleft()'), 'topological-sort'),
            {**label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], L('for v in adj[u]'), 'topological-sort'), 'tooltipExpr': c('vTip')},
            label('order-len', f"concat('len(order) = ', arrayCount({c('order')}))", ['order', '0'], L('order.append(u)'), 'topological-sort'),
            {**label('check', c('checkText'), None, L('if state[v] == 1') if L is LD else L('if indeg[v] == 0'), 'topological-sort'),
             'highlightExpr': f"{c('checkText')} != 'check: —'"},
            label('result', f"concat('result: ', {c('result')})", None, L('return order'), 'topological-sort'),
        ]

    k = lambda col: f"dataTable('topo_kahn', frame, '{col}')"
    taken = lambda i: f"keyIndex({k('order')}, {i}) >= 0"
    # Peeled off (placed in the order) the nodes go pale, as the degree scene's peeled leaves do.
    kahn = [graph(k, f"idx == {k('u')} ? '{GOLD}' : ({taken('idx')} ? {PALE} : (keyIndex({k('queue')}, idx) >= 0 ? '#e67db0' : ''))", counts=True),
            *common(k, LK),
            {'id': 'indeg', 'type': 'array', 'label': 'indeg', 'codeSymbol': 'indeg', 'labelSide': 'left', 'origin': [-2.3, -1.0, 0], 'cellSize': 1.15,
             'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(TOPO_N), 'valueExpr': f"arrayAt({k('indeg')}, idx)",
             'colorExpr': f"{taken('idx')} ? {PALE} : (arrayAt({k('indeg')}, idx) == 0 ? '#e67db0' : '')", 'highlightExpr': f"idx == {k('v')}"},
            {'id': 'queue', 'type': 'array', 'label': 'queue', 'codeSymbol': 'queue', 'labelSide': 'left', 'origin': [-2.3, -2.4, 0], 'cellSize': 1.15,
             'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0', 'showIndices': False,
             'lengthExpr': f"arrayCount({k('queue')})", 'valueExpr': f"arrayAt({k('queue')}, idx)",
             'highlightExpr': f"idx == arrayCount({k('queue')}) - 1 and {k('line')} == {LK('queue.append(v)')}"},
            {**label('indeg-v', f"{k('v')} < 0 ? 'indeg[v]: —' : concat('indeg[', {k('v')}, '] = ', arrayAt({k('indeg')}, {k('v')}))",
                     ['indeg', k('v')], LK('indeg[v] -= 1'), 'topological-sort'), 'highlightExpr': f"{k('v')} >= 0"},
            label('queue-len', f"concat('len(queue) = ', arrayCount({k('queue')}))", ['queue', '0'], LK('while queue'), 'topological-sort')]
    d = tr
    on = lambda i, v: f"arrayAt({d('state')}, {i}) == {v}"
    dfs = [graph(d, f"idx == {d('u')} ? '{GOLD}' : ({on('idx', 1)} ? '#e67db0' : ({on('idx', 2)} ? '#77bfae' : ''))"),
           *common(d, LD),
           {'id': 'state', 'type': 'array', 'label': 'state', 'codeSymbol': 'state', 'labelSide': 'left', 'origin': [-2.3, -1.0, 0], 'cellSize': 1.15,
            'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(TOPO_N), 'valueExpr': f"arrayAt({d('state')}, idx)",
            'colorExpr': f"{on('idx', 1)} ? '#e67db0' : ({on('idx', 2)} ? '#77bfae' : '')", 'highlightExpr': f"idx == {d('v')}"},
           {'id': 'stack', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'call stack', 'origin': [-2.3, -2.4, 0], 'cellSize': 1.15,
            'showTop': False, 'containerColor': '#e67db0', 'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0',
            'lengthExpr': f"arrayCount({d('path')})", 'valueExpr': f"arrayAt({d('path')}, idx)", 'highlightExpr': f"idx == arrayCount({d('path')}) - 1"},
           {**label('state-v', f"{d('v')} < 0 ? 'state[v]: —' : concat('state[', {d('v')}, '] = ', arrayAt({d('state')}, {d('v')}))",
                    ['state', d('v')], LD('if state[v] == 1'), 'topological-sort'), 'highlightExpr': f"{d('v')} >= 0"}]
    return run_scene('topological-sort', 'Order by dependencies (topological sort)', header, """**Signal:** prerequisites, build order, task scheduling: "in what order can everything run?"

An edge **u → v** means *u must come before v* (a course before the one that needs it, a library before the code that uses it). A **topological order** lists every node so that **every edge points forward**. It exists exactly when there is no cycle, and there is usually more than one.

## 1. DFS: finish order, reversed (this step)

DFS finishes a task only after **everything that depends on it** has finished, so appending each task when it finishes lists them dependents-first. Reversed, that puts every task before what depends on it. Meeting a task that is still on the current path is a cycle.

## 2. Kahn: take what waits for nothing (next step)

Count each task's **indegree**, the number of things it waits for. Tasks at 0 are ready: queue them. Take one, append it to the order, and remove its edges: each task it unblocks waits for one fewer, and joins the queue when it reaches 0. Pink tasks are ready; a placed task goes pale, peeled off the graph like the degree scene's leaves, and the thick edges into a task are the ones it still waits for. Here 4 and 5 start; 1 is freed by 4, 2 needs both 4 and 5, 0 needs 1 and 2, and 3 comes last.

If the queue empties before every task is placed, the rest wait on each other in a loop: a cycle, and no order exists (the cycle scene's third step).

DFS gives **5, 4, 2, 1, 0, 3** and Kahn gives **4, 5, 1, 2, 0, 3**: both have every arrow pointing forward. At the end of each step the tasks line up in their order, so you can check it.

**Cost:** O(V + E) for both.

**Practice:** Course Schedule II, Alien Dictionary, Parallel Courses, Minimum Height Trees.""",
        'Explain what a topological order is and why it exists exactly when there is no cycle. Ask the learner to predict which task finishes next in DFS, and which task is ready next in Kahn.',
        'topo.py', TOPO_SOURCE, dtrace, dfs,
        sections=topo_sections(), call_entry=topo_line('topo_dfs', 'def dfs(u)'),
        data={'topoNodes': [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(TOPO_POS, adj)]},
        first={'title': 'DFS: finish order, reversed', 'description': 'A task finishes after everything that depends on it.'},
        more=[{'id': 'kahn', 'title': "Kahn: take what waits for nothing", 'description': 'Indegrees, a queue of ready tasks, and the order they leave in.',
               'table': 'topo_kahn', 'trace': ktrace, 'elements': kahn}])


# ── 9. Union-find: edges arrive one by one; each node points to a parent, and the parent pointers form a forest ──
UF_SOURCE = """def count_groups(n, edges):
    parent = list(range(n))  # each node starts as its own root
    rank = [0] * n

    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])  # path compression
        return parent[x]

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return False  # already connected: the edge closes a cycle
        if rank[ra] < rank[rb]:
            ra, rb = rb, ra
        parent[rb] = ra  # the shorter tree goes under the taller
        if rank[ra] == rank[rb]:
            rank[ra] += 1
        return True

    groups = n
    for a, b in edges:
        if union(a, b):
            groups -= 1
    return groups"""
UF_N = 9
UF_EDGES = [(0, 1), (2, 3), (0, 2), (4, 5), (5, 6), (3, 1), (6, 3), (7, 6)]
UF_POS = [(-6.0, 3.6), (-4.4, 3.6), (-6.0, 2.0), (-4.4, 2.0), (-2.8, 3.6), (-1.2, 3.6), (-2.8, 2.0), (-2.8, 0.5), (-1.2, 0.5)]
UF_PALETTE = ['#6ea8e0', '#e5a65c', '#77bfae', '#e67db0', '#b39ddb', '#d4c86a', '#7fc8e8', '#e0896e', '#a3b86c']
UF_ROW, UF_X0, UF_DX = (3.9, 2.5, 1.1), 0.8, 0.95


def uf_forest(parent):
    """Where each node sits in the parent-pointer forest: roots on the top row in index order, each child a row
    below its parent, every tree as wide as its leaves."""
    kids = [[] for _ in parent]
    for i, p in enumerate(parent):
        if p != i: kids[p].append(i)
    width = lambda i: max(1, sum(width(k) for k in kids[i]))
    xs, ys = [0.0] * len(parent), [0.0] * len(parent)
    def place(i, left, depth):
        xs[i] = UF_X0 + (left + (width(i) - 1) / 2) * UF_DX
        ys[i] = UF_ROW[min(depth, len(UF_ROW) - 1)]
        for k in kids[i]:
            place(k, left, depth + 1); left += width(k)
    left = 0
    for r in (i for i, p in enumerate(parent) if p == i):
        place(r, left, 0); left += width(r)
    return xs, ys


def uf_trace():
    """count_groups on UF_EDGES. Per frame: parent, rank, groups; ei (the edge being processed), a, b; x and path (the
    find calls waiting, their arguments) with calls (their call-site lines, for the Code panel's call arrows); ra, rb;
    changed (the node whose pointer just moved); merged and redundant (edges as [a, b]); root (each node's group root,
    for its colour); fx, fy (forest layout); checkText; result."""
    L = lambda t: line_of(UF_SOURCE, t)
    st = {'parent': list(range(UF_N)), 'rank': [0] * UF_N, 'groups': '—', 'ei': -1, 'a': -1, 'b': -1, 'x': -1, 'path': [], 'calls': [],
          'ra': -1, 'rb': -1, 'changed': -1, 'merged': [], 'redundant': [], 'root': list(range(UF_N)), 'fx': [], 'fy': [],
          'checkText': 'check: —', 'result': '—'}
    trace, emit0 = recorder(st)
    def root_of(i):
        while st['parent'][i] != i: i = st['parent'][i]
        return i
    def emit(line, message):
        st['root'] = [root_of(i) for i in range(UF_N)]
        st['fx'], st['fy'] = uf_forest(st['parent'])
        emit0(line, message)
    def setp(i, v): st['parent'] = [v if j == i else p for j, p in enumerate(st['parent'])]

    emit(L('parent = list(range(n))'), f'Every node is its own root: {UF_N} groups of one.')
    emit(L('rank = [0] * n'), 'rank bounds each tree\'s height; every tree starts at height 0.')

    def find(x, site):
        st['path'] = st['path'] + [x]; st['calls'] = st['calls'] + [site]; st['x'] = x
        p = st['parent'][x]
        if p == x:
            emit(L('if parent[x] != x'), f'parent[{x}] = {x}: {x} is a root. find returns {x}.')
            r = x
        else:
            emit(L('if parent[x] != x'), f'parent[{x}] = {p}: not a root. Ask {p} for the root.')
            r = find(p, L('parent[x] = find(parent[x])'))
            st['x'] = x
            if p != r:
                setp(x, r); st['changed'] = x
                emit(L('parent[x] = find(parent[x])'), f'Path compression: {x} now points straight at the root {r}, skipping {p}.')
                st['changed'] = -1
            else:
                emit(L('return parent[x]'), f'{x}\'s parent {p} is the root. find returns {r}.')
        st['path'] = st['path'][:-1]; st['calls'] = st['calls'][:-1]
        st['x'] = st['path'][-1] if st['path'] else -1
        return r

    st['groups'] = UF_N
    emit(L('groups = n'), f'groups = {UF_N}: no edge has joined anything yet.')
    for ei, (a, b) in enumerate(UF_EDGES):
        st.update(ei=ei, a=a, b=b, ra=-1, rb=-1, checkText='check: —')
        emit(L('for a, b in edges'), f'Edge {a} – {b} arrives.')
        site = L('ra, rb = find(a), find(b)')
        ra = find(a, site); st['ra'] = ra
        rb = find(b, site); st['rb'] = rb
        emit(L('ra, rb = find(a), find(b)'), f'{a}\'s root is {ra}; {b}\'s root is {rb}.')
        if ra == rb:
            st['checkText'] = f'ra = rb = {ra}: already connected'
            emit(L('if ra == rb'), f'Both are in {ra}\'s group already: the edge closes a cycle.')
            st['redundant'] = st['redundant'] + [[a, b]]
            emit(L('return False  # already'), f'{a} – {b} is redundant: nothing to merge. groups stays {st["groups"]}.')
            continue
        st['checkText'] = f'ra = {ra}, rb = {rb}: different groups'
        emit(L('if ra == rb'), 'Different roots: two groups to merge.')
        rk = st['rank']
        emit(L('if rank[ra] < rank[rb]'), f'rank[{ra}] = {rk[ra]}, rank[{rb}] = {rk[rb]}: ' + ('swap, so ra is the taller tree.' if rk[ra] < rk[rb] else 'ra is at least as tall.'))
        if rk[ra] < rk[rb]:
            ra, rb = rb, ra; st.update(ra=ra, rb=rb)
            emit(L('ra, rb = rb, ra'), f'Now ra = {ra}, rb = {rb}.')
        setp(rb, ra); st['changed'] = rb
        st['merged'] = st['merged'] + [[a, b]]
        emit(L('parent[rb] = ra'), f'Link root {rb} under {ra}: one group now.')
        st['changed'] = -1
        if st['rank'][ra] == st['rank'][rb]:
            st['rank'] = [r + 1 if j == ra else r for j, r in enumerate(st['rank'])]
            emit(L('rank[ra] += 1'), f'Equal heights, so the joined tree is one taller: rank[{ra}] = {st["rank"][ra]}.')
        st['groups'] -= 1; st['checkText'] = 'check: —'
        emit(L('groups -= 1'), f'Two groups became one: groups = {st["groups"]}.')
    st.update(ei=-1, a=-1, b=-1, ra=-1, rb=-1, result=str(st['groups']))
    emit(L('return groups'), f'{st["groups"]} groups: {{0, 1, 2, 3, 4, 5, 6, 7}} and {{8}}, which no edge touched.')
    return trace


def uf_sections():
    S = lambda *a, **k: section(UF_SOURCE, *a, **k)
    return [
        S('u-init', 'Every node its own root', 'def count_groups(', 'rank = [0] * n',
          hint='Each node points at itself: n groups of one, every tree of height 0.'),
        S('u-find', 'find: follow parents to the root, then point straight at it', 'def find(x)', 'return parent[x]',
          hint='A root points at itself; anything else asks its parent, and on the way back points directly at the root.',
          prompt='Explain how find reaches the root, and why pointing every node on the way straight at the root makes later finds faster.'),
        S('u-same', 'union: same root means already connected', 'def union(a, b)', 'return False',
          hint='Find both roots; if they are the same, the two are in one group already and the edge closes a cycle.'),
        S('u-link', 'Link the shorter tree under the taller', 'if rank[ra] < rank[rb]', 'return True', 'def union(a, b)',
          hint='Hang the shorter tree\'s root under the taller one\'s, so trees stay shallow; equal heights grow by one.',
          prompt='Explain why linking by rank keeps every tree\'s height at most log n, and what would happen if roots were linked the other way.'),
        S('u-count', 'Each merge removes one group', 'groups = n', 'return groups',
          hint='Start with n groups; every edge that joins two different groups leaves one fewer.'),
    ]


def uf_scene(header):
    trace = uf_trace()
    L = lambda t: line_of(UF_SOURCE, t)
    c = tr
    group = lambda i: f"dataTable('ufPalette', arrayAt({c('root')}, {i}), 'c')"
    cur = f"idx == {c('a')} and to == {c('b')}"
    merged = f"keyIndex({c('merged')}, [idx, to]) >= 0"
    redundant = f"keyIndex({c('redundant')}, [idx, to]) >= 0"
    adj = [[b for a, b in UF_EDGES if a == i] for i in range(UF_N)]
    node = {'nodeShape': 'rect', 'nodeWidth': 0.72, 'nodeHeight': 0.72, 'nodeCornerRadius': 0.36, 'valueLabel': 'inside', 'showIndices': False}
    elements = [
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(UF_N), 'valueExpr': 'idx', **node,
         'positionExpr': ["dataTable('ufNodes', idx, 'x')", "dataTable('ufNodes', idx, 'y')", '0'],
         # Each node takes its group's colour; edges still to come are faint.
         'colorExpr': group('idx'),
         'connectTo': {'indexExpr': "dataTable('ufNodes', idx, 'adj')", 'pinned': True, 'arrow': False, 'color': '#323a45',
                       'colorExpr': f"{cur} ? '{GOLD}' : ({redundant} ? '#e06c75' : ({merged} ? {group('idx')} : ''))",
                       'highlightExpr': f"{cur} or {redundant}",
                       'widthExpr': f"{cur} or {merged} or {redundant} ? 2.4 : 1"}},
        {'id': 'forest', 'type': 'graph', 'label': 'parent pointers', 'lengthExpr': str(UF_N), 'valueExpr': 'idx', **node,
         'positionExpr': [f"arrayAt({c('fx')}, idx)", f"arrayAt({c('fy')}, idx)", '0'],
         'colorExpr': f"idx == {c('x')} ? '{GOLD}' : {group('idx')}",
         # Each node's arrow points at its parent; a root points at itself and draws none.
         'connectTo': {'indexExpr': f"arrayAt({c('parent')}, idx) == idx ? -1 : arrayAt({c('parent')}, idx)", 'pinned': True, 'arrow': True,
                       'color': '#8aa0b8', 'colorExpr': f"idx == {c('changed')} ? '{GOLD}' : ''", 'highlightExpr': f"idx == {c('changed')}"}},
        *[{'id': f'title-{k}', 'type': 'text', 'text': t, 'position': [x, 4.7, 0], 'color': '#8aa0b8', 'fontSize': 13}
          for k, (t, x) in enumerate([('edges arrive', -3.6), ('parent pointers: a forest of roots', 4.6)])],
        {'id': 'parent', 'type': 'array', 'label': 'parent', 'codeSymbol': 'parent', 'labelSide': 'left', 'origin': [-2.3, -1.2, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(UF_N), 'valueExpr': f"arrayAt({c('parent')}, idx)",
         'colorExpr': group('idx'), 'highlightExpr': f"idx == {c('changed')} or idx == {c('x')}"},
        {'id': 'rank', 'type': 'array', 'label': 'rank', 'codeSymbol': 'rank', 'labelSide': 'left', 'origin': [-2.3, -2.5, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(UF_N), 'valueExpr': f"arrayAt({c('rank')}, idx)",
         'highlightExpr': f"idx == {c('ra')} and {c('line')} == {L('rank[ra] += 1')}"},
        {'id': 'edges', 'type': 'array', 'label': 'edges', 'codeSymbol': 'edges', 'labelSide': 'left', 'origin': [-2.3, -3.8, 0], 'cellSize': 1.15,
         'fontSize': 16, 'indexFontSize': 10, 'axisLabels': 'plane', 'itemType': 'text', 'lengthExpr': str(len(UF_EDGES)),
         'valueExpr': "dataTable('ufEdges', idx, 'name')",
         'colorExpr': f"keyIndex({c('redundant')}, dataTable('ufEdges', idx, 'pair')) >= 0 ? '#e06c75' : "
                      f"(keyIndex({c('merged')}, dataTable('ufEdges', idx, 'pair')) >= 0 ? '#77bfae' : '')",
         'highlightExpr': f"idx == {c('ei')}"},
        {'id': 'stack', 'type': 'stack', 'arrayLayout': 'horizontal', 'label': 'find', 'origin': [6.0, -0.1, 0], 'cellSize': 0.95,
         'showTop': False, 'containerColor': '#e67db0', 'fontSize': 15, 'axisLabels': 'plane', 'color': '#e67db0',
         'lengthExpr': f"arrayCount({c('path')})", 'valueExpr': f"arrayAt({c('path')}, idx)", 'highlightExpr': f"idx == arrayCount({c('path')}) - 1"},
        label('a', f"{c('a')} < 0 ? 'a: —' : concat('a = ', {c('a')})", ['graph', c('a')], L('for a, b in edges'), 'union-find'),
        label('b', f"{c('b')} < 0 ? 'b: —' : concat('b = ', {c('b')})", ['graph', c('b')], L('for a, b in edges'), 'union-find'),
        label('x', f"{c('x')} < 0 ? 'x: —' : concat('x = ', {c('x')})", ['forest', c('x')], L('def find(x)'), 'union-find'),
        {**label('parent-x', f"{c('x')} < 0 ? 'parent[x]: —' : concat('parent[', {c('x')}, '] = ', arrayAt({c('parent')}, {c('x')}))",
                 ['parent', c('x')], L('if parent[x] != x'), 'union-find'), 'highlightExpr': f"{c('x')} >= 0"},
        label('ra', f"{c('ra')} < 0 ? 'ra: —' : concat('ra = ', {c('ra')})", ['forest', c('ra')], L('ra, rb = find(a), find(b)'), 'union-find'),
        label('rb', f"{c('rb')} < 0 ? 'rb: —' : concat('rb = ', {c('rb')})", ['forest', c('rb')], L('ra, rb = find(a), find(b)'), 'union-find'),
        {**label('check', c('checkText'), None, L('if ra == rb'), 'union-find'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
        label('groups', f"concat('groups = ', {c('groups')})", None, L('groups -= 1'), 'union-find'),
        label('result', f"concat('result: ', {c('result')})", None, L('return groups'), 'union-find'),
    ]
    return run_scene('union-find', 'Group as edges arrive (union-find)', header, """**Signal:** connectivity that grows edge by edge: counting groups, "are these two connected?", a redundant edge, merging accounts.

Union-find keeps a **group label that can merge**. Every node points to a **parent**; following parents ends at the group's **root**, a node that points at itself. Two nodes are connected exactly when they reach the same root. The left shows the graph as its edges arrive; the right shows the parent pointers, a **forest** with one tree per group and its root on top.

- **find(x)** follows parents up to the root. On the way back it points every node it passed **straight at the root** (path compression), so the next find is one hop.
- **union(a, b)** finds both roots. The same root means a and b are already connected: the edge closes a **cycle** (drawn red). Different roots: hang one root under the other, and two groups become one.

**Union by rank** hangs the **shorter** tree under the taller one, so no tree grows taller than log n; equal heights grow by one. Watch 3 → 2 → 0: when edge 3 – 1 arrives, find(3) climbs two hops and then points 3 straight at 0. Edge 3 – 1 itself is redundant: 3 and 1 already share root 0.

Counting is free: start with n groups and subtract one per successful union. Here 9 nodes and 7 merges leave **2 groups**; node 8 never meets an edge.

**Cost:** with both tricks, about O(α(n)) per operation, effectively constant. No traversal is repeated as edges arrive.

**Practice:** Number of Provinces, Redundant Connection, Accounts Merge, Number of Connected Components.""",
        'Explain how parent pointers represent groups, why path compression and union by rank keep the trees flat, and how an edge whose ends share a root closes a cycle. Ask the learner to predict each find\'s root and which edge will be redundant.',
        'union_find.py', UF_SOURCE, trace, elements,
        sections=uf_sections(), call_entry=line_of(UF_SOURCE, 'def find(x)'),
        data={'ufNodes': [{'x': x, 'y': y, 'adj': a} for (x, y), a in zip(UF_POS, adj)],
              'ufEdges': [{'name': f'{a}–{b}', 'pair': [a, b]} for a, b in UF_EDGES],
              'ufPalette': [{'c': col} for col in UF_PALETTE]},
        first={'title': 'Merge groups as edges arrive', 'description': 'find climbs to the root; union links two roots.'})


# ── 10. Minimum spanning tree: Kruskal (sorted edges + union-find), then Prim (a min-heap growing one tree) ──
MST_SOURCE = """import heapq

def kruskal(n, edges):
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]  # path halving
            x = parent[x]
        return x

    tree, cost = [], 0
    for w, a, b in sorted(edges):
        ra, rb = find(a), find(b)
        if ra == rb:
            continue  # would close a cycle
        parent[rb] = ra
        tree.append((a, b))
        cost += w
        if len(tree) == n - 1:
            break
    return cost, tree

def prim(n, adj):
    seen = [False] * n
    heap = [(0, 0, -1)]  # (weight, node, reached from)
    tree, cost = [], 0
    while heap:
        w, u, p = heapq.heappop(heap)
        if seen[u]:
            continue  # a cheaper edge reached u first
        seen[u] = True
        cost += w
        if p >= 0:
            tree.append((p, u))
        for v, wv in adj[u]:
            if not seen[v]:
                heapq.heappush(heap, (wv, v, u))
    return cost, tree"""
MST_N = 7
MST_EDGES = [(0, 1, 4), (1, 2, 8), (0, 3, 7), (1, 4, 2), (2, 4, 6), (2, 5, 5), (3, 4, 9), (4, 5, 1), (3, 6, 3), (4, 6, 10), (5, 6, 11)]
MST_POS = [(-6.0, 3.4), (-3.6, 4.1), (-1.2, 3.4), (-6.0, 1.0), (-3.6, 1.8), (-1.2, 1.0), (-3.6, -0.4)]
MST_TREE, MST_REJECT, MST_FRONTIER = '#77bfae', '#e06c75', '#e67db0'


def mst_line(fn, text, after=None):
    """The line of text inside function fn (searched from the line holding after, when given)."""
    lines = MST_SOURCE.split('\n')
    k = next(i for i, l in enumerate(lines) if f'def {fn}(' in l)
    if after: k = next(i for i, l in enumerate(lines) if i >= k and after in l)
    return next(i + 1 for i, l in enumerate(lines) if i >= k and text in l)


def kruskal_trace():
    """Kruskal on MST_EDGES. Per frame: ei (place in the sorted list), w, a, b, ra, rb; parent; root (each node's
    root, for its colour); tree and rejected (edges as [a, b]); cost; checkText; result."""
    L = lambda t, a=None: mst_line('kruskal', t, a)
    st = {'ei': -1, 'w': -1, 'a': -1, 'b': -1, 'ra': -1, 'rb': -1, 'parent': list(range(MST_N)), 'root': list(range(MST_N)),
          'tree': [], 'rejected': [], 'cost': 0, 'checkText': 'check: —', 'result': '—'}
    trace, emit0 = recorder(st)
    def find(x):
        while st['parent'][x] != x:
            st['parent'] = [st['parent'][st['parent'][x]] if j == x else p for j, p in enumerate(st['parent'])]
            x = st['parent'][x]
        return x
    def emit(line, message):
        root = lambda i: i if st['parent'][i] == i else root(st['parent'][i])
        st['root'] = [root(i) for i in range(MST_N)]
        emit0(line, message)
    emit(L('parent = list(range(n))'), f'Every node is its own group: {MST_N} pieces, no edge chosen.')
    emit(L('tree, cost = [], 0'), 'The tree starts empty, at cost 0.')
    for ei, (w, a, b) in enumerate(sorted((w, a, b) for a, b, w in MST_EDGES)):
        st.update(ei=ei, w=w, a=a, b=b, ra=-1, rb=-1, checkText='check: —')
        emit(L('for w, a, b in sorted(edges)'), f'Next cheapest edge: {a} – {b}, weight {w}.')
        ra, rb = find(a), find(b)
        st.update(ra=ra, rb=rb)
        emit(L('ra, rb = find(a), find(b)'), f'{a} is in {ra}\'s group, {b} in {rb}\'s.')
        if ra == rb:
            st['checkText'] = f'ra = rb = {ra}: same group'
            st['rejected'] = st['rejected'] + [[a, b]]
            emit(L('continue  # would close'), f'{a} and {b} are joined already: {a} – {b} would close a cycle. Skip it.')
            continue
        st['checkText'] = f'ra = {ra}, rb = {rb}: different groups'
        emit(L('if ra == rb'), 'Different groups: the edge joins two pieces, so it is safe to take.')
        st['parent'] = [ra if j == rb else p for j, p in enumerate(st['parent'])]
        emit(L('parent[rb] = ra'), f'Merge: {rb}\'s group joins {ra}\'s.')
        st['tree'] = st['tree'] + [[a, b]]
        emit(L('tree.append((a, b))'), f'Take {a} – {b}.')
        st['cost'] += w; st['checkText'] = 'check: —'
        emit(L('cost += w'), f'cost = {st["cost"]}.')
        if len(st['tree']) == MST_N - 1:
            emit(L('break'), f'{MST_N - 1} edges join all {MST_N} nodes: the tree is complete. The rest are never looked at.')
            break
    st.update(ei=-1, w=-1, a=-1, b=-1, ra=-1, rb=-1, result=f'cost {st["cost"]}')
    emit(L('return cost, tree'), f'Minimum spanning tree: {len(st["tree"])} edges, total weight {st["cost"]}.')
    return trace


def prim_trace(adj):
    """Prim from node 0. Per frame: w, u, p (the popped entry); v, vi; heap (entries [w, v, from], sorted); seen; tree
    (edges as [from, to]); cost; checkText; result."""
    L = lambda t, a=None: mst_line('prim', t, a)
    st = {'w': -1, 'u': -1, 'p': -1, 'v': -1, 'heap': [], 'seen': [0] * MST_N, 'tree': [], 'cost': 0, 'checkText': 'check: —', 'result': '—'}
    trace, emit = recorder(st)
    emit(L('seen = [False] * n'), 'No node is in the tree yet.')
    st['heap'] = [[0, 0, -1]]
    emit(L('heap = [(0, 0, -1)]'), 'Start at node 0: it costs nothing to reach.')
    emit(L('tree, cost = [], 0'), 'The tree starts empty, at cost 0.')
    while st['heap']:
        emit(L('while heap'), f'{len(st["heap"])} candidate edge{"s" if len(st["heap"]) > 1 else ""} in the heap.')
        (w, u, p), st['heap'] = st['heap'][0], st['heap'][1:]
        st.update(w=w, u=u, p=p, v=-1)
        emit(L('w, u, p = heapq.heappop(heap)'), f'Pop the cheapest: reach {u}' + (f' from {p} for {w}.' if p >= 0 else '.'))
        if st['seen'][u]:
            st['checkText'] = f'seen[{u}]: already in the tree'
            emit(L('continue  # a cheaper'), f'{u} is in the tree already, through a cheaper edge: skip this stale entry.')
            st['checkText'] = 'check: —'
            continue
        st['checkText'] = f'seen[{u}] = False: new'
        st['seen'] = [1 if j == u else s for j, s in enumerate(st['seen'])]
        emit(L('seen[u] = True'), f'{u} joins the tree.')
        st['cost'] += w; st['checkText'] = 'check: —'
        emit(L('cost += w'), f'cost = {st["cost"]}.')
        if p >= 0:
            st['tree'] = st['tree'] + [[p, u]]
            emit(L('tree.append((p, u))'), f'Take {p} – {u}: the cheapest edge leaving the tree.')
        for v, wv in adj[u]:
            st['v'] = v
            if st['seen'][v]:
                continue
            st['heap'] = sorted(st['heap'] + [[wv, v, u]])
            emit(L('heapq.heappush(heap, (wv, v, u))'), f'{u} – {v} leaves the tree: push it, weight {wv}.')
        st.update(v=-1)
    st.update(w=-1, u=-1, p=-1, result=f'cost {st["cost"]}')
    emit(L('return cost, tree'), f'The heap is empty. Same total as Kruskal: {st["cost"]}.')
    return trace


def mst_sections():
    S = lambda *a, **k: section(MST_SOURCE, *a, **k)
    K, P = 'def kruskal(', 'def prim('
    return [
        S('k-init', 'Every node its own group', K, 'return x', K,
          hint='Union-find over the nodes: find follows parents to a group\'s root.'),
        S('k-scan', 'Cheapest edge first', 'tree, cost = [], 0', 'ra, rb = find(a), find(b)', K,
          hint='Look at the edges from cheapest to dearest, and find the groups of their two ends.'),
        S('k-take', 'Take it unless it closes a cycle', 'if ra == rb', 'break', K,
          hint='An edge inside one group would close a cycle; any other joins two pieces, so take it, until n - 1 are taken.',
          prompt='Explain why the cheapest edge joining two different groups is always safe to take (the cut property), and why an edge within a group is never needed.'),
        S('k-return', 'The total and the tree', 'return cost, tree', None, K),
        S('p-init', 'Start at node 0', P, 'tree, cost = [], 0', P,
          hint='A min-heap of candidate edges, starting with node 0 at no cost.'),
        S('p-pop', 'Pop the cheapest edge; skip it if stale', 'while heap', 'continue', P,
          hint='The cheapest candidate reaches a node; if that node is in the tree already, the entry is stale.'),
        S('p-add', 'Add the node; push its edges out', 'seen[u] = True', 'heapq.heappush', P,
          hint='Add the node and its edge to the tree, then push every edge from it to a node outside.',
          prompt='Explain why the cheapest edge leaving the tree is always safe, and why stale heap entries are skipped rather than removed.'),
        S('p-return', 'The total and the tree', 'return cost, tree', None, P),
    ]


def mst_scene(header):
    ktrace = kruskal_trace()
    adj = [[] for _ in range(MST_N)]
    for a, b, w in MST_EDGES:
        adj[a].append((b, w)); adj[b].append((a, w))
    ptrace = prim_trace(adj)
    LK = lambda t, a=None: mst_line('kruskal', t, a)
    LP = lambda t, a=None: mst_line('prim', t, a)
    weights = [[next((w for a, b, w in MST_EDGES if {a, b} == {i, j}), 0) for j in range(MST_N)] for i in range(MST_N)]
    nodes = [{'x': x, 'y': y, 'adj': [b for a, b, _ in MST_EDGES if a == i], 'w': weights[i]} for i, (x, y) in enumerate(MST_POS)]
    either = lambda col: f"(keyIndex({col}, [idx, to]) >= 0 or keyIndex({col}, [to, idx]) >= 0)"
    node = {'nodeShape': 'rect', 'nodeWidth': 0.72, 'nodeHeight': 0.72, 'nodeCornerRadius': 0.36, 'valueLabel': 'inside', 'showIndices': False}

    def graph(fill, cur, tree, other, other_color):
        return {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(MST_N), 'valueExpr': 'idx', **node,
                'positionExpr': ["dataTable('mstNodes', idx, 'x')", "dataTable('mstNodes', idx, 'y')", '0'], 'colorExpr': fill,
                # Every edge is labelled with its weight; the tree's edges are thick.
                'connectTo': {'indexExpr': "dataTable('mstNodes', idx, 'adj')", 'pinned': True, 'arrow': False, 'color': '#3e4855',
                              'colorExpr': f"{cur} ? '{GOLD}' : ({tree} ? '{MST_TREE}' : ({other} ? '{other_color}' : ''))",
                              'highlightExpr': cur, 'widthExpr': f"{tree} ? 3.2 : ({cur} ? 2.4 : 1.2)",
                              'labelExpr': "concat(arrayAt(dataTable('mstNodes', idx, 'w'), to))"}}

    def pairs(id, label, col, y, color):
        return {'id': id, 'type': 'array', 'label': label, 'codeSymbol': id, 'labelSide': 'left', 'origin': [-2.3, y, 0], 'cellSize': 1.15,
                'fontSize': 16, 'axisLabels': 'plane', 'itemType': 'text', 'color': color, 'showIndices': False,
                'lengthExpr': f"arrayCount({col})", 'valueExpr': f"arrayAt({col}, idx)"}

    k = tr
    kcur = f"((idx == {k('a')} and to == {k('b')}) or (idx == {k('b')} and to == {k('a')}))"
    sorted_edges = sorted((w, a, b) for a, b, w in MST_EDGES)
    kruskal = [
        graph(f"dataTable('ufPalette', arrayAt({k('root')}, idx), 'c')", kcur, either(k('tree')), either(k('rejected')), MST_REJECT),
        {'id': 'sorted', 'type': 'array', 'label': 'sorted', 'codeSymbol': 'sorted(edges)', 'labelSide': 'left', 'origin': [-2.3, -1.7, 0],
         'cellSize': 1.0, 'fontSize': 14, 'indexFontSize': 10, 'axisLabels': 'plane', 'itemType': 'text', 'lengthExpr': str(len(sorted_edges)),
         'valueExpr': "dataTable('mstSorted', idx, 'name')",
         'colorExpr': f"keyIndex({k('tree')}, dataTable('mstSorted', idx, 'pair')) >= 0 ? '{MST_TREE}' : "
                      f"(keyIndex({k('rejected')}, dataTable('mstSorted', idx, 'pair')) >= 0 ? '{MST_REJECT}' : '')",
         'highlightExpr': f"idx == {k('ei')}"},
        {'id': 'parent', 'type': 'array', 'label': 'parent', 'codeSymbol': 'parent', 'labelSide': 'left', 'origin': [-2.3, -3.0, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(MST_N), 'valueExpr': f"arrayAt({k('parent')}, idx)",
         'colorExpr': f"dataTable('ufPalette', arrayAt({k('root')}, idx), 'c')", 'highlightExpr': f"idx == {k('rb')} and {k('line')} == {LK('parent[rb] = ra')}"},
        pairs('tree', 'tree', k('treeNames'), -4.3, MST_TREE),
        label('w', f"{k('w')} < 0 ? 'w: —' : concat('w = ', {k('w')})", None, LK('for w, a, b in sorted(edges)'), 'mst'),
        label('a', f"{k('a')} < 0 ? 'a: —' : concat('a = ', {k('a')})", ['graph', k('a')], LK('for w, a, b in sorted(edges)'), 'mst'),
        label('b', f"{k('b')} < 0 ? 'b: —' : concat('b = ', {k('b')})", ['graph', k('b')], LK('for w, a, b in sorted(edges)'), 'mst'),
        label('ra', f"{k('ra')} < 0 ? 'ra: —' : concat('ra = ', {k('ra')})", ['graph', k('ra')], LK('ra, rb = find(a), find(b)'), 'mst'),
        label('rb', f"{k('rb')} < 0 ? 'rb: —' : concat('rb = ', {k('rb')})", ['graph', k('rb')], LK('ra, rb = find(a), find(b)'), 'mst'),
        {**label('check', k('checkText'), None, LK('if ra == rb'), 'mst'), 'highlightExpr': f"{k('checkText')} != 'check: —'"},
        label('cost', f"concat('cost = ', {k('cost')})", None, LK('cost += w'), 'mst'),
        label('tree-len', f"concat('len(tree) = ', arrayCount({k('tree')}))", ['tree', '0'], LK('if len(tree) == n - 1'), 'mst'),
        label('result', f"concat('result: ', {k('result')})", None, LK('return cost, tree'), 'mst'),
    ]
    p = lambda col: f"dataTable('mst_prim', frame, '{col}')"
    pcur = f"((idx == {p('p')} and to == {p('u')}) or (idx == {p('u')} and to == {p('p')}))"
    frontier = f"(keyIndex({p('heapPairs')}, [idx, to]) >= 0 or keyIndex({p('heapPairs')}, [to, idx]) >= 0)"
    prim = [
        graph(f"idx == {p('u')} ? '{GOLD}' : (arrayAt({p('seen')}, idx) == 1 ? '{MST_TREE}' : '')", pcur, either(p('tree')), frontier, MST_FRONTIER),
        {'id': 'heap', 'type': 'array', 'label': 'heap', 'codeSymbol': 'heap', 'labelSide': 'left', 'origin': [-2.3, -1.7, 0], 'cellSize': 1.0,
         'fontSize': 14, 'axisLabels': 'plane', 'itemType': 'text', 'color': MST_FRONTIER, 'showIndices': False,
         'lengthExpr': f"arrayCount({p('heapNames')})", 'valueExpr': f"arrayAt({p('heapNames')}, idx)",
         'highlightExpr': f"idx == 0 and {p('line')} == {LP('w, u, p = heapq.heappop(heap)')}"},
        {'id': 'seen', 'type': 'array', 'label': 'seen', 'codeSymbol': 'seen', 'labelSide': 'left', 'origin': [-2.3, -3.0, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(MST_N), 'valueExpr': f"arrayAt({p('seen')}, idx)",
         'colorExpr': f"arrayAt({p('seen')}, idx) == 1 ? '{MST_TREE}' : ''", 'highlightExpr': f"idx == {p('u')}"},
        pairs('tree', 'tree', p('treeNames'), -4.3, MST_TREE),
        label('w', f"{p('w')} < 0 ? 'w: —' : concat('w = ', {p('w')})", None, LP('w, u, p = heapq.heappop(heap)'), 'mst'),
        label('u', f"{p('u')} < 0 ? 'u: —' : concat('u = ', {p('u')})", ['graph', p('u')], LP('w, u, p = heapq.heappop(heap)'), 'mst'),
        label('p', f"{p('p')} < 0 ? 'p: —' : concat('p = ', {p('p')})", ['graph', p('p')], LP('w, u, p = heapq.heappop(heap)'), 'mst'),
        label('v', f"{p('v')} < 0 ? 'v: —' : concat('v = ', {p('v')})", ['graph', p('v')], LP('for v, wv in adj[u]'), 'mst'),
        {**label('check', p('checkText'), None, LP('if seen[u]'), 'mst'), 'highlightExpr': f"{p('checkText')} != 'check: —'"},
        label('cost', f"concat('cost = ', {p('cost')})", None, LP('cost += w'), 'mst'),
        label('heap-len', f"concat('len(heap) = ', arrayCount({p('heapNames')}))", ['heap', '0'], LP('while heap'), 'mst'),
        label('result', f"concat('result: ', {p('result')})", None, LP('return cost, tree'), 'mst'),
    ]
    for f in ptrace:
        # The heap's entries and the tree's edges as text, for the arrays (a cell holds a string, not a pair).
        f['heapPairs'] = [[fr, v] for _, v, fr in f['heap'] if fr >= 0]
        f['heapNames'] = [f'{w}→{v}' for w, v, _ in f['heap']]
    for f in ktrace + ptrace:
        f['treeNames'] = [f'{a}–{b}' for a, b in f['tree']]
    return run_scene('mst', 'Connect everything cheaply (minimum spanning tree)', header, """**Signal:** connect all points or cities at the lowest total cost; "minimum cost to connect", a network with no wasted link.

A **spanning tree** uses n − 1 edges to connect all n nodes with no cycle. The **minimum** one has the smallest total weight. Both algorithms are greedy, and both rest on one fact, the **cut property**: split the nodes into two sides any way you like, and the cheapest edge crossing between the sides is safe to take.

## 1. Kruskal: cheapest edge first (this step)

Sort the edges by weight and walk the list. An edge whose ends are already in one group would close a **cycle** (red): skip it. Any other joins two pieces, so take it (green) and merge the groups, with **union-find** from the previous scene. Nodes are coloured by group, so you can watch the pieces merge. Stop once n − 1 edges are taken: here edge 0 – 3 completes the tree and the four dearest edges are never looked at.

## 2. Prim: grow one tree (next step)

Start from node 0 and keep a **min-heap** of edges leaving the tree (pink). Pop the cheapest; if it reaches a node already in the tree it is **stale**, skip it. Otherwise add the node and its edge, and push its edges to nodes outside. The heap is shown sorted; a real heap only keeps its minimum at the front.

Both find the same total, **22**, here even the same tree: with distinct weights the minimum spanning tree is unique.

**Cost:** Kruskal O(E log E) for the sort; Prim O(E log V) with a binary heap. Kruskal suits an edge list, Prim an adjacency list of a dense graph.

**Practice:** Min Cost to Connect All Points, Connecting Cities With Minimum Cost.""",
        'Explain the cut property and why each greedy choice is safe. Ask the learner to predict which edge Kruskal takes or skips next, and which edge Prim pops next.',
        'mst.py', MST_SOURCE, ktrace, kruskal, sections=mst_sections(),
        data={'mstNodes': nodes, 'mstSorted': [{'name': f'{a}–{b}', 'pair': [a, b]} for _, a, b in sorted_edges],
              'ufPalette': [{'c': col} for col in UF_PALETTE]},
        first={'title': 'Kruskal: cheapest edge first', 'description': 'Take each edge that joins two groups.'},
        more=[{'id': 'prim', 'title': 'Prim: grow one tree', 'description': 'Always add the cheapest edge leaving the tree.',
               'table': 'mst_prim', 'trace': ptrace, 'elements': prim}])


# ── 11. Dijkstra: a min-heap pops the closest unsettled node; relaxing its edges may shorten its neighbours' distances ──
DIJ_SOURCE = """import heapq

def dijkstra(n, adj, src):
    dist = [float('inf')] * n
    prev = [-1] * n
    dist[src] = 0
    heap = [(0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue  # stale: u was reached more cheaply
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = d + w  # relax: a shorter way to v
                prev[v] = u
                heapq.heappush(heap, (dist[v], v))
    return dist, prev"""
DIJ_N = 6
DIJ_EDGES = [(0, 1, 7), (0, 2, 2), (2, 1, 3), (1, 3, 1), (2, 3, 8), (2, 4, 5), (4, 3, 2), (3, 5, 4), (4, 5, 6)]
DIJ_POS = [(-6.0, 2.1), (-3.5, 3.6), (-3.5, 0.6), (-1.0, 3.6), (-1.0, 0.6), (1.5, 2.1)]
DIJ_DONE, DIJ_HEAP = '#77bfae', '#e67db0'


def dijkstra_trace():
    """Dijkstra from 0. Per frame: d, u (the popped entry); v, w, vi; dist and distText ('∞' until reached); prev;
    done (settled nodes, 1/0); heap (entries [d, v], sorted) and heapNames; checkText; result."""
    L = lambda t: line_of(DIJ_SOURCE, t)
    adj = [[(b, w) for a, b, w in DIJ_EDGES if a == i] for i in range(DIJ_N)]
    INF = float('inf')
    st = {'d': -1, 'u': -1, 'v': -1, 'w': -1, 'vi': -1, 'dist': [INF] * DIJ_N, 'prev': [-1] * DIJ_N, 'done': [0] * DIJ_N,
          'heap': [], 'checkText': 'check: —', 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        emit0(line, message)
        f = trace[-1]
        f['distText'] = ['∞' if x == INF else str(x) for x in f['dist']]
        f['dist'] = [-1 if x == INF else x for x in f['dist']]
        f['heapNames'] = [f'{d}:{v}' for d, v in f['heap']]
        f['inHeap'] = sorted({v for _, v in f['heap']})
    def put(key, i, x): st[key] = [x if j == i else y for j, y in enumerate(st[key])]
    emit(L('dist = [float'), 'Every distance starts unknown: ∞.')
    emit(L('prev = [-1] * n'), 'prev[v] will hold the node v is reached from, to rebuild the path.')
    put('dist', 0, 0)
    emit(L('dist[src] = 0'), 'The source is 0 away from itself.')
    st['heap'] = [[0, 0]]
    emit(L('heap = [(0, src)]'), 'The heap holds (distance, node) pairs; it starts with the source.')
    while st['heap']:
        emit(L('while heap'), f'{len(st["heap"])} entr{"ies" if len(st["heap"]) > 1 else "y"} waiting in the heap.')
        (d, u), st['heap'] = st['heap'][0], st['heap'][1:]
        st.update(d=d, u=u, v=-1, w=-1, vi=-1)
        emit(L('d, u = heapq.heappop(heap)'), f'Pop the closest: {u} at distance {d}.')
        if d > st['dist'][u]:
            st['checkText'] = f'd = {d} > dist[{u}] = {st["dist"][u]}: stale'
            emit(L('continue  # stale'), f'{u} was already reached for {st["dist"][u]}: this entry is stale, skip it.')
            st['checkText'] = 'check: —'
            continue
        put('done', u, 1)
        st['checkText'] = f'd = {d} = dist[{u}]: settled'
        emit(L('if d > dist[u]'), f'dist[{u}] = {d} is final: nothing left in the heap is closer, and no edge is negative.')
        for vi, (v, w) in enumerate(adj[u]):
            st.update(v=v, w=w, vi=vi)
            nd, old = d + w, st['dist'][v]
            oldText = '∞' if old == INF else str(old)
            st['checkText'] = f'd + w = {d} + {w} = {nd} ' + ('<' if nd < old else '≥') + f' dist[{v}] = {oldText}'
            emit(L('if d + w < dist[v]'), f'Through {u}, {v} is {nd} away; ' + (f'better than {oldText}.' if nd < old else f'no better than {oldText}.'))
            if nd < old:
                put('dist', v, nd)
                emit(L('dist[v] = d + w'), f'Relax: dist[{v}] = {nd}' + ('.' if old == INF else f', down from {old}.'))
                put('prev', v, u)
                emit(L('prev[v] = u'), f'The best way to {v} now comes from {u}.')
                st['heap'] = sorted(st['heap'] + [[nd, v]])
                emit(L('heapq.heappush(heap, (dist[v], v))'), f'Push ({nd}, {v})' + ('.' if old == INF else f'; the old ({old}, {v}) stays behind, stale.'))
            st['checkText'] = 'check: —'
        st.update(v=-1, w=-1, vi=-1)
    st.update(d=-1, u=-1, result=str(st['dist']))
    emit(L('return dist, prev'), f'Shortest distances from 0: {", ".join(map(str, st["dist"]))}. Following prev back gives each path.')
    return trace, adj


def dijkstra_sections():
    S = lambda *a, **k: section(DIJ_SOURCE, *a, **k)
    return [
        S('j-init', 'Distances unknown; the source at 0 in the heap', 'def dijkstra(', 'heap = [(0, src)]',
          hint='Every distance starts at infinity except the source; the heap holds (distance, node) and starts with the source.'),
        S('j-pop', 'Pop the closest; skip a stale entry', 'while heap', 'continue',
          hint='The smallest distance in the heap is final for its node, unless the node was already reached more cheaply.',
          prompt='Explain why the node popped with the smallest distance is final when no edge is negative, and why stale entries are skipped rather than removed.'),
        S('j-relax', 'Relax each edge: a shorter way?', 'for v, w in adj[u]', 'heapq.heappush', None,
          hint='If going through u is shorter than what v has, lower v\'s distance, remember u, and push the new entry.',
          prompt='Explain relaxation, and why pushing a new entry instead of updating the old one is correct.'),
        S('j-return', 'Distances and the path tree', 'return dist, prev', None),
    ]


def dijkstra_scene(header):
    trace, adj = dijkstra_trace()
    L = lambda t: line_of(DIJ_SOURCE, t)
    c = tr
    weights = [[next((w for a, b, w in DIJ_EDGES if (a, b) == (i, j)), 0) for j in range(DIJ_N)] for i in range(DIJ_N)]
    nodes = [{'x': x, 'y': y, 'adj': [b for b, _ in adj[i]], 'w': weights[i]} for i, (x, y) in enumerate(DIJ_POS)]
    cur = f"idx == {c('u')} and to == {c('v')}"
    path = f"arrayAt({c('prev')}, to) == idx"
    fill = (f"idx == {c('u')} ? '{GOLD}' : (arrayAt({c('done')}, idx) == 1 ? '{DIJ_DONE}' : "
            f"(keyIndex({c('inHeap')}, idx) >= 0 ? '{DIJ_HEAP}' : ''))")
    elements = [
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(DIJ_N), 'valueExpr': 'idx',
         'nodeShape': 'rect', 'nodeWidth': 0.75, 'nodeHeight': 0.75, 'nodeCornerRadius': 0.375, 'valueLabel': 'inside', 'showIndices': False,
         'positionExpr': ["dataTable('dijNodes', idx, 'x')", "dataTable('dijNodes', idx, 'y')", '0'], 'colorExpr': fill,
         # The edge each node's best distance comes through (prev) is thick: together they form the shortest-path tree.
         'connectTo': {'indexExpr': "dataTable('dijNodes', idx, 'adj')", 'pinned': True, 'arrow': True, 'color': '#4a5563',
                       'colorExpr': f"{cur} ? '{GOLD}' : ({path} ? '{DIJ_DONE}' : '')", 'highlightExpr': cur,
                       'widthExpr': f"{path} ? 3.2 : ({cur} ? 2.4 : 1.2)",
                       'labelExpr': "concat(arrayAt(dataTable('dijNodes', idx, 'w'), to))"}},
        {'id': 'heap', 'type': 'array', 'label': 'heap', 'codeSymbol': 'heap', 'labelSide': 'left', 'origin': [-2.3, -1.7, 0], 'cellSize': 1.0,
         'fontSize': 15, 'axisLabels': 'plane', 'itemType': 'text', 'color': DIJ_HEAP, 'showIndices': False,
         'lengthExpr': f"arrayCount({c('heapNames')})", 'valueExpr': f"arrayAt({c('heapNames')}, idx)",
         'highlightExpr': f"idx == 0 and {c('line')} == {L('while heap')}"},
        {'id': 'dist', 'type': 'array', 'label': 'dist', 'codeSymbol': 'dist', 'labelSide': 'left', 'origin': [-2.3, -3.0, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'itemType': 'text', 'lengthExpr': str(DIJ_N),
         'valueExpr': f"arrayAt({c('distText')}, idx)", 'colorExpr': f"arrayAt({c('done')}, idx) == 1 ? '{DIJ_DONE}' : ''",
         'highlightExpr': f"idx == {c('v')} or idx == {c('u')}"},
        {'id': 'prev', 'type': 'array', 'label': 'prev', 'codeSymbol': 'prev', 'labelSide': 'left', 'origin': [-2.3, -4.3, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'lengthExpr': str(DIJ_N), 'valueExpr': f"arrayAt({c('prev')}, idx)",
         'highlightExpr': f"idx == {c('v')} and {c('line')} == {L('prev[v] = u')}"},
        label('d', f"{c('d')} < 0 ? 'd: —' : concat('d = ', {c('d')})", None, L('d, u = heapq.heappop(heap)'), 'dijkstra'),
        label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], L('d, u = heapq.heappop(heap)'), 'dijkstra'),
        label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], L('for v, w in adj[u]'), 'dijkstra'),
        label('w', f"{c('w')} < 0 ? 'w: —' : concat('w = ', {c('w')})", None, L('for v, w in adj[u]'), 'dijkstra'),
        {**label('dist-v', f"{c('v')} < 0 ? 'dist[v]: —' : concat('dist[', {c('v')}, '] = ', arrayAt({c('distText')}, {c('v')}))",
                 ['dist', c('v')], L('dist[v] = d + w'), 'dijkstra'), 'highlightExpr': f"{c('v')} >= 0"},
        {**label('check', c('checkText'), None, L('if d + w < dist[v]'), 'dijkstra'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
        label('heap-len', f"concat('len(heap) = ', arrayCount({c('heapNames')}))", ['heap', '0'], L('while heap'), 'dijkstra'),
        label('result', f"concat('result: ', {c('result')})", None, L('return dist, prev'), 'dijkstra'),
    ]
    return run_scene('dijkstra', 'Cheapest route (Dijkstra)', header, """**Signal:** shortest or cheapest path when edges have **non-negative** weights: travel time, network delay, "minimum effort".

BFS finds shortest paths when every edge costs the same: nodes leave the queue in order of distance. With weights, a plain queue no longer does that, so Dijkstra uses a **min-heap** of (distance, node): it always pops the **closest** node not yet settled.

- **Settle:** when a node is popped, its distance is **final**. Anything still in the heap is at least as far, and with no negative edges a detour through it can only add. Settled nodes are green.
- **Relax:** for each edge u → v of weight w, if `dist[u] + w` beats `dist[v]`, lower it, record `prev[v] = u`, and push the new entry. Pink nodes wait in the heap.
- **Stale entries:** an improved node keeps its old, larger entry in the heap. When it is popped later, `d > dist[u]` gives it away: skip it. That is cheaper than finding and updating it.

Here the direct edge 0 → 1 costs 7, but 0 → 2 → 1 costs 2 + 3 = **5**, so 1 is relaxed twice and its (7, 1) entry turns stale; 3 drops from 10 to **6** the same way. The thick edges are each node's `prev`: the **shortest-path tree**, and following them back from any node gives its path.

**Negative edges break it:** a settled node could later be beaten by a path through a negative edge (use Bellman-Ford).

**Cost:** O((V + E) log V) with a binary heap.

**Practice:** Network Delay Time, Path with Minimum Effort, Cheapest Flights Within K Stops, Swim in Rising Water.""",
        'Explain why the popped node\'s distance is final when no edge is negative, what relaxation does, and why stale heap entries appear. Ask the learner to predict which node pops next and whether a relaxation improves the distance.',
        'dijkstra.py', DIJ_SOURCE, trace, elements, sections=dijkstra_sections(),
        data={'dijNodes': nodes},
        first={'title': 'Settle the closest, relax its edges', 'description': 'A min-heap pops the closest unsettled node.'})


# ── 12. 0-1 BFS: a deque in place of Dijkstra's heap; a 0-edge goes to the front, a 1-edge to the back ──
ZOB_SOURCE = """from collections import deque

def zero_one_bfs(n, adj, src):
    dist = [float('inf')] * n
    dist[src] = 0
    dq = deque([src])
    while dq:
        u = dq.popleft()
        for v, w in adj[u]:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                if w == 0:
                    dq.appendleft(v)  # as close as u: the front
                else:
                    dq.append(v)  # one step further: the back
    return dist"""
ZOB_N = 7
ZOB_EDGES = [(0, 1, 1), (0, 2, 0), (2, 3, 1), (2, 4, 0), (4, 1, 0), (1, 5, 1), (4, 6, 1), (3, 6, 0), (5, 6, 0)]
ZOB_POS = [(-6.0, 2.1), (-3.6, 3.7), (-3.6, 0.5), (-1.6, -0.6), (-1.6, 2.1), (0.8, 3.7), (0.8, 0.5)]
ZOB_LEVEL = ['#77bfae', '#6ea8e0', '#e5a65c']   # distance 0, 1, 2
ZOB_FREE = '#5fb3a3'                           # a 0-edge


def zero_one_trace():
    """0-1 BFS from 0. Per frame: u; v, w; dist (−1 for ∞) and distText; dq (the deque's nodes, front first) with dqNames
    ('dist:node' as pushed); end (1 front, 2 back: where the last push went, 0 none); checkText; result."""
    L = lambda t: line_of(ZOB_SOURCE, t)
    adj = [[(b, w) for a, b, w in ZOB_EDGES if a == i] for i in range(ZOB_N)]
    INF = float('inf')
    st = {'u': -1, 'v': -1, 'w': -1, 'dist': [INF] * ZOB_N, 'dq': [], 'end': 0, 'checkText': 'check: —', 'result': '—'}
    trace, emit0 = recorder(st)
    def emit(line, message):
        emit0(line, message)
        f = trace[-1]
        f['distText'] = ['∞' if x == INF else str(x) for x in f['dist']]
        f['dist'] = [-1 if x == INF else x for x in f['dist']]
        f['dqNames'] = [f'{d}:{v}' for d, v in f['dq']]
        f['dq'] = [v for _, v in f['dq']]
    def put(i, x): st['dist'] = [x if j == i else y for j, y in enumerate(st['dist'])]
    emit(L('dist = [float'), 'Every distance starts unknown: ∞.')
    put(0, 0)
    emit(L('dist[src] = 0'), 'The source is 0 away from itself.')
    st['dq'] = [[0, 0]]
    emit(L('dq = deque([src])'), 'The deque starts with the source. It stays sorted by distance: front closest.')
    while st['dq']:
        st['end'] = 0
        emit(L('while dq'), f'{len(st["dq"])} waiting; the front is the closest.')
        (pushed, u), st['dq'] = st['dq'][0], st['dq'][1:]
        st.update(u=u, v=-1, w=-1)
        emit(L('u = dq.popleft()'), f'Take {u} from the front: distance {st["dist"][u]}.' if pushed == st['dist'][u] else
             f'Take {u} again: an old entry, pushed at {pushed} before {u} was reached for {st["dist"][u]}. Its edges improve nothing now.')
        for v, w in adj[u]:
            st.update(v=v, w=w)
            du, old = st['dist'][u], st['dist'][v]
            oldText = '∞' if old == INF else str(old)
            better = du + w < old
            st['checkText'] = f'dist[u] + w = {du} + {w} = {du + w} ' + ('<' if better else '≥') + f' dist[{v}] = {oldText}'
            emit(L('if dist[u] + w < dist[v]'), f'{u} → {v} costs {w}: {v} would be {du + w} away; ' + ('better.' if better else f'no better than {oldText}.'))
            if not better:
                continue
            put(v, du + w)
            emit(L('dist[v] = dist[u] + w'), f'dist[{v}] = {du + w}' + ('.' if old == INF else f', down from {old}.'))
            st['checkText'] = 'check: —'
            if w == 0:
                st['dq'] = [[du, v]] + st['dq']; st['end'] = 1
                emit(L('dq.appendleft(v)'), f'A free edge: {v} is as close as {u}, so it goes to the front.')
            else:
                st['dq'] = st['dq'] + [[du + 1, v]]; st['end'] = 2
                emit(L('dq.append(v)'), f'A paid edge: {v} is one further, so it goes to the back.')
            st['end'] = 0
        st.update(v=-1, w=-1, checkText='check: —')
    st.update(u=-1, result=str(st['dist']))
    emit(L('return dist'), f'Distances from 0: {", ".join(map(str, st["dist"]))}. Only the paid edges count.')
    return trace, adj


def zero_one_sections():
    S = lambda *a, **k: section(ZOB_SOURCE, *a, **k)
    return [
        S('z-init', 'Distances unknown; the source in the deque', 'def zero_one_bfs(', 'dq = deque([src])',
          hint='Every distance is infinity but the source\'s; the deque starts with the source.'),
        S('z-take', 'Take the closest from the front', 'while dq', 'u = dq.popleft()',
          hint='The front of the deque is always the closest node waiting.'),
        S('z-relax', 'A shorter way? Front for free, back for one', 'for v, w in adj[u]', 'dq.append(v)',
          hint='If going through u is shorter, lower v\'s distance; a free edge puts v at the front, a paid one at the back.',
          prompt='Explain why pushing 0-edges to the front and 1-edges to the back keeps the deque sorted by distance, so that it works like Dijkstra\'s heap.'),
        S('z-return', 'Every distance from the source', 'return dist', None),
    ]


def zero_one_scene(header):
    trace, adj = zero_one_trace()
    L = lambda t: line_of(ZOB_SOURCE, t)
    c = tr
    weights = [[next((w for a, b, w in ZOB_EDGES if (a, b) == (i, j)), 0) for j in range(ZOB_N)] for i in range(ZOB_N)]
    nodes = [{'x': x, 'y': y, 'adj': [b for b, _ in adj[i]], 'w': weights[i]} for i, (x, y) in enumerate(ZOB_POS)]
    cur = f"idx == {c('u')} and to == {c('v')}"
    free = "arrayAt(dataTable('zobNodes', idx, 'w'), to) == 0"
    level = lambda i: f"arrayAt({c('dist')}, {i})"
    fill = f"idx == {c('u')} ? '{GOLD}' : ({level('idx')} == 0 ? '{ZOB_LEVEL[0]}' : ({level('idx')} == 1 ? '{ZOB_LEVEL[1]}' : ({level('idx')} >= 2 ? '{ZOB_LEVEL[2]}' : '')))"
    dq_last = f"arrayCount({c('dq')}) - 1"
    elements = [
        {'id': 'graph', 'type': 'graph', 'label': 'graph', 'lengthExpr': str(ZOB_N), 'valueExpr': 'idx',
         'nodeShape': 'rect', 'nodeWidth': 0.75, 'nodeHeight': 0.75, 'nodeCornerRadius': 0.375, 'valueLabel': 'inside', 'showIndices': False,
         'positionExpr': ["dataTable('zobNodes', idx, 'x')", "dataTable('zobNodes', idx, 'y')", '0'],
         # A node takes its distance's colour: green 0, blue 1, orange 2.
         'colorExpr': fill,
         # Free edges (weight 0) are teal, paid ones (weight 1) grey; each is labelled with its weight.
         'connectTo': {'indexExpr': "dataTable('zobNodes', idx, 'adj')", 'pinned': True, 'arrow': True, 'color': '#5a6573',
                       'colorExpr': f"{cur} ? '{GOLD}' : ({free} ? '{ZOB_FREE}' : '')", 'highlightExpr': cur,
                       'widthExpr': f"{cur} ? 2.6 : ({free} ? 2 : 1.2)",
                       'labelExpr': "concat(arrayAt(dataTable('zobNodes', idx, 'w'), to))"}},
        {'id': 'dq', 'type': 'array', 'label': 'dq', 'codeSymbol': 'dq', 'labelSide': 'left', 'origin': [-2.3, -2.0, 0], 'cellSize': 1.05,
         'fontSize': 15, 'axisLabels': 'plane', 'itemType': 'text', 'color': '#e67db0', 'showIndices': False,
         'lengthExpr': f"arrayCount({c('dqNames')})", 'valueExpr': f"arrayAt({c('dqNames')}, idx)",
         # The cell just pushed: the front for a free edge, the back for a paid one.
         'highlightExpr': f"({c('end')} == 1 and idx == 0) or ({c('end')} == 2 and idx == {dq_last})"},
        {'id': 'dist', 'type': 'array', 'label': 'dist', 'codeSymbol': 'dist', 'labelSide': 'left', 'origin': [-2.3, -3.6, 0], 'cellSize': 1.0,
         'fontSize': 15, 'indexFontSize': 10, 'axisLabels': 'plane', 'itemType': 'text', 'lengthExpr': str(ZOB_N),
         'valueExpr': f"arrayAt({c('distText')}, idx)", 'colorExpr': fill.replace(f"idx == {c('u')} ? '{GOLD}' : ", ''),
         'highlightExpr': f"idx == {c('v')} or idx == {c('u')}"},
        *[{'id': f'dq-{k}', 'type': 'text', 'text': t, 'position': [x, -1.3, 0], 'color': '#8aa0b8', 'fontSize': 11}
          for k, (t, x) in enumerate([('front ←', -2.3), ('→ back', 2.4)])],
        label('u', f"{c('u')} < 0 ? 'u: —' : concat('u = ', {c('u')})", ['graph', c('u')], L('u = dq.popleft()'), 'zero-one-bfs'),
        label('v', f"{c('v')} < 0 ? 'v: —' : concat('v = ', {c('v')})", ['graph', c('v')], L('for v, w in adj[u]'), 'zero-one-bfs'),
        label('w', f"{c('w')} < 0 ? 'w: —' : concat('w = ', {c('w')})", None, L('for v, w in adj[u]'), 'zero-one-bfs'),
        {**label('dist-v', f"{c('v')} < 0 ? 'dist[v]: —' : concat('dist[', {c('v')}, '] = ', arrayAt({c('distText')}, {c('v')}))",
                 ['dist', c('v')], L('dist[v] = dist[u] + w'), 'zero-one-bfs'), 'highlightExpr': f"{c('v')} >= 0"},
        {**label('check', c('checkText'), None, L('if dist[u] + w < dist[v]'), 'zero-one-bfs'), 'highlightExpr': f"{c('checkText')} != 'check: —'"},
        label('dq-len', f"concat('len(dq) = ', arrayCount({c('dq')}))", ['dq', '0'], L('while dq'), 'zero-one-bfs'),
        label('result', f"concat('result: ', {c('result')})", None, L('return dist'), 'zero-one-bfs'),
    ]
    return run_scene('zero-one-bfs', 'Weights of 0 or 1 (0-1 BFS)', header, """**Signal:** shortest path where every edge costs **0 or 1**: free moves and paid moves. "Minimum obstacles to remove", "minimum arrows to flip", walls you may break.

Dijkstra needs a heap only to keep the waiting nodes **sorted by distance**. With weights of only 0 and 1, a **deque** stays sorted by itself:

- **Free edge (0):** v is exactly as far as u, the closest waiting node. It belongs at the **front**: `appendleft`.
- **Paid edge (1):** v is one further. Nothing waiting is further than that, so it belongs at the **back**: `append`.

So the deque only ever holds two distances, d at the front and d + 1 behind them, and `popleft` always takes the closest node, as Dijkstra's heap would, in O(1) instead of O(log V). Each cell reads **distance:node**.

Here 1 is first reached by the paid edge 0 → 1 at distance 1, then by the free path 0 → 2 → 4 → 1 at distance **0**. It goes to the front, and its old entry at the back is taken later and finds nothing to improve: a node can sit in the deque twice, harmlessly. Teal edges are free; a node's colour is its distance (green 0, blue 1).

With every weight 1, this is plain BFS; with weights larger than 1, use Dijkstra.

**Cost:** O(V + E).

**Practice:** Minimum Cost to Make at Least One Valid Path in a Grid, Minimum Obstacle Removal to Reach Corner.""",
        'Explain why a free edge goes to the front and a paid edge to the back, and why that keeps the deque sorted like Dijkstra\'s heap. Ask the learner to predict where each push goes and which node is taken next.',
        'zero_one_bfs.py', ZOB_SOURCE, trace, elements, sections=zero_one_sections(),
        data={'zobNodes': nodes},
        first={'title': 'Free edges to the front, paid to the back', 'description': 'A deque that stays sorted by distance.'})


def code_sections(scene_id):
    """The teaching structure of each scene's code file (cycle.py has its own, cycle_sections)."""
    if scene_id == 'representations':
        S = lambda *a, **k: section(REPR_SOURCE, *a, **k)
        return [
            S('r-empty', 'Start empty: a list per node, a grid of zeros', 'def build(', 'matrix = [[0]',
              hint='Make room for n nodes twice: an empty neighbour list for each, and an n by n grid of zeros.'),
            S('r-edges', 'Record each edge both ways', 'for u, v in edges', 'matrix[u][v]',
              hint='An undirected edge joins u and v in both directions: add each to the other\'s list and set both grid cells.',
              prompt='Explain why each edge is recorded twice, in both the list and the matrix, and what each form costs in space and in lookup time.'),
            S('r-return', 'Hand back both forms', 'return adj, matrix', None,
              hint='Return the adjacency list and the matrix.'),
        ]
    if scene_id == 'dfs':
        S = lambda *a, **k: section(DFS_SOURCE, *a, **k)
        return [
            S('d-init', 'Nothing visited, no order yet', 'def dfs_order(', 'order = []',
              hint='Remember which nodes were visited, and the order they were reached in.'),
            S('d-visit', 'Visit u: mark it, record it', 'def dfs(u)', 'order.append(u)',
              hint='On arriving at u, mark it visited at once, so no other path enters it again, and record it.'),
            S('d-deeper', 'Go deeper into each new neighbour', 'for v in adj[u]', 'dfs(v)',
              hint='For each neighbour not seen yet, go all the way down from it before trying the next one.',
              prompt='Explain how this loop and the recursive call make the search go deep first, and what the call stack holds while it does.'),
            S('d-start', 'Start at 0, return the order', 'dfs(0)', 'return order',
              hint='Start the search at node 0; the order is the answer.'),
        ]
    if scene_id == 'bfs':
        S = lambda *a, **k: section(BFS_SOURCE, *a, **k)
        return [
            S('b-init', 'The start: distance 0, waiting in the queue', 'def bfs(', 'queue = deque',
              hint='Every distance starts unknown (-1); the start is 0 away and is the first to wait in the queue.'),
            S('b-take', 'Take the node that waited longest', 'while queue', 'u = queue.popleft()',
              hint='While anything waits, take from the front: the queue hands nodes out in order of distance.'),
            S('b-discover', 'Discover each new neighbour one step further', 'for v in adj[u]', 'queue.append(v)',
              hint='A neighbour with no distance yet is one step further than u: set it, and queue it.',
              prompt='Explain why setting the distance when a node is queued (not when it is taken) keeps it from being queued twice, and why the first distance found is the shortest.'),
            S('b-return', 'Every distance from the start', 'return dist', None,
              hint='Return the distances; -1 marks a node that cannot be reached.'),
        ]
    if scene_id == 'degrees':
        S = lambda *a, **k: section(DEGREES_SOURCE, *a, **k)
        return [
            S('j-count', 'Count edges in and out', 'def find_judge(', 'indeg[b] += 1',
              hint='For each trust pair a → b, a trusts one more person and b is trusted by one more.'),
            S('j-test', 'Find who all trust and who trusts no one', 'for p in range(n)', 'return -1',
              hint='The judge is trusted by the other n - 1 and trusts nobody; if no one fits, there is none.'),
            S('t-build', 'Build the tree and each node\'s degree', 'def tree_centers(', 'degree[v] += 1',
              hint='Record each edge in both lists, and count how many edges touch each node.'),
            S('t-leaves', 'Start from the leaves', 'leaves = deque(', 'remaining = n',
              hint='The nodes with a single edge are the outer layer; n nodes remain.'),
            S('t-peel', 'Peel one layer of leaves at a time', 'while remaining > 2', 'leaves.append(nb)',
              hint='Remove the whole current layer; a neighbour left with one edge becomes a leaf of the next layer.',
              prompt='Explain why peeling the leaves layer by layer ends at the centre of the tree, and why at most two nodes can remain.'),
            S('t-centers', 'What is left is the centre', 'return list(leaves)', None,
              hint='When two or fewer nodes remain, they are the centre.'),
        ]
    if scene_id == 'grid-graphs':
        S = lambda *a, **k: section(GRID_SOURCE, *a, **k)
        F, B = 'def flood_fill(', 'def flood_fill_bfs('
        return [
            S('f-guard', 'Note the old colour; stop if it is already the new one', F, 'return image',
              hint='Remember the colour being replaced; if it already is the new colour, nothing would ever stop the fill.'),
            S('f-stop', 'Stop outside the image or at another colour', 'def fill(r, c)', 'return', F,
              hint='A cell off the image, or one not of the old colour, ends this branch of the fill.'),
            S('f-paint', 'Paint the cell, spread to its four neighbours', 'image[r][c] = color', 'fill(r + dr, c + dc)', F,
              hint='Painting a cell also marks it visited; then try the cells below, above, right and left.',
              prompt='Explain why painting the cell before the recursive calls keeps the fill from looping, and how the four calls cover the whole region.'),
            S('f-start', 'Start the fill at the chosen cell', 'fill(sr, sc)', 'return image', F,
              hint='Fill from the starting cell and return the image.'),
            S('q-guard', 'Note the old colour; stop if it is already the new one', B, 'return image', B,
              hint='The same check as the recursive version.'),
            S('q-seed', 'Paint the start and queue it', 'image[sr][sc] = color', 'queue = deque', B,
              hint='Paint the start cell when it is queued, so it is never queued again.'),
            S('q-spread', 'Take a cell, paint and queue its same-coloured neighbours', 'while queue', 'queue.append((nr, nc))', B,
              hint='Take the oldest cell; each neighbour inside the image with the old colour is painted and queued.',
              prompt='Explain why this version paints a cell when it is queued rather than when it is taken, and how its order of painting differs from the recursive fill.'),
            S('q-return', 'Return the painted image', 'return image', None, 'queue.append((nr, nc))',
              hint='When the queue is empty the region is painted.'),
        ]
    return []


# ── One scene per algorithm: a built one where there is a builder, else a placeholder ──
codeFiles = []
BUILT = {'representations': representations_scene, 'dfs': dfs_scene, 'bfs': bfs_scene, 'degrees': degrees_scene, 'grid-graphs': grid_scene,
         'cycle-detection': cycle_scene, 'bipartite': bipartite_scene, 'topological-sort': topo_scene,
         'union-find': uf_scene, 'mst': mst_scene,
         'dijkstra': dijkstra_scene, 'zero-one-bfs': zero_one_scene}
for i, (sid, short, title, tier, after, signal, idea, cost, practice) in enumerate(ALGORITHMS):
    header = f"**Tier:** {TIERS[tier][0]} ({TIERS[tier][2]})" + (' · **Builds on:** ' + ', '.join(SHORT[b] for b in after) if after else '')
    if sid in BUILT:
        scenes.append(BUILT[sid](header))
        continue
    scenes.append({
        'id': sid, 'title': title, 'description': f'Signal: {signal}', 'range': RANGE, 'camera': cam,
        'markdown': f"""# {title}

{header}

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
