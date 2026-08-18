// Covers the one side-effect-free-ish export of src/ui.ts: updateSceneUrl(),
// which rewrites the ?builtin=/?scene= source params on the current URL and
// pushes the result through history.replaceState().
//
// ui pulls in the whole scene-loading stack, which expects `math` (the math.js
// CDN bundle, instantiated by expr.ts) and `window` at module-eval time. Both
// are stubbed before the import; nothing below touches the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';

// The stubs below stand in for the browser globals ui.ts's import chain reads
// at module-eval time. Only `href` of Location and only `replaceState` of
// History are ever touched, so full DOM interfaces are unnecessary — install
// them through one deliberately loose view of `globalThis` rather than casting
// at each assignment.
const g = globalThis as unknown as {
  math: typeof mathjs;
  window: typeof globalThis;
  location: { href: string };
  history: { replaceState(state: unknown, title: string, url: string): void };
};

g.math = mathjs;
g.window ??= globalThis;

let replacedUrl: string | null = null;
g.location = { href: 'https://example.test/app' };
g.history = {
  replaceState(_state, _title, url) { replacedUrl = url; },
};

const { updateSceneUrl } = await import('/ui.js');

/** Run updateSceneUrl against a starting href and return the rewritten one. */
function rewrite(href: string, opts?: { builtin?: string; path?: string }): URL {
  g.location.href = href;
  replacedUrl = null;
  if (opts === undefined) updateSceneUrl();
  else updateSceneUrl(opts);
  // updateSceneUrl always ends in a replaceState, so the stub has recorded one.
  return new URL(replacedUrl!);
}

test('builtin replaces any ?scene= with ?builtin=', () => {
  const url = rewrite('https://example.test/app?scene=/tmp/a.json', { builtin: 'eigenvalues' });
  assert.equal(url.searchParams.get('builtin'), 'eigenvalues');
  assert.equal(url.searchParams.get('scene'), null);
});

test('path replaces any ?builtin= with ?scene=', () => {
  const url = rewrite('https://example.test/app?builtin=eigenvalues', { path: '/tmp/a.json' });
  assert.equal(url.searchParams.get('scene'), '/tmp/a.json');
  assert.equal(url.searchParams.get('builtin'), null);
});

test('neither option clears both source params', () => {
  const url = rewrite('https://example.test/app?builtin=x&scene=y&sc=2');
  assert.equal(url.searchParams.get('builtin'), null);
  assert.equal(url.searchParams.get('scene'), null);
  // Every other deeplink param is left alone.
  assert.equal(url.searchParams.get('sc'), '2');
});

test('builtin wins when both options are supplied', () => {
  const url = rewrite('https://example.test/app', { builtin: 'b', path: '/p.json' });
  assert.equal(url.searchParams.get('builtin'), 'b');
  assert.equal(url.searchParams.get('scene'), null);
});

test('an empty path falls through to the clearing branch', () => {
  // '' is falsy, so it is NOT treated as a scene path — the else branch runs.
  const url = rewrite('https://example.test/app?scene=old.json', { path: '' });
  assert.equal(url.searchParams.get('scene'), null);
});

test('other deeplink params and the pathname survive a rewrite', () => {
  const url = rewrite('https://example.test/app/page?sc=1&st=4&panel=chat', { builtin: 'z' });
  assert.equal(url.pathname, '/app/page');
  assert.equal(url.searchParams.get('sc'), '1');
  assert.equal(url.searchParams.get('st'), '4');
  assert.equal(url.searchParams.get('panel'), 'chat');
  assert.equal(url.searchParams.get('builtin'), 'z');
});
