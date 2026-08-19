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
    // src/theme-init.ts NOW EXISTS — it was converted, and this directive's
    // tripwire duly fired. What it proves got stronger rather than weaker:
    // the refusal is driven by the SERVER_SERVED list, not by the file being
    // missing from disk, which is what the hook actually promises.
    //
    // The suppressed error moved with it: TS2307 "cannot find module" became
    // TS2306 "not a module", because theme-init is an import-free IIFE with no
    // exports. Type error and runtime refusal now say the same thing — this is
    // not an importable module — so @ts-expect-error (not @ts-ignore) still
    // earns its place: it fails the build again if theme-init ever grows an
    // export, which would mean someone had made it importable after all.
    // @ts-expect-error TS2306: theme-init is a classic script, not a module.
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
