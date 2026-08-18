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
// instance members and plugin hooks that src/graph-panel/sg-chart.ts actually
// touches. Chart.js's real option bags are far larger and validated at runtime;
// enumerating them here would document Chart.js rather than this app, and a
// half-accurate config type would reject valid options while proving nothing.
// Widen it option by option as more chart code is converted; nothing here
// should be read as "this is all of Chart.js".
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
    type?: string;
    title: ChartTitleOptions;
    ticks?: {
        color?: string;
        maxTicksLimit?: number;
        callback?: (value: number) => unknown;
    };
    grid?: { color?: string };
}

interface ChartTooltipCallbacks {
    label?: (ctx: ChartTooltipItem) => string;
    title?: (items: ChartTooltipItem[]) => string;
}

/** `callbacks` is required — sg-chart replaces `callbacks.title` on x-var change. */
interface ChartTooltipOptions {
    backgroundColor?: string;
    titleColor?: string;
    bodyColor?: string;
    borderColor?: string;
    borderWidth?: number;
    callbacks: ChartTooltipCallbacks;
}

interface ChartPluginOptions {
    legend?: { display?: boolean };
    tooltip: ChartTooltipOptions;
}

interface ChartOptions {
    responsive?: boolean;
    maintainAspectRatio?: boolean;
    animation?: { duration?: number };
    plugins: ChartPluginOptions;
    scales: { x: ChartScaleOptions; y: ChartScaleOptions };
    interaction?: { mode?: string; intersect?: boolean };
}

/** One dataset. `null` entries break the line at discontinuities. */
interface ChartDataset {
    label?: string;
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
