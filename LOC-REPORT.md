# Lines of Code Report

> **Auto-generated** by [`scripts/loc-report.sh`](scripts/loc-report.sh) — do not edit manually.

| Field | Value |
|---|---|
| **Branch** | `fix/code-scanning-32-xss-dom` |
| **Commit** | `b02484a` |
| **Date** | 2026-05-16 22:57:50 -0400 |

## Language Breakdown

> [!NOTE]
> Chart renders on GitHub and in Mermaid-compatible viewers.

```mermaid
xychart-beta horizontal
  title "Lines of Code by Language"
  x-axis ["JSON", "JavaScript", "Python", "CSS", "HTML", "Shell", "BASH"]
  bar [49536, 15572, 11740, 4219, 395, 137, 33]
```

## Summary by Language

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Language              Files        Lines         Code     Comments       Blanks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 JSON                     41        49537        49536            0            1
 JavaScript               46        18003        15572          971         1460
 Python                   31        15213        11740         1724         1749
 CSS                       3         4581         4219          169          193
 Shell                     2          172          137           14           21
 BASH                      1           41           33            4            4
 Plain Text                1            9            0            9            0
─────────────────────────────────────────────────────────────────────────────────
 HTML                      3          412          395            7           10
 |- CSS                    2          124          119            5            0
 |- JavaScript             2          580          513           11           56
 (Total)                             1116         1027           23           66
─────────────────────────────────────────────────────────────────────────────────
 Markdown                 55        10500            0         7918         2582
 |- BASH                  13          169          147           14            8
 |- JavaScript             1           10            6            3            1
 |- JSON                  33         1318         1318            0            0
 |- Markdown               1            1            0            1            0
 |- Python                 2           38           30            2            6
 (Total)                            12036         1501         7938         2597
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Total                   183       100708        83765        10852         6091
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Frontend Assets (per file)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Language              Files        Lines         Code     Comments       Blanks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 JavaScript               46        18003        15572          971         1460
─────────────────────────────────────────────────────────────────────────────────
 |bench/static/graph-view.js         2140         1664          319          157
 |nch/static/json-browser.js         1403         1361            5           37
 |panel/d3-semantic-graph.js         1452         1173          117          162
 |h/algebench/static/chat.js         1429         1164          113          152
 |lgebench/static/overlay.js         1168         1101           29           38
 |/algebench/static/proof.js         1109         1040           33           36
 |nch/static/scene-loader.js          942          801           46           95
 |algebench/static/camera.js          760          646           20           94
 |cislunar-dynamics/index.js          611          546            8           57
 |objects/animated-vector.js          533          487            3           43
 |lgebench/static/sliders.js          526          444           30           52
 |bench/static/follow-cam.js          455          417            5           33
 |graph-panel/graph-panel.js          542          410           87           45
 |nch/algebench/static/ui.js          398          342           10           46
 |atmospheric-entry/index.js          373          335            8           30
 |h/algebench/static/expr.js          356          326           20           10
 |bjects/animated-polygon.js          343          304            6           33
 |/static/objects/polygon.js          328          285           12           31
 |/objects/animated-curve.js          319          284            2           33
 |algebench/static/labels.js          327          279           22           26
 |ins/astrodynamics/index.js          228          198           10           20
 |h/static/objects/skybox.js          225          196            3           26
 |jects/animated-cylinder.js          147          134            1           12
 |/objects/animated-point.js          148          132            1           15
 |h/algebench/static/main.js          152          124           19            9
 |/algebench/static/trust.js          131          112            6           13
 |h/static/objects/vector.js          121          109            0           12
 |c/objects/animated-line.js          112           99            1           12
 |ects/parametric-surface.js          106           96            0           10
 |/algebench/static/state.js          122           92           17           13
 |h/static/objects/sphere.js           99           89            0           10
 |static/objects/cylinder.js           99           88            0           11
 |bjects/parametric-curve.js           92           84            0            8
 |/static/context-browser.js           89           69            5           15
 |tatic/objects/ellipsoid.js           74           66            0            8
 |ic/objects/vector-field.js           72           64            0            8
 |nch/static/objects/text.js           68           59            0            9
 |nch/static/objects/axis.js           62           56            0            6
 |algebench/static/coords.js           71           53           13            5
 |ch/static/objects/index.js           54           53            0            1
 |/static/objects/surface.js           52           48            0            4
 |ch/static/objects/plane.js           50           43            0            7
 |nch/static/objects/line.js           36           32            0            4
 |nch/static/objects/grid.js           33           30            0            3
 |/static/objects/vectors.js           23           19            0            4
 |ch/static/objects/point.js           23           18            0            5
─────────────────────────────────────────────────────────────────────────────────
 CSS                       3         4581         4219          169          193
─────────────────────────────────────────────────────────────────────────────────
 |algebench/static/style.css         4176         3853          156          167
 |anel/d3-semantic-graph.css          291          258           12           21
 |raph-panel/graph-panel.css          114          108            1            5
─────────────────────────────────────────────────────────────────────────────────
 HTML                      1          356          345            7            4
─────────────────────────────────────────────────────────────────────────────────
 |lgebench/static/index.html          356          345            7            4
─────────────────────────────────────────────────────────────────────────────────
 JSON                      3          319          319            0            0
─────────────────────────────────────────────────────────────────────────────────
 |ns/astrodynamics/docs.json          156          156            0            0
 |islunar-dynamics/docs.json          122          122            0            0
 |tmospheric-entry/docs.json           41           41            0            0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Total                    53        23259        20455         1147         1657
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Backend Python (per file)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Language              Files        Lines         Code     Comments       Blanks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Python                   31        15213        11740         1724         1749
─────────────────────────────────────────────────────────────────────────────────
 |ebench/algebench/server.py         2991         2397          348          246
 |/scripts/latex_to_graph.py         2084         1557          366          161
 |sts/test_latex_to_graph.py         1833         1432          162          239
 |semantic_graph_enricher.py         1144          798          214          132
 |semantic_graph_enricher.py          853          676          106           71
 |cripts/graph_to_mermaid.py          869          611          174           84
 |h/algebench/agent_tools.py          610          522           35           53
 |ripts/audit_expressions.py          697          515           90           92
 |nch/scripts/render_math.py          509          469            4           36
 |cripts/validate_content.py          602          453           42          107
 |s/test_graph_to_mermaid.py          612          440           89           83
 |t_autofill_proof_shapes.py          262          224            6           32
 |ripts/extract_structure.py          259          218            5           36
 |ench/scripts/lint_scene.py          236          185           14           37
 |scripts/validate_schema.py          180          154            1           25
 |/scripts/assemble_scene.py          187          144            1           42
 |graph_highlight_overlay.py          183          134           11           38
 |/tests/test_render_math.py          177          124           18           35
 |h/models/semantic_graph.py          161          109           19           33
 |st_dot_notation_restore.py          156          107           19           30
 |h/algebench/agents/base.py          124          105            0           19
 |resolve_scene_path_safe.py           81           61            0           20
 |ents/test_schema_parity.py           75           57            0           18
 |ests/test_path_security.py           70           52            0           18
 |t_semantic_graph_themes.py           69           51            0           18
 |ests/test_scene_schemas.py           66           50            0           16
 |/agents/test_base_agent.py           71           47            0           24
 |gebench/models/__init__.py           32           30            0            2
 |gebench/agents/__init__.py           20           18            0            2
 |lgebench/tests/__init__.py            0            0            0            0
 |h/tests/agents/__init__.py            0            0            0            0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Total                    31        15213        11740         1724         1749
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Category Breakdown

| Category | Code Lines | % of JS+Python |
|---|---|---|
| JavaScript (frontend) | 15572 | 57% |
| Python (backend) | 11740 | 43% |
| **Total** | **27312** | **100%** |
