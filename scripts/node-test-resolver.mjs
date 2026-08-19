// Node module-customization RESOLVE hook for `node --test`.
//
// DEV/TEST-TIME ONLY. Nothing here runs in the browser, in the Vite build, or
// in production — it exists so `node --test` can load the same sources the
// browser loads. It MIRRORS the `algebench:resolve-root-absolute` plugin in
// vite.config.mts; the two must be kept consistent (same `.ts`-over-`.js`
// preference, same SERVER_SERVED exclusions).
//
// Two things it fixes, both created by the JS→TS migration:
//
//   1. `./foo.js` whose file is now `foo.ts`. Importers keep writing the
//      `.js` specifier on purpose — rewriting every specifier on every
//      conversion is exactly the churn the faithful-port rule avoids
//      (rewriting them is issue #406's job).
//   2. `/foo.js` — a SERVER-ROOT-ABSOLUTE specifier, the path the Python
//      server serves the module from. Node cannot resolve those at all; they
//      map to `<repo>/src/foo.ts` (preferred) or `<repo>/src/foo.js`.
//
// Type stripping itself is Node's own `--experimental-strip-types`; this hook
// only does resolution. Both are wired into the `test` script in package.json.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

// Kept identical to SERVER_SERVED in vite.config.mts. These are never bundled
// and never resolvable from disk under src/ as a module the tests can import:
//   /domains/*                injected as <script> at runtime from a URL
//                             built out of lesson data
//   /gemini-live-tools/*      served from the installed Python package
// (/chat.js left this list in phase 4e — it is src/chat.ts and is bundled.
//  /theme-init.js left it too — it is src/theme-init.ts, built to
//  /dist/theme-init.js like every other entry.)
const SERVER_SERVED = ['/domains/', '/gemini-live-tools/'];

/** Thrown when a test imports a path the Python server owns (see
 *  SERVER_SERVED). Named so tests and tooling can distinguish it from an
 *  ordinary resolution failure — `err.name === 'ServerServedImportError'`. */
export class ServerServedImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServerServedImportError';
  }
}

/** `foo.js` → `foo.ts` when the .ts exists on disk; otherwise unchanged. */
function preferTs(absPath) {
  const ts = absPath.replace(/\.js$/, '.ts');
  return existsSync(ts) ? ts : absPath;
}

export async function resolve(specifier, context, nextResolve) {
  // Server-root-absolute: `/expr.js`, `/graph-panel/term-resolve.js`.
  if (specifier.startsWith('/')) {
    // The built pages load their entries with a cache-busting query —
    // `/dist/prove.js?v=__APP_VERSION__` (static/prove.html), likewise
    // renderproof. Strip the query before matching, as the Vite plugin does.
    const path = specifier.split('?')[0];
    if (path.endsWith('.js')) {
      if (SERVER_SERVED.some((p) => path === p || path.startsWith(p))) {
        // Vite marks these external (a real request to the Python server).
        // Node has no equivalent, so fail loudly rather than resolve to
        // something that is not what the browser would load.
        throw new ServerServedImportError(
          `[node-test-resolver] '${specifier}' is server-served (SERVER_SERVED) ` +
            `and is not importable under node --test. Stub it in the test instead.`,
        );
      }
      const resolved = preferTs(join(SRC, path.slice(1)));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  // Relative specifiers whose target has been converted to .ts.
  //
  // The `./` / `../` test is load-bearing, not decoration: several npm packages
  // are NAMED like a relative path — `decimal.js` (a mathjs dependency),
  // `chart.js`, `three.js`. Matching on the `.js` suffix alone resolved those
  // bare specifiers against the importing file's directory, so `import Decimal
  // from 'decimal.js'` inside mathjs looked for a sibling file and threw
  // ERR_MODULE_NOT_FOUND. Bare specifiers must fall through to Node.
  if (/^\.{1,2}\//.test(specifier) && specifier.endsWith('.js')
      && context.parentURL?.startsWith('file:')) {
    const target = new URL(specifier, context.parentURL);
    if (target.protocol === 'file:') {
      const resolved = preferTs(fileURLToPath(target));
      return nextResolve(pathToFileURL(resolved).href, context);
    }
  }

  return nextResolve(specifier, context);
}
