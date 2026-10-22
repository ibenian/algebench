"""Write scenes/draft/test-array.json: test scenes for the array family's keyed form, the dict element: keys of
every kind (string, number, tuple), the vertical column with keys on the left, and links to, from and between
entries (keyIndex), all in math.js.

Run: ./run.sh scripts/lesson_builders/test-array/build.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts'))
from _json_format import dumps_compact_leaves  # noqa: E402

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

# A dict: an array whose cells are entries, with each key shown where an array shows its index (rounded cells).
counts = [('apple', 3), ('kiwi', 1), ('fig', 2), ('plum', 5), ('pear', 4)]
cells = [((0, 0), 'land'), ((0, 1), 'water'), ((1, 2), 'land'), ((3, 1), 'land')]
seen = [(2, 0), (7, 1), (11, 2), (15, 3)]
scenes.append(scene('dict', 'Dictionary (string, tuple and number keys)', """# Dictionary

A `dict` element is an array whose cells are the entries in insertion order, with each **key** shown where an array shows its index: a string (`'apple'`), a number (`7`) or a tuple (`(0, 1)`), printed as Python would. Entries are rounded rectangles. Markers, links and highlights work as on an array, by entry position.

With `arrayLayout: 'vertical'` the entries stack down a column, first on top, each key to the left of its cell (`stock`).

Move **n** to add or remove entries.""", [
    {'id': 'counts', 'type': 'dict', 'label': 'counts', 'origin': [-4.0, 2.6, 0], 'lengthExpr': 'n',
     'keyExpr': "dataTable('counts', idx, 'k')", 'valueExpr': "dataTable('counts', idx, 'v')", 'highlightExpr': 'idx == n - 1',
     'axisLabels': 'plane'},
    {'id': 'cells', 'type': 'dict', 'label': 'cells', 'origin': [-4.0, 0.2, 0], 'cellSize': 1.9, 'lengthExpr': f'min(n, {len(cells)})',
     'keyExpr': "dataTable('cells', idx, 'k')", 'valueExpr': "dataTable('cells', idx, 'v')", 'axisLabels': 'plane'},
    {'id': 'seen', 'type': 'dict', 'label': 'seen', 'origin': [-4.0, -2.2, 0], 'lengthExpr': f'min(n, {len(seen)})',
     'keyExpr': "dataTable('seen', idx, 'k')", 'valueExpr': "dataTable('seen', idx, 'v')", 'axisLabels': 'plane',
     'markers': [{'type': 'step_marker', 'indexName': 'last', 'indexExpr': f'min(n, {len(seen)}) - 1', 'color': '#f1cc59'}]},
    # The same entries stacked down a column, keys on the left.
    {'id': 'stock', 'type': 'dict', 'label': 'stock', 'arrayLayout': 'vertical', 'origin': [5.9, 2.6, 0], 'lengthExpr': 'n',
     'keyExpr': "dataTable('counts', idx, 'k')", 'valueExpr': "dataTable('counts', idx, 'v')", 'highlightExpr': 'idx == n - 1',
     'axisLabels': 'plane'},
], sliders=[slider('n', 'n entries', 0, len(counts), 3)], data={
    'counts': [{'k': k, 'v': v} for k, v in counts],
    'cells': [{'k': list(k), 'v': v} for k, v in cells],
    'seen': [{'k': k, 'v': v} for k, v in seen],
}))

# Links to, from and between dict entries. Entries are named by position; keyIndex(keys, key) finds the
# position of a key, so a link can say "the entry for this key".
fruits = ['apple', 'kiwi', 'fig', 'plum']
stock = {'apple': 3, 'kiwi': 1, 'fig': 2, 'plum': 5}
shelf_of = {'apple': 0, 'kiwi': 2, 'fig': 2, 'plum': 1}
basket = ['fig', 'apple', 'fig', 'plum', 'kiwi']
spots = [((0, 1), 'apple'), ((1, 0), 'plum'), ((2, 2), 'kiwi')]
KEYS = "dataTable('stock', 'key')"   # the stock table's key column, as a list
scenes.append(scene('dict-links', 'Dictionary links (to, from and between entries)', """# Dictionary links

A dict entry is a cell, so everything that links cells links entries. **keyIndex(keys, key)** gives the position of a key (or −1); `dataTable('stock', 'key')` reads the table's key column as that list, so a link, marker or label can name *the entry for a key*:

- **basket → stock**: each basket cell links to the stock entry whose key is its fruit: `keyIndex(keys, value)`.
- **stock → shelves**: each entry links out to the shelf it sits on.
- **spots → stock**: a dict with tuple keys links to another dict, by the fruit each spot holds.
- **pick** and **stock[pick]**: rows wired to the entry for the picked key, and a marker on it that names the key.

Move **pick** to choose a fruit.""", [
    {'id': 'basket', 'type': 'array', 'label': 'basket', 'labelSide': 'left', 'itemType': 'string', 'origin': [-4.4, 3.0, 0],
     'cellSize': 1.4, 'values': basket, 'axisLabels': 'plane',
     'highlightExpr': f"keyIndex({KEYS}, value) == pick",
     'connectTo': {'object': 'stock', 'indexExpr': f'keyIndex({KEYS}, value)', 'arrow': True, 'pinned': True, 'color': '#8aa0b8',
                   'highlightExpr': f"keyIndex({KEYS}, value) == pick"}},
    {'id': 'stock', 'type': 'dict', 'label': 'stock', 'arrayLayout': 'vertical', 'origin': [4.4, 1.6, 0], 'lengthExpr': str(len(fruits)),
     'keyExpr': "dataTable('stock', idx, 'key')", 'valueExpr': "dataTable('stock', idx, 'count')", 'axisLabels': 'plane',
     'highlightExpr': 'idx == pick',
     'markers': [{'type': 'step_marker', 'indexName': 'pick', 'indexExpr': 'pick', 'color': '#f1cc59'}],
     'connectTo': {'object': 'shelves', 'indexExpr': "dataTable('stock', idx, 'shelf')", 'arrow': True, 'pinned': True, 'color': '#c792ea',
                   'highlightExpr': 'idx == pick'}},
    {'id': 'shelves', 'type': 'array', 'label': 'shelves', 'labelSide': 'left', 'itemType': 'string', 'origin': [-4.4, -3.4, 0],
     'values': ['top', 'middle', 'bottom'], 'cellSize': 1.6, 'axisLabels': 'plane',
     'highlightExpr': "idx == dataTable('stock', pick, 'shelf')"},
    {'id': 'spots', 'type': 'dict', 'label': 'spots', 'origin': [-4.4, 0.2, 0], 'cellSize': 1.7, 'lengthExpr': str(len(spots)),
     'keyExpr': "dataTable('spots', idx, 'k')", 'valueExpr': "dataTable('spots', idx, 'v')", 'axisLabels': 'plane',
     'connectTo': {'object': 'stock', 'indexExpr': f"keyIndex({KEYS}, value)", 'arrow': True, 'pinned': True, 'color': '#74d0c2',
                   'highlightExpr': f"keyIndex({KEYS}, value) == pick"}},
    # pick, the key being looked at, in the same box (labels at one position merge), wired to its entry.
    {'id': 'pick-var', 'type': 'expression_label', 'position': [1.2, -1.6, 0],
     'textExpr': "concat('pick = ', dataTable('stock', pick, 'shown'))",
     'connectTo': {'object': 'stock', 'indexExpr': 'pick'}},
    {'id': 'pick-label', 'type': 'expression_label', 'position': [1.2, -1.6, 0],
     # The label's text comes from the data: an expression holding "['" would read as JavaScript to the trust scan.
     'textExpr': "dataTable('stock', pick, 'label')",
     'connectTo': {'object': 'stock', 'indexExpr': f"keyIndex({KEYS}, dataTable('stock', pick, 'key'))"}},
], sliders=[slider('pick', 'pick (fruit)', 0, len(fruits) - 1, 1)], data={
    # Each entry's key lives in its row; 'shown' is the key as Python prints it, for the pick row (math.js cannot add quotes).
    'stock': [{'key': f, 'count': stock[f], 'shelf': shelf_of[f], 'shown': f"'{f}'", 'label': f"stock['{f}'] = {stock[f]}"} for f in fruits],
    'spots': [{'k': list(k), 'v': v} for k, v in spots],
}))

# A list of references to dicts: each cell holds the id of the dict it refers to, and objectExpr turns that
# into a link to the whole dict. alias makes people[2] refer to the same dict as people[0] (two arrows in).
records = {'p0': [('name', 'Ana'), ('age', 31)], 'p1': [('name', 'Bo'), ('age', 27)], 'p2': [('name', 'Cy'), ('age', 40)]}
scenes.append(scene('list-of-dicts', 'List of dicts (references to whole objects)', """# List of dicts

`people = [{...}, {...}, {...}]` holds **references**: each cell names the dict it points to, and the dict is an object of its own. The list's links use **objectExpr** to pick the target per cell (here the cell's value, the dict's id) and leave out indexExpr, so each arrow points at the **whole dict**.

- **alias**: `people[2] = people[0]`. Two cells now refer to the same dict: two arrows into it, and nothing points at Cy any more.
- **who**: lights one reference.
- **ages**: a link *with* indexExpr points into a dict instead: `keyIndex(dataTable(value, 'key'), 'age')` finds the entry for `'age'` in the dict the cell names.""", [
    {'id': 'people', 'type': 'array', 'label': 'people', 'labelSide': 'left', 'itemType': 'string', 'origin': [-2.6, 3.2, 0],
     'cellSize': 1.4, 'lengthExpr': '3', 'valueExpr': "idx == 2 and alias == 1 ? 'p0' : concat('p', idx)", 'axisLabels': 'plane',
     'highlightExpr': 'idx == who',
     'connectTo': {'objectExpr': 'value', 'arrow': True, 'pinned': True, 'color': '#8aa0b8', 'highlightExpr': 'idx == who'}},
    *[{'id': pid, 'type': 'dict', 'label': pid, 'arrayLayout': 'vertical', 'origin': [-3.6 + 3.8 * k, 0.4, 0], 'lengthExpr': str(len(rows)),
       'keyExpr': f"dataTable('{pid}', idx, 'key')", 'valueExpr': f"dataTable('{pid}', idx, 'value')", 'axisLabels': 'plane'}
      for k, (pid, rows) in enumerate(records.items())],
    {'id': 'ages', 'type': 'array', 'label': 'ages', 'labelSide': 'left', 'itemType': 'string', 'origin': [-2.6, -3.4, 0],
     'cellSize': 1.4, 'values': ['p0', 'p1', 'p2'], 'axisLabels': 'plane',
     'connectTo': {'objectExpr': 'value', 'indexExpr': "keyIndex(dataTable(value, 'key'), 'age')", 'arrow': True, 'pinned': True, 'color': '#c792ea'}},
], sliders=[slider('alias', 'alias people[2] = people[0]', 0, 1, 0), slider('who', 'who', 0, 2, 0)],
    data={pid: [{'key': k, 'value': v} for k, v in rows] for pid, rows in records.items()}))

lesson = {'title': 'Array and dict · test scenes', 'scenes': scenes}
out = ROOT / 'scenes/draft/test-array.json'
out.write_text(dumps_compact_leaves(lesson) + '\n')
print('wrote', out, len(scenes), 'scenes')
