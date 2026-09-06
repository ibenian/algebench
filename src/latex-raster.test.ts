// The rasteriser needs a DOM to lay KaTeX out; without one it must still
// give layout code sane metrics, since the renderers size labels before
// they draw them.
import test from 'node:test';
import assert from 'node:assert/strict';

const { measureLatex, fitLatexPx, rasterLatex, _clearLatexRasterCache } = await import('/latex-raster.js');

test('without a DOM, measureLatex estimates from the source length and never returns zero', () => {
    _clearLatexRasterCache();
    const m = measureLatex('draw $i$');
    assert.ok(m.w > 0 && m.h > 0);
    assert.ok(measureLatex('a much longer title').w > m.w);
    assert.equal(rasterLatex('x', 12, '#fff').canvas, null);
});

test('fitLatexPx is bound by height for short strings and by width for long ones, never below 1px', () => {
    const short = fitLatexPx('20', 100, 100);
    const long = fitLatexPx('a very long axis title indeed', 100, 100);
    assert.ok(short > long);
    assert.ok(fitLatexPx('20', 40, 40) < short);
    assert.equal(fitLatexPx('20', 1, 1), 1);
});
