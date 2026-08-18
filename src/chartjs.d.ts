// Hand-written ambient declarations for Chart.js 4.
//
// Chart.js is loaded from CDN at runtime by src/graph-panel/sg-chart.ts
// (`loadChartJs` injects a <script> for chart.umd.min.js), so at call time it is
// a plain global named `Chart`. It is NOT bundled, and — unlike three/katex/
// marked/mathjs in globals.d.ts — there is no pinned devDependency to borrow
// types from, so the surface is written by hand here, following the same
// precedent as src/mathbox.d.ts.
//
// It is DELIBERATELY MINIMAL: it declares only the constructor, config keys,
// instance members and plugin hooks that src/graph-panel/sg-chart.ts and
// src/graph-panel/fa-page.ts actually
// touches. Chart.js's real option bags are far larger and validated at runtime;
// enumerating them here would document Chart.js rather than this app, and a
// half-accurate config type would reject valid options while proving nothing.
// Widen it option by option as more chart code is converted; nothing here
// should be read as "this is all of Chart.js".
//
// TWO consumers share this file: sg-chart (config-shaped: options, datasets,
// tooltip callbacks) and fa-page (instance-shaped: live scales, external
// tooltip, dataset visibility). Members only one of them uses are optional,
// and say which one in their doc comment — that is why `title` and
// `callbacks` are optional despite sg-chart always supplying them.
//
// The three option bags that sg-chart MUTATES after construction
// (`options.scales.x/y.title`, `options.plugins.tooltip.callbacks`) are
// declared REQUIRED rather than optional, because the module writes through
// those paths unguarded — exactly as the JavaScript did.

/** One plotted point's parsed value, as handed to a tooltip callback. */
interface ChartTooltipItem {
    parsed: { x: number; y: number | null };
}

/** A scale's (or dataset's) axis title block. */
interface ChartTitleOptions {
    display?: boolean;
    text?: string;
    color?: string;
}

/** One axis. `title` is required — sg-chart writes `scales.x.title.text`. */
interface ChartScaleOptions {
    [option: string]: unknown;
    type?: string;
    /** Optional: sg-chart labels both axes, fa-page labels neither (its axis
     *  names live in the surrounding KaTeX chrome instead). */
    title?: ChartTitleOptions;
    /** Sticky bounds fa-page writes back onto `chart.options.scales.y`. */
    min?: number;
    max?: number;
    ticks?: {
        color?: string;
        maxTicksLimit?: number;
        /** `this` is the live scale when Chart.js invokes a tick callback. */
        callback?: (this: ChartScale, value: number) => unknown;
    };
    /** `color` is scriptable: Chart.js accepts a per-tick function as well as
     *  a flat string, and fa-page uses the function form to highlight zero. */
    grid?: {
        color?: string | ((c: ChartScriptableTick) => string);
        lineWidth?: number | ((c: ChartScriptableTick) => number);
    };
}

/** The context Chart.js passes a scriptable grid option, per tick. */
interface ChartScriptableTick {
    tick?: { value: number };
}

/**
 * A LIVE axis off a built chart (`chart.scales.x`) — not the config object
 * above. Pixel lookups are what fa-page's annotation overlays are drawn from.
 */
interface ChartScale {
    min: number;
    max: number;
    ticks: { value: number; label?: string }[];
    getPixelForTick(index: number): number;
    getPixelForValue(value: number): number;
}

interface ChartTooltipCallbacks {
    label?: (ctx: ChartTooltipItem) => string;
    title?: (items: ChartTooltipItem[]) => string;
}

/** `callbacks` is required — sg-chart replaces `callbacks.title` on x-var change. */
interface ChartTooltipOptions {
    /** fa-page turns the built-in tooltip off and draws its own readout. */
    enabled?: boolean;
    /** Custom tooltip renderer — Chart.js calls this instead of drawing. */
    external?: (ctx: ChartTooltipContext) => void;
    backgroundColor?: string;
    titleColor?: string;
    bodyColor?: string;
    borderColor?: string;
    borderWidth?: number;
    /** Optional: sg-chart supplies callbacks for the built-in tooltip, while
     *  fa-page disables it entirely and renders its own via `external`. */
    callbacks?: ChartTooltipCallbacks;
}

interface ChartPluginOptions {
    legend?: { display?: boolean };
    tooltip: ChartTooltipOptions;
}

interface ChartOptions {
    responsive?: boolean;
    maintainAspectRatio?: boolean;
    /** `false` disables animation outright — Chart.js accepts either. */
    animation?: false | { duration?: number };
    plugins: ChartPluginOptions;
    scales: { x: ChartScaleOptions; y: ChartScaleOptions };
    interaction?: { mode?: string; intersect?: boolean };
    /** Canvas padding — fa-page reserves room for its annotation overlays. */
    layout?: { padding?: number | { top?: number; right?: number; bottom?: number; left?: number } };
}

/** One dataset. `null` entries break the line at discontinuities. */
interface ChartDataset {
    /** Open on purpose: Chart.js accepts far more per-dataset options than are
     *  named here, and callers attach their own display metadata (fa-page hangs
     *  a `$faLabel` KaTeX source off each series). */
    [option: string]: unknown;
    label?: string;
    borderDash?: number[];
    data: (number | null)[];
    borderColor?: string;
    backgroundColor?: string;
    borderWidth?: number;
    pointRadius?: number;
    pointHitRadius?: number;
    fill?: boolean;
    tension?: number;
    spanGaps?: boolean;
}

interface ChartData {
    labels: number[];
    datasets: ChartDataset[];
}

/** Chart.js's own event wrapper, as passed to plugin hooks. */
interface ChartEvent {
    type: string;
    x?: number | null;
    y?: number | null;
    native?: Event | null;
}

/** An element addressed for programmatic activation (tooltip/crosshair sync). */
interface ChartActiveElement {
    datasetIndex: number;
    index: number;
}

/** One drawn point of a dataset's meta, in canvas pixels. */
interface ChartMetaPoint {
    x: number;
    y: number;
}

interface ChartDatasetMeta {
    data: ChartMetaPoint[];
}

/** The plot rectangle, in canvas pixels. */
interface ChartArea {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

interface ChartTooltipModel {
    setActiveElements(elements: ChartActiveElement[], point: { x: number; y: number }): void;
    /** Read by fa-page's external handler to place/hide its own readout. */
    opacity?: number;
    caretX?: number;
    caretY?: number;
    dataPoints?: { parsed: { x: number; y: number } }[];
}

/** The argument Chart.js hands an `external` tooltip handler. */
interface ChartTooltipContext {
    chart: ChartInstance;
    tooltip?: ChartTooltipModel;
}

/**
 * A Chart.js plugin object. Only the two lifecycle hooks sg-chart's crosshair
 * plugin implements are declared.
 */
interface ChartPlugin {
    id: string;
    afterEvent?(chart: ChartInstance, args: { event: ChartEvent }): void;
    afterDraw?(chart: ChartInstance): void;
}

interface ChartConfiguration {
    type: string;
    plugins?: ChartPlugin[];
    data: ChartData;
    options?: ChartOptions;
}

interface ChartInstance {
    data: ChartData;
    options: ChartOptions;
    ctx: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    /** Live axes (see ChartScale). Absent until the first draw completes. */
    scales: { x?: ChartScale; y?: ChartScale };
    chartArea: ChartArea;
    tooltip: ChartTooltipModel;
    /**
     * NOT a Chart.js field: sg-chart's crosshair plugin stamps the synced point
     * index straight onto the chart instance, and its `afterDraw` hook reads it
     * back. Declared here because that is where it lives at runtime.
     */
    _sgcSyncIndex?: number | null;
    resize(): void;
    update(mode?: string): void;
    destroy(): void;
    setActiveElements(elements: ChartActiveElement[]): void;
    /** Per-series visibility — fa-page's legend toggles drive these. */
    isDatasetVisible(index: number): boolean;
    hide(index: number): void;
    show(index: number): void;
    getDatasetMeta(datasetIndex: number): ChartDatasetMeta | undefined;
    getElementsAtEventForMode(
        e: ChartEvent,
        mode: string,
        options: { intersect?: boolean },
        useFinalPosition: boolean,
    ): { index: number }[];
}

/** Chart.js 4, loaded from CDN as a global (see `loadChartJs` in sg-chart.ts). */
declare const Chart: {
    new (canvas: HTMLCanvasElement, config: ChartConfiguration): ChartInstance;
};
