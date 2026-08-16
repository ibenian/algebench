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
