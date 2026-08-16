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
    () => import('/chat.js'),
    (err) => {
      assert.equal(err.name, 'ServerServedImportError');
      assert.match(err.message, /SERVER_SERVED/);
      return true;
    },
  );
});

test('root-absolute specifiers resolve, preferring .ts over .js', async () => {
  // /theme.js is src/theme.ts on disk — the hook must find it anyway.
  const theme = await import('/theme.js');
  assert.equal(typeof theme.resolveTheme, 'function');
});
