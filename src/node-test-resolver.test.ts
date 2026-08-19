// Covers the `node --test` resolve hook itself (scripts/node-test-resolver.mjs).
//
// The hook is what lets these tests import server-root-absolute specifiers
// (`/coords.js`) and modules that have been converted to TypeScript. Its one
// deliberate failure mode — refusing paths the Python server owns — is
// asserted here so the "named error" contract cannot rot silently.
import test from 'node:test';
import assert from 'node:assert/strict';

test('server-served paths are refused with a named error', async () => {
  await assert.rejects(
    // A domain library: injected as a <script> at runtime from a URL built
    // out of lesson data, so it can never be statically resolved. It lives in
    // static/domains/, not src/, and is the last category of path the Python
    // server genuinely owns.
    //
    // /theme-init.js was the example here until it became src/theme-init.ts,
    // built to /dist/theme-init.js like every other entry — at which point it
    // stopped being server-served and stopped belonging in this test.
    //
    // Its absence under src/ is part of the assertion, so tsc is right that
    // the module cannot be resolved. The directive below records that on
    // purpose (expect-error, not ignore): if a src/domains/ ever appears, it
    // starts failing the build and whoever added it has to revisit this test.
    //
    // NOTE: keep that token off the START of a comment line unless you mean
    // it. TypeScript reads a comment beginning with the expect-error token as
    // a real directive, prose or not — a wrapped sentence mentioning it here
    // silently swallowed the TS2307 below and made this file compile clean.
    // @ts-expect-error TS2307: /domains/* is served at runtime, never bundled.
    () => import('/domains/astrodynamics/index.js'),
    (err) => {
      // node types a rejection reason as `unknown`; the hook always rejects
      // with a real Error carrying a custom `name`, so narrow at the boundary.
      const e = err as Error;
      assert.equal(e.name, 'ServerServedImportError');
      assert.match(e.message, /SERVER_SERVED/);
      return true;
    },
  );
});

test('root-absolute specifiers resolve, preferring .ts over .js', async () => {
  // /theme.js is src/theme.ts on disk — the hook must find it anyway.
  const theme = await import('/theme.js');
  assert.equal(typeof theme.resolveTheme, 'function');
});
