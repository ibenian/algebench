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
    // /theme-init.js is a classic pre-paint script the Python server owns.
    // (/chat.js used to be the example here; phase 4e made it src/chat.ts.)
    //
    // Its absence under src/ is the assertion, so tsc is right that the module
    // cannot be resolved — @ts-expect-error (not @ts-ignore) records that on
    // purpose: if a src/theme-init.ts ever appears, this line starts failing
    // the build and whoever added it has to revisit the test.
    // @ts-expect-error TS2307: /theme-init.js deliberately does not exist here.
    () => import('/theme-init.js'),
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
