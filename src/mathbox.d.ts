// Hand-written ambient declarations for MathBox 2.3.1.
//
// MathBox is loaded from CDN as a classic <script> (index.html) and has NO
// published type definitions — its API is a chained builder whose props bags
// are per-primitive and largely undocumented. There is no npm package whose
// types we could borrow the way globals.d.ts borrows three/katex/marked/mathjs,
// so this file is written by hand.
//
// It is DELIBERATELY MINIMAL and deliberately loose: it declares only the
// surface src/objects/*.ts actually drives (the six primitives those renderers
// construct, plus `.set`), and it types every props bag as an open bag of
// `unknown` rather than enumerating per-primitive props. That is a conscious
// trade — MathBox validates props at runtime, and a half-accurate props type
// would reject valid scenes while proving nothing. Tighten it primitive by
// primitive as more of the frontend is converted; nothing here should be read
// as "this is all of MathBox".
//
// No `any` is used: `unknown` prop values accept everything the renderers pass
// (numbers, colors, arrays of triples) without handing back an unchecked type.

/**
 * A MathBox primitive's props bag — `{ channels: 3, width: n, data: pts }` and
 * friends. Open and `unknown`-valued on purpose (see the file header).
 */
type MathBoxProps = Record<string, unknown>;

/**
 * A node in the MathBox scene graph. Every builder method returns the node it
 * created, so calls chain: `view.array({…}).line({…})`.
 *
 * Only the primitives src/objects/ constructs are declared. `data`/`view`
 * primitives (array/area/matrix) produce values; `line`/`point`/`surface`
 * draw them.
 */
interface MathBoxNode {
    /**
     * Update one prop on a live node — how the animation updaters push new
     * geometry each frame (`node.set('data', pts)`).
     */
    set(key: string, value: unknown): MathBoxNode;

    /** Read one prop back off a live node (`node.get('opacity')`). */
    get(key: string): unknown;

    /**
     * Select nodes by CSS-ish selector. src/scene-loader.ts uses `select('*')`
     * to grab everything under the root so it can drop the previous scene.
     */
    select(selector: string): MathBoxNode;

    /** Detach this node (and its subtree) from its parent. */
    remove(): void;

    /** Cartesian view — the coordinate frame a scene's elements live in. */
    cartesian(props?: MathBoxProps): MathBoxNode;

    /**
     * Grouping node. The scene loader gives every step — and every id'd element
     * within a step — its own group so the whole subtree can be shown, hidden
     * or removed as a unit.
     */
    group(props?: MathBoxProps): MathBoxNode;

    /** 1-D data source: `{ channels, width, data, live? }`. */
    array(props?: MathBoxProps): MathBoxNode;
    /** Sampled 2-D domain: `{ rangeX, rangeY, width, height, axes, channels }`. */
    area(props?: MathBoxProps): MathBoxNode;
    /** 2-D data source: `{ channels, width, height, data }`. */
    matrix(props?: MathBoxProps): MathBoxNode;

    /** Polyline through the parent data source. */
    line(props?: MathBoxProps): MathBoxNode;
    /** Point sprites at the parent data source. */
    point(props?: MathBoxProps): MathBoxNode;
    /** Surface over the parent 2-D data source. */
    surface(props?: MathBoxProps): MathBoxNode;
}

/**
 * The three.js objects MathBox builds and owns. src/camera.ts pulls the
 * renderer/camera/controls back out of here rather than constructing its own —
 * MathBox has already wired them together by the time mathBox() returns.
 */
interface MathBoxThree {
    scene: import('three').Scene;
    camera: import('three').Camera;
    renderer: import('three').WebGLRenderer;
    /** Present only when the 'controls' plugin is enabled (it is). */
    controls: ThreeControls;
}

/** The root node mathBox() returns: a normal node plus the three.js handles. */
interface MathBoxRoot extends MathBoxNode {
    three: MathBoxThree;
}

/**
 * The MathBox library, loaded from CDN as a global (index.html). Only the
 * factory is declared — everything downstream is MathBoxNode.
 */
declare const MathBox: {
    mathBox(opts: {
        element: HTMLElement;
        plugins?: string[];
        controls?: { klass: unknown };
        camera?: MathBoxProps;
        renderer?: MathBoxProps;
        [opt: string]: unknown;
    }): MathBoxRoot;
};
