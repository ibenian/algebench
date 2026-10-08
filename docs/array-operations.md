# Array operations

Arrays display data; operations never mutate a renderer or couple visual objects.
The following sandbox helpers produce new values on binding updates:

```text
arrayValues(source, operation, a, b)   → resulting sequence
arrayResult(source, operation, a, b)   → readable return value
arrayCount(source)                    → length
arrayAt(source, index)                → primitive value
```

`source` is a primitive array or math.js vector. Values retain their types.
Every operation preserves its input. Arrays are limited to 256 cells; invalid
indices, nonprimitive values, and unsupported operation names raise errors.

| Operation | a | b | Return value |
| --- | --- | --- | --- |
| length | — | — | length |
| get, traverse | index | — | cell value |
| set | index | value | assigned value |
| insert | index (0 through length) | value | new length |
| remove | index | — | removed value |
| push, unshift | value | — | new length |
| pop, shift | — | — | removed value, or ∅ when empty |
| swap | first index | second index | resulting sequence |
| reverse, sort | — | — | resulting sequence |
| indexOf | sought value | — | first exact matching index, or -1 |
| includes | sought value | — | true or false |
| slice | start index | end index (exclusive) | copied subsequence |
| concat | other sequence | — | joined sequence |
| fill | value | — | resulting sequence |
| resize | new length | fill value (when growing) | new length |
| clear | — | — | zero |

Sort accepts homogeneous finite numbers or strings. String order uses Unicode
code-unit order; numeric sort is numeric. Slice bounds must be within the array
and end cannot precede start. `arrayValues` for read-only operations returns an
unchanged copy; `arrayResult` provides their result. For slice, `arrayValues`
returns the slice, while the source remains unchanged.

Example: bind an array's length and values to an insertion:

```json
{
  "type": "array",
  "itemType": "number",
  "lengthExpr": "arrayCount(arrayValues([10,20,30], 'insert', 1, 99))",
  "valueExpr": "arrayAt(arrayValues([10,20,30], 'insert', 1, 99), idx)",
  "origin": [-3, 0, 0],
  "cellSize": 2,
  "fontSize": 14,
  "showIndices": true,
  "indexFontSize": 10
}
```

The draft Code panel lesson includes **Array operations**, with 25 independent
before/after examples and a state player. Gold highlights changed or selected
slots. Traversal visits all four indices in separate execution states. Empty
results are explicitly labelled.

## Automatic change illumination

Array renderers compare each successfully evaluated state with the last visible
state at the same slot indices. Updated and added cells receive a soft gold rim
and a brighter face; removed slots leave faint blue outline footprints. Effects
remain until the next state change. The first display has no change effect.
Backward steps and jumps use the state actually shown before the navigation.
An equal-valued next state clears the effect, while duplicate binding rebuilds
preserve it. Value types are part of the comparison; authored selection colors
alone do not count as value changes.

Comparison and glow geometry updates run on binding changes, never each frame.
The glow follows world coordinates, zoom and camera rotation. It shares the
array's visibility and resource lifetime and is excluded from wire targeting.
