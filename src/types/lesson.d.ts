/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source:    schemas/lesson.schema.json
 * Generator: scripts/generate_ts_types.mjs
 * Regenerate: npm run types:generate
 *
 * Edit the schema, then regenerate. CI fails if this file is out of date.
 */

/**
 * Schema for AlgeBench lesson and scene JSON files. Supports both single-scene format (with top-level 'elements') and multi-scene lesson format (with 'scenes' array).
 */
export type AlgeBenchLesson = LessonFormat | SingleSceneFormat;
/**
 * Axis ranges as [[xMin,xMax],[yMin,yMax],[zMin,zMax]]. Default: [[-5,5],[-5,5],[-5,5]].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Range3D = [[number, number], [number, number], [number, number]];
/**
 * Axis scale factors as [sx,sy,sz]. Default: [1,1,1]. Use to stretch/compress axes.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number = [number, number, number];
/**
 * Camera position in data space [x,y,z]. Default: [6,4,6].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number1 = [number, number, number];
/**
 * Camera look-at target in data space [x,y,z]. Default: [0,0,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number2 = [number, number, number];
/**
 * Camera up vector [x,y,z]. Default: [0,1,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number3 = [number, number, number];
/**
 * Camera position [x,y,z] for this view.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number4 = [number, number, number];
/**
 * Camera target [x,y,z] for this view.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number5 = [number, number, number];
/**
 * Camera up vector [x,y,z]. Default: [0,1,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number6 = [number, number, number];
/**
 * Offset [x,y,z] from the followed element's position.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number7 = [number, number, number];
/**
 * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
 */
export type Color = string | [number, number, number];
/**
 * Position in data space as [x,y,z]. Used by point, sphere, cylinder, text.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3 = [number | string, number | string, number | string];
/**
 * Center position [x,y,z]. Used by sphere, ellipsoid, cylinder. Alias for position.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec31 = [number | string, number | string, number | string];
/**
 * Start point [x,y,z] for vectors, lines, cylinders.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec32 = [number | string, number | string, number | string];
/**
 * End point [x,y,z] for vectors, lines, cylinders.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec33 = [number | string, number | string, number | string];
/**
 * Origin point [x,y,z] for vectors. Alias for 'from'. Default: [0,0,0]. On tensor it is the lattice's near corner: [horizontal, vertical, normal] in the chosen 'plane'.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec34 = [number | string, number | string, number | string];
/**
 * 3D point [x,y,z] where each component can be a number or math.js expression string.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3OrExpr = [number | string, number | string, number | string];
/**
 * Per-axis ranges for a plane as [[aMin,aMax],[bMin,bMax]], in plane order.
 *
 * @minItems 2
 * @maxItems 2
 */
export type RangePlane = [[number, number], [number, number]];
/**
 * 3D axis ranges as [[xMin,xMax],[yMin,yMax],[zMin,zMax]].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Range3D1 = [[number, number], [number, number], [number, number]];
/**
 * Offset [dx,dy,dz] for label positioning relative to the element. Default: [0,0.3,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number8 = [number, number, number];
/**
 * Explicit position [x,y,z] for the label instead of auto-computed.
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec35 = [number | string, number | string, number | string];
/**
 * Alias for 'position'. Point/text position [x,y,z].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec36 = [number | string, number | string, number | string];
/**
 * Normal vector [x,y,z] for plane element. Default: [0,1,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number9 = [number, number, number];
/**
 * Point on the plane [x,y,z] for plane element positioning. Default: [0,0,0].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number10 = [number, number, number];
/**
 * 3D axis ranges as [[xMin,xMax],[yMin,yMax],[zMin,zMax]].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Range3D2 = [[number, number], [number, number], [number, number]];
/**
 * 3D axis ranges as [[xMin,xMax],[yMin,yMax],[zMin,zMax]].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Range3D3 = [[number, number], [number, number], [number, number]];
/**
 * Axis scale factors as [sx,sy,sz]. Default: [1,1,1].
 *
 * @minItems 3
 * @maxItems 3
 */
export type Vec3Number11 = [number, number, number];

/**
 * Multi-scene lesson format with a 'scenes' array.
 */
export interface LessonFormat {
  /**
   * Lesson title displayed in the UI header. Example: "Eigenvalues & Eigenvectors".
   */
  title: string;
  /**
   * Domain library names to import from static/domains/<name>/index.js. These register additional math functions available in expressions. Example: ["astrodynamics"].
   */
  import?: string[];
  /**
   * When true, marks the lesson as containing native JavaScript expressions (IIFEs, loops) that require user trust approval before execution. Default: false.
   */
  unsafe?: boolean;
  /**
   * Human-readable explanation of why this lesson uses unsafe JS, shown in the trust dialog. Example: "This lesson uses scene-level reusable functions with IIFE loops."
   */
  unsafeExplanation?: string;
  data?: DataTable;
  /**
   * Root-level proof(s) visible across all scenes. Can be a single proof object or an array of proofs.
   */
  proof?: Proof | Proof[];
  /**
   * Array of scenes in the lesson. Each scene has its own 3D elements, steps, camera, and optional proof.
   *
   * @minItems 1
   */
  scenes: [Scene, ...Scene[]];
}
/**
 * Lesson-level data tables shared across all scenes. Accessible via dataTable('tableName', rowIndex, 'column') in expressions.
 */
export interface DataTable {
  [k: string]:
    | {
        [k: string]: unknown;
      }[]
    | {
        [k: string]: unknown;
      };
}
/**
 * A step-by-step mathematical proof or derivation displayed in the proof panel.
 */
export interface Proof {
  /**
   * Unique proof ID for stable navigation state persistence across scene switches.
   */
  id?: string;
  /**
   * Proof title displayed in the panel header. Example: "Bayes' Theorem Derivation".
   */
  title: string;
  /**
   * Goal statement rendered with renderKaTeX. Use $...$ or $$...$$ delimiters for math — bare LaTeX renders as plain text. Example (display math): "$$P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$$". Example (prose): "Show that $P(A|B) = \\frac{P(B|A)P(A)}{P(B)}$".
   */
  goal?: string;
  /**
   * Proof technique shown as a colored badge. 'derivation' is hidden (no badge shown).
   */
  technique?:
    | 'direct'
    | 'contradiction'
    | 'contrapositive'
    | 'cases'
    | 'induction'
    | 'strongInduction'
    | 'wellOrdering'
    | 'construction'
    | 'nonConstructive'
    | 'counterexample'
    | 'exhaustion'
    | 'equivalence'
    | 'invariant'
    | 'probabilistic'
    | 'existence'
    | 'uniqueness'
    | 'derivation';
  /**
   * Tooltip text explaining why this technique was chosen. Shown on hover over the technique badge.
   */
  techniqueHint?: string;
  /**
   * Subject domain of the proof ("physics", "algebra", "calculus", "quantum", "statistics", …). Free-form, not enumerated. Read by the Function Analysis page as `mathDomain` context: it is the signal that decides whether e.g. negative time is exploration or nonsense, which the CAS's purely mathematical domain can never know. Set on standalone proofs under proofs/domains/.
   */
  domain?: string;
  /**
   * Scene step to navigate to when viewing the proof goal. Integer for step index, or 'sceneIdx:stepIdx' string. Enables bidirectional sync between proof and scene navigation.
   */
  sceneStep?: number | string;
  /**
   * System prompt for the AI when discussing this proof. Provides context about the proof for the chat tutor.
   */
  prompt?: string;
  /**
   * Array of proof steps rendered sequentially.
   *
   * @minItems 1
   */
  steps: [ProofStep, ...ProofStep[]];
}
/**
 * A single step in a mathematical proof.
 */
export interface ProofStep {
  /**
   * Optional stable proof-step ID for references, context, and future navigation/state features.
   */
  id?: string;
  /**
   * Step type displayed as a badge. Common values: 'step', 'definition', 'axiom', 'theorem', 'lemma', 'assumption', 'substitution', 'simplification', 'conclusion'. Default: 'step'.
   */
  type?: string;
  /**
   * Step label/title. Example: "Apply definition of conditional probability".
   */
  label: string;
  /**
   * LaTeX math expression rendered via KaTeX in display mode. Example: "P(A|B) = \\frac{P(A \\cap B)}{P(B)}". Can include highlight spans via \\htmlClass{hl-name}{content}.
   */
  math?: string;
  /**
   * Short justification text rendered below the math. Supports inline KaTeX. Example: "By the multiplication rule".
   */
  justification?: string;
  /**
   * Longer explanation rendered as markdown below the justification. For additional context.
   */
  explanation?: string;
  /**
   * System prompt hint for the AI when this proof step is active. Provides step-specific teaching guidance for the chat tutor.
   */
  prompt?: string;
  /**
   * Tags displayed as small badges on the step. Example: ["algebra", "key-insight"].
   */
  tags?: string[];
  /**
   * Named highlight regions in the math expression. Keys match \\htmlClass{hl-<name>}{...} spans in the math field.
   */
  highlights?: {
    [k: string]: ProofHighlight;
  };
  /**
   * Scene step to sync to when this proof step is active. Integer for step index in current scene, or 'sceneIdx:stepIdx' for cross-scene.
   */
  sceneStep?: number | string;
  /**
   * Optional semantic graph for this step. Contains either a successfully derived graph or an error record explaining why derivation failed.
   */
  semanticGraph?:
    | {
        /**
         * Semantic graph JSON (nodes + edges) used by the Mermaid renderer and the interactive info panel. See schemas/semantic-graph.schema.json. Produced by scripts/latex_to_graph.py.
         */
        graph: {
          [k: string]: unknown;
        };
      }
    | {
        /**
         * Diagnostic record attached by the server when auto-derivation failed. Surfaced in the Math dock view so the user can see why a graph is missing.
         */
        error: {
          /**
           * 'parse_failed' — parser returned no graph (unsupported construct). 'parse_crashed' — parser raised an exception.
           */
          reason: 'parse_failed' | 'parse_crashed';
          /**
           * Human-readable explanation of the failure.
           */
          message: string;
          /**
           * The original LaTeX source that failed to parse.
           */
          math?: string;
        };
      };
}
/**
 * Highlight configuration for a named region in proof math expressions.
 */
export interface ProofHighlight {
  /**
   * Highlight color. Default: 'cyan'.
   */
  color?:
    | 'cyan'
    | 'yellow'
    | 'green'
    | 'orange'
    | 'magenta'
    | 'red'
    | 'blue'
    | 'pink'
    | 'white'
    | 'gray'
    | 'gold'
    | 'silver'
    | 'purple'
    | 'teal'
    | 'lime';
  /**
   * Tooltip and annotation text for the highlight. Shown on hover and click.
   */
  label?: string;
}
/**
 * A single scene within a lesson, containing 3D elements and optional steps.
 */
export interface Scene {
  /**
   * Stable scene id for deeplinking (the `sc=` param). Resolution is id → slug(title) → index, so an explicit id keeps a share/AI-jump link valid even when the title changes. Kebab-case recommended.
   */
  id?: string;
  /**
   * Scene title displayed in the navigation dock. Example: "$P(A)$ — Prior".
   */
  title: string;
  /**
   * Short description of the scene shown below the title. Supports markdown.
   */
  description?: string;
  /**
   * Markdown content for the explanation/documentation panel. Supports KaTeX math via $inline$ and $$display$$ delimiters.
   */
  markdown?: string;
  /**
   * System prompt for the AI chat tutor in this scene. Tells the AI what/how to teach. Example: "You are a patient tutor helping a student understand Bayes' theorem..."
   */
  prompt?: string;
  range?: Range3D;
  scale?: Vec3Number;
  camera?: Camera;
  /**
   * Named camera presets rendered as clickable buttons. Example: Overview, Face On, Iso.
   */
  views?: View[];
  /**
   * Reusable scene-level functions callable from expressions. Registered in the math.js sandbox.
   */
  functions?: SceneFunction[];
  data?: DataTable1;
  starfield?: Starfield;
  /**
   * Base scene elements rendered when the scene loads (before any steps).
   */
  elements?: Element[];
  /**
   * Incremental steps that add/remove elements and sliders. Navigated with Next/Prev.
   */
  steps?: Step[];
  /**
   * Proof(s) associated with this scene. Displayed in the proof panel.
   */
  proof?: Proof | Proof[];
  /**
   * Auto-play duration in milliseconds for the base scene (before step 0). Default: 3000.
   */
  duration?: number;
}
/**
 * Initial camera position and target for this scene.
 */
export interface Camera {
  position?: Vec3Number1;
  target?: Vec3Number2;
  up?: Vec3Number3;
}
/**
 * Named camera preset shown as a clickable button.
 */
export interface View {
  /**
   * Button label. Example: "Overview", "Face On".
   */
  name: string;
  /**
   * Tooltip text describing this view.
   */
  description?: string;
  position?: Vec3Number4;
  /**
   * Dynamic camera position as expression triplet [xExpr,yExpr,zExpr]. Evaluated each frame in data space.
   *
   * @minItems 3
   * @maxItems 3
   */
  positionExpr?: [string, string, string];
  target?: Vec3Number5;
  /**
   * Dynamic camera target as expression triplet [xExpr,yExpr,zExpr]. Evaluated each frame in data space.
   *
   * @minItems 3
   * @maxItems 3
   */
  targetExpr?: [string, string, string];
  up?: Vec3Number6;
  /**
   * Element ID (or list of candidate IDs — the live one is tracked) to follow with the camera. The camera tracks the element's animated position.
   */
  follow?: string | [string, ...string[]];
  offset?: Vec3Number7;
  /**
   * Axis indices for angle-lock camera mode.
   */
  angleLockAxis?: number[];
  /**
   * Element IDs defining the angle-lock direction vector.
   */
  angleLockDirection?: string[];
  /**
   * Element IDs defining the angle-lock reference vector.
   */
  angleLockVector?: string[];
}
/**
 * Reusable function registered in the math.js sandbox. Can be called from any expression in the scene.
 */
export interface SceneFunction {
  /**
   * Function name usable in expressions. Example: "hx" allows calling hx() in expressions.
   */
  name: string;
  /**
   * Function argument names. Example: ["mode"] for a function that takes one argument.
   */
  args?: string[];
  /**
   * Function body as a math.js expression or IIFE JavaScript string. For complex logic, use an IIFE: "(()=>{...})()". Requires 'unsafe: true' at lesson level.
   */
  expr: string;
}
/**
 * Scene-level data tables. Override lesson-level tables with the same name.
 */
export interface DataTable1 {
  [k: string]:
    | {
        [k: string]: unknown;
      }[]
    | {
        [k: string]: unknown;
      };
}
/**
 * Background starfield configuration for space-themed scenes.
 */
export interface Starfield {
  /**
   * Whether starfield is visible. Default: true.
   */
  enabled?: boolean;
  /**
   * Number of star particles. Default: 900.
   */
  count?: number;
  /**
   * Inner radius of the star shell. Default: auto-calculated from scene range.
   */
  radiusMin?: number;
  /**
   * Outer radius of the star shell. Default: auto-calculated from scene range.
   */
  radiusMax?: number;
  /**
   * Star particle size. Default: 2.1.
   */
  size?: number;
  /**
   * Star opacity. Default: 0.9.
   */
  opacity?: number;
  /**
   * Twinkle intensity 0-1. Default: 0.25.
   */
  twinkle?: number;
  /**
   * Star color as hex string. Default: '#d9e6ff'.
   */
  color?: string;
}
/**
 * A 3D visual element. The 'type' field determines which renderer is used and which properties are valid.
 */
export interface Element {
  /**
   * Element type determining the renderer. Must be one of the supported types.
   */
  type:
    | 'skybox'
    | 'axis'
    | 'grid'
    | 'vector'
    | 'point'
    | 'line'
    | 'surface'
    | 'parametric_curve'
    | 'parametric_surface'
    | 'sphere'
    | 'ellipsoid'
    | 'vectors'
    | 'vector_field'
    | 'plane'
    | 'polygon'
    | 'cylinder'
    | 'text'
    | 'animated_vector'
    | 'animated_line'
    | 'animated_point'
    | 'animated_cylinder'
    | 'animated_polygon'
    | 'animated_curve'
    | 'tensor'
    | 'chart';
  /**
   * Unique element ID for referencing in remove directives, legend toggle, and element registry. Auto-generated from label if omitted.
   */
  id?: string;
  /**
   * Display label rendered near the element. Supports KaTeX via $...$. Example: "$\mathbf{v} = (1,0)$".
   */
  label?: string;
  /**
   * Optional author prompt that opts this object into the per-object 'Ask AI' button in the 3D view. When set, hovering the object shows a sparkle button; clicking it sends this prompt to the AI chat, with a camera-relative description of the object (viewport position, depth, occlusion, neighbors) attached as context.
   */
  prompt?: string;
  /**
   * Element color as hex string '#rrggbb' or RGB array [r,g,b] with values 0-1. Default varies by type.
   */
  color?: string | [number, number, number];
  /**
   * TENSOR ONLY. Color ramp applied to a tensor's values. A named map, or {stops:[{t,color}, …]} for a custom palette (same stop format as 'gradient.stops'). Default 'viridis'. Use a sequential map ('viridis', 'magma') for non-negative data; 'blueRed' is diverging and implies a sign, so it is only correct for signed data.
   */
  colorMap?:
    | ('viridis' | 'magma' | 'blueRed')
    | {
        /**
         * @minItems 1
         */
        stops: [
          {
            /**
             * Position along the ramp (0 = low, 1 = high).
             */
            t: number;
            /**
             * Color at this stop.
             */
            color: string | [number, number, number];
            [k: string]: unknown;
          },
          ...{
            /**
             * Position along the ramp (0 = low, 1 = high).
             */
            t: number;
            /**
             * Color at this stop.
             */
            color: string | [number, number, number];
            [k: string]: unknown;
          }[]
        ];
      };
  /**
   * TENSOR ONLY. Input range [lo,hi] that a tensor's 'valueExpr'/'values' are normalized over before 'colorMap' is applied. Values outside are clamped. Default [0,1].
   *
   * @minItems 2
   * @maxItems 2
   */
  colorDomain?: [number, number];
  /**
   * TENSOR ONLY. Logical shape of the data, any rank. The current grid layout draws the LAST dimension horizontally and the one before it vertically, so [6] is a row of 6 cells and [6,6] is a 6x6 matrix; higher-rank shapes are accepted and only their trailing 2D slice is drawn until slice layouts exist. Example: [6,6].
   *
   * @minItems 1
   */
  shape?: [number, ...number[]];
  /**
   * TENSOR and CHART. On a tensor, per-axis metadata; axes[k] describes shape[k], and labels are positioned automatically against the rendered lattice — for a 2D tensor axes[0] labels the rows down the left and axes[1] labels the columns across the top. On a chart, axes[0] is the x axis and axes[1] the y axis: 'title', 'ticks' (how many round tick values to aim for, default 5), 'labelExpr' (formats one tick with 'value' bound) and 'color'. Use this instead of hand-placing `text` elements.
   */
  axes?: {
    /**
     * One label per entry along this axis. Example: ["the","cat","sat","on","the","mat"]. Extra labels are ignored; too few leaves the remainder unlabelled.
     */
    labels?: string[];
    /**
     * TENSOR ONLY. Math.js expression giving one label's text, evaluated per entry along this axis every frame with that entry's index bound as 'row' (rows axis), 'col' (columns axis) and 'idx' (either). Wins over 'labels' when both are given. The result is stringified, so string-valued expressions are the point: concat('slot ', idx), or a domain function returning text. Use it when the labels depend on the same live data as the cells — a lattice whose rows are permuted by a slider needs labels that permute with them, and a static 'labels' array would silently assert the wrong thing.
     */
    labelExpr?: string;
    /**
     * Name of the axis itself, placed beyond its labels. Example: "key".
     */
    title?: string;
    /**
     * CHART ONLY. How many round tick values to aim for along this axis. Default 5. The actual count depends on the domain, since ticks land on multiples of 1, 2 or 5 times a power of ten.
     */
    ticks?: number;
    /**
     * Colour for this axis's labels and title. Default: a muted grey-blue.
     */
    color?: string | [number, number, number];
  }[];
  /**
   * TENSOR ONLY. Math.js expression giving one cell's value, evaluated per cell every frame with 'row', 'col' and 'idx' bound (0-based; row 0 renders at the top, as a matrix reads; 'idx' is the flat row-major index, and on a 1D tensor 'row' is 0). Mapped through 'colorMap' over 'colorDomain'. This is how a tensor acts as a VIEW over data held elsewhere in the scene — e.g. "dataTable('attn', row, concat('w', col))" — rather than embedding the data in the element. Use slider IDs and 't' for a live matrix. Takes precedence over 'values'. For a matrix that never changes, use 'values' instead — it costs nothing per frame.
   */
  valueExpr?: string;
  /**
   * TENSOR ONLY. Literal values, either nested (e.g. [[1,2],[3,4]]) or flat row-major (e.g. [1,2,3,4]). Both are normalized to flat + 'shape' internally, so the two spellings are interchangeable and the same flat list can be viewed as [4] or [2,2]. The entry count must match 'shape' exactly — a mismatch is reported rather than padded. Literal values build once and cost NOTHING per frame; prefer this over 'valueExpr' for a fixed matrix. Ignored when 'valueExpr' is present.
   */
  values?: unknown[];
  /**
   * TENSOR ONLY. Math.js expression giving one cell's WIDTH as a fraction of 'cellSize' (0-1), evaluated per cell every frame with 'row', 'col', 'idx' and 'value' (that cell's own number, from 'valueExpr' or 'values') bound. The cell stays centred on its lattice slot, so shrinking it reads as a bar or a dot at the slot. Default 1 - gap. A non-numeric result keeps the default for that cell. Colour is still driven by the value through 'colorMap'; this adds a second channel, it does not replace the first. Example: "sqrt(value)".
   */
  widthExpr?: string;
  /**
   * TENSOR ONLY. Math.js expression giving one cell's HEIGHT as a fraction of 'cellSize' (0-1), same scope and default as 'widthExpr'. Width and height are independent, so "heightExpr": "value" alone turns a row of cells into a bar chart sitting on its lattice.
   */
  heightExpr?: string;
  /**
   * TENSOR ONLY. How 'axes' labels and titles are drawn. 'plane' (default): drawn on the lattice plane itself, in margin bands beside and above the cells, the same way 'textExpr' cell text is -- they tilt, scale and occlude with the lattice and never pile up with screen labels. 'screen': HTML labels that always face the camera, like every other label; use it for a lattice that is only ever read face-on and needs KaTeX in its labels. Plane mode is plain text (LaTeX is reduced to its plain reading: 'key $j$' becomes 'key j').
   */
  axisLabels?: 'screen' | 'plane';
  /**
   * TENSOR ONLY. Which edge of its slot a cell shrunk by 'widthExpr' / 'heightExpr' keeps. 'center' (default) grows and shrinks about the slot centre; 'bottom', 'top', 'left', 'right' pin that edge, and a pair such as 'bottom-left' pins both. A full-size cell sits in the same place whatever the anchor. "heightExpr": "value" with "anchor": "bottom" turns a row of cells into a bar chart standing on its lattice — the way to show a distribution of values.
   */
  anchor?: string;
  /**
   * TENSOR and CHART. On a tensor, the colour for 'textExpr' text: a hex string, an [r,g,b] array in 0-1, or 'auto' (the default): near-black on light cells, near-white on dark ones, decided per cell from its painted colour. On a chart, the ink for grid and zero lines; axes take their own 'color'.
   */
  textColor?: Color | 'auto';
  /**
   * CHART ONLY. The x range shown, [lo, hi], or 'auto' (the default) to fit the series' x values, widened to round tick values.
   */
  xDomain?: [number, number] | 'auto';
  /**
   * CHART ONLY. The y range shown, [lo, hi], or 'auto' (the default) to fit every series, line and band with a little padding, widened to round tick values. Fix it when a slider should be seen to change the data rather than the axis.
   */
  yDomain?: [number, number] | 'auto';
  /**
   * CHART ONLY. The data. Each series is a line (or points) with either literal 'y' values (static, no per-frame cost) or a 'yExpr' evaluated once per sample with 'i' (0-based sample index), 'n' (sample count) and 'x' (that sample's x) bound. x is 'i' unless 'x' or 'xExpr' is given. Example: {"yExpr": "tfDotSample(i, s3_gen_d)", "n": 64, "color": "#f06292"}.
   */
  series?: {
    id?: string;
    /**
     * Legend text; used as the chart's legend entry when it is the only series and the chart has no 'label'.
     */
    label?: string;
    color?: Color;
    /**
     * Sample count for an expression series. Default 64.
     */
    n?: number;
    /**
     * Math.js expression for a sample's x, with 'i' and 'n' bound. Default: i.
     */
    xExpr?: string;
    /**
     * Math.js expression for a sample's y, with 'i', 'n' and 'x' bound. Wins over 'y'.
     */
    yExpr?: string;
    /**
     * Literal x values, one per sample.
     */
    x?: number[];
    /**
     * Literal y values. Static: built once, no per-frame cost.
     */
    y?: number[];
    /**
     * Draw the samples joined (default) or as dots.
     */
    kind?: 'line' | 'points';
    /**
     * Line width. Default 2.5.
     */
    width?: number;
    opacity?: number;
  }[];
  /**
   * CHART ONLY. Horizontal reference lines across the plot, each at a literal 'y' or a 'yExpr' (no per-sample scope; slider IDs and domain functions as usual). A ±1 s.d. pair is two of these.
   */
  hlines?: {
    y?: number;
    yExpr?: string;
    color?: Color;
    width?: number;
    opacity?: number;
  }[];
  /**
   * CHART ONLY. Filled horizontal bands between a low and a high y, literal ('lo'/'hi') or expressions ('loExpr'/'hiExpr'). Drawn behind the series; a translucent band is the honest way to show a spread. loExpr/hiExpr run in the plain scene scope, not the per-sample i/n/x of a series.
   */
  bands?: {
    lo?: number;
    hi?: number;
    loExpr?: string;
    hiExpr?: string;
    color?: Color;
    /**
     * Default 0.18.
     */
    opacity?: number;
  }[];
  /**
   * CHART ONLY. Draw faint grid lines at the ticks. Default true.
   */
  grid?: boolean;
  /**
   * TENSOR ONLY. Data-space pitch between cell centers. Default 1.
   */
  cellSize?: number;
  /**
   * TENSOR ONLY. Gap between cells as a fraction of 'cellSize', so spacing survives a cellSize change. Default 0.08.
   */
  gap?: number;
  /**
   * Element opacity 0-1. Can be a math.js expression string for animated elements. Default varies by type.
   */
  opacity?: number | string;
  /**
   * Line/stroke width in pixels. Default varies by type (axis: 2, line: 3, parametric_curve: 3).
   */
  width?: number;
  /**
   * On point: point size in pixels (default 12). On chart: width and height of the plot area in data units, [w, h] (default [6, 3]); the paper with tick labels and titles extends about 1.1-1.6 units to the left and 0.7-1.1 below.
   */
  size?: number | [number, number];
  position?: Vec3;
  center?: Vec31;
  from?: Vec32;
  to?: Vec33;
  origin?: Vec34;
  /**
   * Array of points for lines, polygons, animated_line. Each point is [x,y,z] (numbers or expression strings).
   */
  points?: Vec3OrExpr[];
  /**
   * Array of vertex positions for polygon/animated_polygon. Each is [x,y,z] (numbers or expression strings).
   */
  vertices?: Vec3OrExpr[];
  /**
   * Range for parametric types [tMin,tMax] or axis range [-5,5]. Only this flat two-component form accepts math.js expression strings in place of numbers; the nested forms below are numeric-only. For vector_field: [[xMin,xMax],[yMin,yMax],[zMin,zMax]]. For grid: omit to inherit the scene range for the plane's two axes, or give one interval per axis in plane order as [[a,b],[c,d]] ('xz' means x then z) when the two axes span different extents.
   */
  range?: [number | string, number | string] | RangePlane | Range3D1;
  /**
   * Number of sample points for curves/surfaces. Default: 128 (parametric_curve), 200 (animated_curve).
   */
  samples?: number;
  /**
   * Number of grid divisions: one count for both axes, or [nx, ny] in plane order. A pair is needed when the two axes span different extents and the cells must still land on integer positions. Default: 10.
   */
  divisions?: number | [number, number];
  /**
   * Which axis this element represents (for 'axis' type) or cylinder axis direction.
   */
  axis?: 'x' | 'y' | 'z';
  /**
   * Grid plane. Default: 'xy'. Also usable on animated_curve: 'xy' (default) plots expr along y; 'xz' plots it along z (fillRegions unsupported in 'xz'). Any other value (e.g. 'yz') is not modelled for animated_curve and falls back to 'xy'. On tensor it is the plane the cell lattice is laid out in; all three values are supported.
   */
  plane?: 'xy' | 'xz' | 'yz';
  /**
   * Radius for sphere, cylinder, animated_point. Default: 1 (sphere/cylinder), 0.25 (animated_point).
   */
  radius?: number;
  /**
   * Math.js expression string for dynamic radius. Use slider IDs and 't'. Example: "Rp".
   */
  radiusExpr?: string;
  /**
   * Math.js expression for X component. Used by parametric types and surfaces. Example: "cos(t)". Use math.js syntax (sin, cos, pi) NOT JavaScript (Math.sin).
   */
  x?: string;
  /**
   * Math.js expression for Y component. Example: "sin(t)".
   */
  y?: string;
  /**
   * Math.js expression for Z component. Example: "0".
   */
  z?: string;
  /**
   * Expression(s) for animated elements. Array of 3 math.js strings [x,y,z] for animated_vector/point, or single string for animated_curve/surface. Example: ["k*2", "k*1", "0"].
   */
  expr?: [string, string, string] | string;
  /**
   * Math.js expression array [x,y,z] for dynamic start point of animated vectors/cylinders.
   *
   * @minItems 3
   * @maxItems 3
   */
  fromExpr?: [string, string, string];
  /**
   * Math.js boolean expression controlling visibility. Element is visible when expression evaluates to truthy. Example: "orbitImpactT(1) >= 0".
   */
  visibleExpr?: string;
  /**
   * Math.js expression for dynamic label text. Result is displayed as the element's label.
   */
  labelExpr?: string;
  labelOffset?: Vec3Number8;
  labelPosition?: Vec35;
  /**
   * U parameter range [min,max] for parametric surfaces. Default: [0, 2π].
   *
   * @minItems 2
   * @maxItems 2
   */
  uRange?: [number, number];
  /**
   * V parameter range [min,max] for parametric surfaces. Default: [0, 2π].
   *
   * @minItems 2
   * @maxItems 2
   */
  vRange?: [number, number];
  /**
   * Resolution in U direction for parametric surfaces. Default: 32.
   */
  uSamples?: number;
  /**
   * Resolution in V direction for parametric surfaces. Default: 32.
   */
  vSamples?: number;
  /**
   * Number of width segments for sphere/ellipsoid/cylinder geometry. Default: 32.
   */
  widthSegments?: number;
  /**
   * Number of height segments for sphere/ellipsoid geometry. Default: 20.
   */
  heightSegments?: number;
  /**
   * Number of radial segments for cylinder. Default: 32.
   */
  radialSegments?: number;
  /**
   * Whether cylinder caps are open. Default: false.
   */
  openEnded?: boolean;
  /**
   * Skybox style. 'solid' uses a single color, 'gradient' blends topColor to bottomColor.
   */
  style?: 'solid' | 'gradient';
  /**
   * Top color for gradient skybox. Example: "#080818".
   */
  topColor?: string;
  /**
   * Bottom color for gradient skybox. Example: "#030310".
   */
  bottomColor?: string;
  /**
   * Number of stars in the skybox. Default: 0 (no stars).
   */
  starCount?: number;
  /**
   * Star color as hex string. Default: '#e6efff'.
   */
  starColor?: string;
  /**
   * Minimum star size. Default: 0.5.
   */
  starMinSize?: number;
  /**
   * Maximum star size. Default: 2.0.
   */
  starMaxSize?: number;
  /**
   * Step between axis tick marks. Auto-calculated from range span if omitted.
   */
  tickStep?: number;
  shader?: Shader;
  /**
   * Text content for 'text' type elements. Example: "Direction changed!".
   */
  text?: string;
  /**
   * TENSOR ONLY. Math.js expression giving one cell's DEPTH -- how far it stands off the lattice plane along the plane normal, as a fraction of 'cellSize', same scope as 'widthExpr'. Positive rises above the plane, negative sinks below it, clamped to -3..3; 0 (the default, and any non-numeric result) is flat. A cell with depth is drawn as a solid box with shaded walls, so a large value reads as a bump and a negative one as a well; signed data such as pre-softmax scores reads as relief in both directions. Cell text rides on the box's lid. Example: "value * 2" on a softmax matrix is a relief map of the attention weights; "(value - 1/6) * 4" shows each weight above or below uniform.
   */
  depthExpr?: string;
  /**
   * On text: Math.js expression for dynamic text content. Evaluated each frame; the rounded integer result replaces '%d' in textFormat. Example: "lambda * 100". On tensor: the text drawn INSIDE each cell, evaluated per cell with 'row', 'col', 'idx' and 'value' bound (same scope as 'widthExpr'). Drawn on the cell's face as geometry -- the lattice plane, or the lid of a cell raised or sunk by 'depthExpr' -- so it tilts, moves and occludes with the cell rather than floating as a screen label, and each string is sized to fit its own cell's current width and height. Axis labels stay on the plane. Plain text only, no KaTeX; use toFixed(value, 2) or concat(...). An empty string draws nothing. The canvas is redrawn only when some text, size or colour changed.
   */
  textExpr?: string;
  /**
   * Format string for textExpr output. Use '%d' as placeholder for the evaluated integer. Supports KaTeX. Example: "$%d\\;\\text{nm}$". Default: "%d".
   */
  textFormat?: string;
  /**
   * Horizontal alignment of text labels. 'right' anchors the right edge at the position (text draws leftward). Default: 'center'.
   */
  align?: 'left' | 'center' | 'right';
  /**
   * Additional CSS class applied to text labels for custom styling. Example: "label-highlight".
   */
  cssClass?: string;
  trail?: Trail;
  panels?: VectorPanels;
  regular?: RegularPolygon;
  /**
   * Gradient fill for polygons. Interpolates vertex colors along an axis. Supports simple from/to or multi-stop gradients.
   */
  gradient?: {
    /**
     * Axis along which to interpolate colors. Default: 'y'.
     */
    direction?: 'x' | 'y' | 'z';
    /**
     * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
     */
    from?: string | [number, number, number];
    /**
     * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
     */
    to?: string | [number, number, number];
    /**
     * Array of color stops for multi-color gradients. Each stop has a position t (0-1) and a color.
     */
    stops?: {
      /**
       * Position along the gradient (0=start, 1=end).
       */
      t: number;
      /**
       * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
       */
      color: string | [number, number, number];
      [k: string]: unknown;
    }[];
    /**
     * Number of tessellation segments for smooth gradient rendering. Default: 64.
     */
    segments?: number;
  };
  /**
   * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
   */
  outlineColor?: string | [number, number, number];
  /**
   * Outline opacity for polygons. Can be an expression string. Default: min(1, opacity * 2).
   */
  outlineOpacity?: number | string;
  /**
   * Outline width for polygons. Can be an expression string. Default: 0 (no outline) or 1.5 for regular polygons.
   */
  outlineWidth?: number | string;
  /**
   * Filled regions for animated_curve. Define areas above/below/between curves.
   */
  fillRegions?: FillRegion[];
  /**
   * Whether to show the curve line for animated_curve. Default: true.
   */
  showCurve?: boolean;
  /**
   * Dynamic range [minExpr, maxExpr] for animated_curve parameter.
   *
   * @minItems 2
   * @maxItems 2
   */
  rangeExpr?: [string, string];
  /**
   * Alias for 'expr' (single string form). Math.js expression for surface z = f(x,y). Example: "x + y".
   */
  expression?: string;
  at?: Vec36;
  /**
   * Alias for 'points'. Array of [x,y,z] points for line elements.
   */
  data?: Vec3OrExpr[];
  /**
   * Alias for 'expr' on animated_point. Math.js expression array [x,y,z] for dynamic position.
   *
   * @minItems 3
   * @maxItems 3
   */
  positionExpr?: [string, string, string];
  /**
   * Alias for 'expr' on animated_vector/animated_cylinder. Math.js expression array [x,y,z] for dynamic endpoint.
   *
   * @minItems 3
   * @maxItems 3
   */
  toExpr?: [string, string, string];
  /**
   * Math.js expression array [x,y,z] for dynamic center position of sphere/ellipsoid.
   *
   * @minItems 3
   * @maxItems 3
   */
  centerExpr?: [string, string, string];
  /**
   * Math.js expression for vector field X component. Example: "y". Use math.js syntax.
   */
  fx?: string;
  /**
   * Math.js expression for vector field Y component. Example: "-x".
   */
  fy?: string;
  /**
   * Math.js expression for vector field Z component. Example: "0".
   */
  fz?: string;
  /**
   * Whether animated_vector keyframe animation loops. Default: true.
   */
  loop?: boolean;
  /**
   * Whether animated_vector renders an arrowhead. Default: true.
   */
  arrow?: boolean;
  /**
   * Scale factor for animated_vector arrowhead size. Default: 1.
   */
  arrowScale?: number;
  /**
   * Scale factor for animated_vector shaft thickness. Default: 1.
   */
  shaftScale?: number;
  /**
   * Scale factor for animated_vector length. Multiplies the displacement from 'from' to 'to' without changing the underlying expressions. Default: 1.
   */
  scale?: number;
  /**
   * Keyframe array for animated_vector. Each keyframe defines a target position over time.
   */
  keyframes?: unknown[];
  /**
   * Polygon extrusion thickness. Default: 0.02.
   */
  thickness?: number;
  /**
   * Vector field sample density per axis. Default: 3.
   */
  density?: number;
  normal?: Vec3Number9;
  point?: Vec3Number10;
  /**
   * Height for cylinder element when using center+axis specification. Default: 1.
   */
  height?: number;
  /**
   * Alias for 'text'. Text content for text elements.
   */
  value?: string;
  /**
   * Manual depth offset for polygon/animated_curve render ordering. Auto-assigned if omitted.
   */
  depthZ?: number;
  /**
   * Manual render order for polygon depth sorting. Auto-assigned if omitted.
   */
  renderOrder?: number;
  [k: string]: unknown;
}
/**
 * Material shader configuration for 3D objects (sphere, cylinder, polygon, parametric_surface).
 */
export interface Shader {
  /**
   * Three.js material type. 'basic': no lighting; 'phong': Phong shading (default); 'standard': PBR material.
   */
  type?: 'basic' | 'phong' | 'standard';
  /**
   * Phong shininess exponent. Higher = sharper specular. Default: 40.
   */
  shininess?: number;
  /**
   * Emissive (self-glow) color as hex string. Example: "#112344".
   */
  emissive?: string;
  /**
   * Specular highlight color as hex string. Example: "#99b5eb".
   */
  specular?: string;
  /**
   * Whether the material writes to the depth buffer. Set false for transparent overlapping objects.
   */
  depthWrite?: boolean;
  /**
   * Whether the material tests against the depth buffer.
   */
  depthTest?: boolean;
  /**
   * When true, this mesh keeps its own material opacity instead of being scaled by the global planeOpacity display control.
   */
  ignorePlaneOpacity?: boolean;
  /**
   * Use flat shading instead of smooth. Gives a faceted look.
   */
  flatShading?: boolean;
  /**
   * PBR roughness 0-1 (standard material only). Default: 0.85.
   */
  roughness?: number;
  /**
   * PBR metalness 0-1 (standard material only). Default: 0.08.
   */
  metalness?: number;
}
/**
 * Trail effect configuration for animated_vector. Shows a fading trail behind the moving tip.
 */
export interface Trail {
  /**
   * Trail color as hex string. Defaults to the element color.
   */
  color?: string;
  /**
   * Trail opacity. Default: 1.
   */
  opacity?: number;
  /**
   * Trail line width. Default: 1.
   */
  width?: number;
  /**
   * Maximum number of trail points stored. Default: 200.
   */
  length?: number;
}
/**
 * Optional attached rectangular panels for animated_vector, useful for stylized spacecraft solar arrays.
 */
export interface VectorPanels {
  /**
   * Panel color as hex string.
   */
  color?: string;
  /**
   * Panel opacity.
   */
  opacity?: number;
  /**
   * Panel length measured outward from the vector base.
   */
  length?: number;
  /**
   * Panel width measured along the vector direction.
   */
  width?: number;
  /**
   * Panel thickness.
   */
  thickness?: number;
  /**
   * Gap between the vector body and the first panel segment.
   */
  gap?: number;
  /**
   * Number of rectangular panel segments per side. Use 2 for four total panels.
   */
  segments?: number;
  /**
   * Optional render order override for the panel meshes.
   */
  renderOrder?: number;
}
/**
 * Regular polygon configuration. When present, generates vertices automatically instead of using explicit vertices array.
 */
export interface RegularPolygon {
  /**
   * Number of sides. Can be an expression string for animated polygons. Example: "N" (slider-driven).
   */
  n?: number | string;
  /**
   * Circumradius. Can be an expression string. Default: 1.
   */
  radius?: number | string;
  /**
   * Center position [x,y,z]. Components can be expression strings. Default: [0,0,0].
   *
   * @minItems 3
   * @maxItems 3
   */
  center?: [number | string, number | string, number | string];
  /**
   * Rotation angle in radians. Can be an expression string. Default: 0.
   */
  rotation?: number | string;
  /**
   * Plane in which the polygon is generated. Default: "xy".
   */
  plane?: 'xy' | 'xz' | 'yz';
}
/**
 * Filled region between curves for animated_curve elements.
 */
export interface FillRegion {
  /**
   * Optional ID for the fill region, used for referencing in remove directives.
   */
  id?: string;
  /**
   * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
   */
  color?: string | [number, number, number];
  /**
   * Fill opacity. Can be expression string. Default: 0.35.
   */
  opacity?: number | string;
  /**
   * Math.js expression for upper boundary curve.
   */
  above?: string;
  /**
   * Math.js expression for lower boundary curve.
   */
  below?: string;
  /**
   * Math.js expression for right boundary.
   */
  rightOf?: string;
  /**
   * Math.js expression for left boundary.
   */
  leftOf?: string;
  /**
   * Outline width for the fill region.
   */
  outlineWidth?: number | string;
  /**
   * Color as hex string '#rrggbb' (or '#rrggbbaa' with alpha) or RGB array [r,g,b] with components 0-1.
   */
  outlineColor?: string | [number, number, number];
  /**
   * Outline opacity.
   */
  outlineOpacity?: number | string;
}
/**
 * An incremental step that adds/removes elements and configures sliders.
 */
export interface Step {
  /**
   * Stable step id for deeplinking (the `st=` param). Resolution is id → slug(title) → index, so an explicit id keeps a share/AI-jump link valid even when the title changes. Kebab-case recommended.
   */
  id?: string;
  /**
   * Step title shown in the dock and caption bar. Supports KaTeX. Example: "$P(A)$ — Prior".
   */
  title: string;
  /**
   * Step description shown in the caption overlay. Supports markdown and KaTeX.
   */
  description?: string;
  /**
   * Per-step system prompt override for the AI chat tutor.
   */
  prompt?: string;
  /**
   * Elements to add in this step. Each element must have a 'type' field.
   */
  add?: Element[];
  /**
   * Directives to hide elements or sliders from previous steps.
   */
  remove?: RemoveDirective[];
  /**
   * Slider definitions added in this step. Sliders create interactive parameters for expressions.
   */
  sliders?: Slider[];
  camera?: Camera1;
  /**
   * Info overlay panels displayed during this step.
   */
  info?: InfoOverlay[];
  range?: Range3D2;
  virtualTime?: VirtualTime;
  /**
   * Proof(s) introduced at this step.
   */
  proof?: Proof | Proof[];
  /**
   * Auto-play duration in milliseconds for this step. Default: 3000.
   */
  duration?: number;
  /**
   * Short caption text displayed in the step caption bar. Overrides auto-generated caption from title.
   */
  caption?: string;
}
/**
 * Directive to hide elements or sliders. Use {id: '*'} to hide all elements, {type: 'slider'} to remove all sliders, or {id: 'some_id'} to hide a specific element.
 */
export interface RemoveDirective {
  /**
   * Element ID to hide, or '*' to hide all elements.
   */
  id?: string;
  /**
   * Remove by type. Use 'slider' to remove all sliders, 'info' to remove info overlays, or an element type name.
   */
  type?: string;
}
/**
 * Interactive slider that creates a named parameter usable in math.js expressions.
 */
export interface Slider {
  /**
   * Slider ID used as variable name in expressions. Example: 'pA' creates a variable pA. Must be a valid math.js identifier.
   */
  id: string;
  /**
   * Display label for the slider. Supports KaTeX. Example: "$P(A)$". Defaults to the id.
   */
  label?: string;
  /**
   * Minimum slider value.
   */
  min: number;
  /**
   * Maximum slider value.
   */
  max: number;
  /**
   * Step increment for the slider. Default: 0.1.
   */
  step?: number;
  /**
   * Initial slider value. Default: midpoint of min and max.
   */
  default?: number;
  /**
   * Whether the slider auto-animates (shows play/pause button). Default: false.
   */
  animate?: boolean;
  /**
   * Animation mode. 'loop': repeats 0→1→0→1; 'once': plays 0→1 then stops; 'bounce': triangle wave 0→1→0. Default: 'loop'.
   */
  animateMode?: 'loop' | 'once' | 'bounce';
  /**
   * Whether animated slider starts playing automatically. Default: true.
   */
  autoplay?: boolean;
  /**
   * Animation cycle duration in milliseconds. Default: 3000.
   */
  duration?: number;
  /**
   * If true, previous slider state is snapshotted for undo on backward navigation.
   */
  reset?: boolean;
  /**
   * Expression to format the displayed slider value. Evaluated via the standard expression engine (math.js / JS fallback). Example: "dataTable('capsules', s5_capsule, 'name')" displays the capsule name instead of a numeric index.
   */
  valueExpr?: string;
}
/**
 * Camera override for this step. Animates to this position when navigating to the step.
 */
export interface Camera1 {
  position?: Vec3Number1;
  target?: Vec3Number2;
  up?: Vec3Number3;
}
/**
 * Info panel overlay displayed during a step.
 */
export interface InfoOverlay {
  /**
   * Unique overlay ID for removal. Example: "main_info".
   */
  id: string;
  /**
   * Markdown content with KaTeX support. Slider values can be interpolated with {{sliderId}}. Example: "### $P(A)$\n$P(A) = {{pA}}$".
   */
  content: string;
  /**
   * Screen position for the overlay. Default: 'top-left'.
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
  /**
   * Alias for 'position'. Prefer 'position' in new scenes.
   */
  pos?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
  /**
   * If true, overlay persists across steps until explicitly removed. Default: false.
   */
  keep?: boolean;
  /**
   * Optional short title shown in the overlay/drawer header (KaTeX supported). Falls back to the first line of `content`, ellipsized. Example: "Bayes' rule".
   */
  title?: string;
}
/**
 * Virtual time expression that replaces the default wall-clock 't' variable.
 */
export interface VirtualTime {
  /**
   * Math.js expression producing the virtual time value. Use slider IDs. Example: "tau*T" where tau is a slider.
   */
  expr: string;
}
/**
 * Single-scene format with top-level 'elements' (no 'scenes' array).
 */
export interface SingleSceneFormat {
  /**
   * Scene title.
   */
  title: string;
  /**
   * Short description of the scene shown below the title.
   */
  description?: string;
  /**
   * Markdown content for the explanation panel (supports KaTeX via $...$ and $$...$$).
   */
  markdown?: string;
  /**
   * System prompt for the AI chat tutor in this scene.
   */
  prompt?: string;
  /**
   * Domain library names to import.
   */
  import?: string[];
  /**
   * Marks scene as containing native JS.
   */
  unsafe?: boolean;
  /**
   * Explanation for unsafe JS trust dialog.
   */
  unsafeExplanation?: string;
  range?: Range3D3;
  scale?: Vec3Number11;
  camera?: Camera2;
  /**
   * Named camera presets shown as buttons.
   */
  views?: View[];
  /**
   * Reusable math functions available in expressions.
   */
  functions?: SceneFunction[];
  data?: DataTable2;
  starfield?: Starfield1;
  /**
   * Base scene elements rendered on load.
   */
  elements: Element[];
  /**
   * Incremental steps that add/remove elements.
   */
  steps?: Step[];
  /**
   * Proof(s) associated with this scene.
   */
  proof?: Proof | Proof[];
}
/**
 * Initial camera position and target.
 */
export interface Camera2 {
  position?: Vec3Number1;
  target?: Vec3Number2;
  up?: Vec3Number3;
}
/**
 * Data tables accessible via dataTable() in expressions.
 */
export interface DataTable2 {
  [k: string]:
    | {
        [k: string]: unknown;
      }[]
    | {
        [k: string]: unknown;
      };
}
/**
 * Background starfield configuration.
 */
export interface Starfield1 {
  /**
   * Whether starfield is visible. Default: true.
   */
  enabled?: boolean;
  /**
   * Number of star particles. Default: 900.
   */
  count?: number;
  /**
   * Inner radius of the star shell. Default: auto-calculated from scene range.
   */
  radiusMin?: number;
  /**
   * Outer radius of the star shell. Default: auto-calculated from scene range.
   */
  radiusMax?: number;
  /**
   * Star particle size. Default: 2.1.
   */
  size?: number;
  /**
   * Star opacity. Default: 0.9.
   */
  opacity?: number;
  /**
   * Twinkle intensity 0-1. Default: 0.25.
   */
  twinkle?: number;
  /**
   * Star color as hex string. Default: '#d9e6ff'.
   */
  color?: string;
}
