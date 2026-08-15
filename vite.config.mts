import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// AlgeBench frontend build.
//
// Vite is OPTIONAL. Production is FastAPI serving the committed output in
// static/ — no Node, no Vite, no build at deploy time. `npm run dev` is a
// convenience layer for local work only; nothing in the Python path checks
// for it.
//
//   Normal mode:  ./algebench                    (FastAPI only)
//   Vite dev:     ./algebench + npm run dev      (Vite :5173 in front)
//
// Build output: HTML lands at static/*.html (the exact paths server.py reads
// and re-reads per request); ALL generated JS lands under static/dist/.

const ROOT = dirname(fileURLToPath(import.meta.url));

// Where the running FastAPI instance is. `./algebench` picks its port per
// launch config (see .claude/launch.json), so this is overridable:
//   ALGEBENCH_BACKEND=http://localhost:5733 npm run dev
const BACKEND = process.env.ALGEBENCH_BACKEND ?? 'http://localhost:8000';

/**
 * First-party modules import each other by SERVER-ROOT-ABSOLUTE URL —
 * `from '/expr.js'`, `from '/objects/skybox.js'` — because until now the
 * Python server served them from those exact paths. There are ~57 such
 * specifiers plus one dynamic `import('/objects/index.js')`.
 *
 * Vite resolves a leading-slash specifier against the project root, which is
 * no longer where the sources live. Rather than rewrite 57 import lines
 * (which would make the phase-2 renames non-byte-identical and break the
 * faithful-port rule), map them here.
 *
 * EXCLUDED — these stay server-served and must not be bundled:
 *   /chat.js, /theme-init.js  classic non-module scripts (chat.js is
 *                             converted in phase 4)
 *   /domains/*                injected as <script> at runtime from a URL
 *                             built out of lesson data (src/expr.js), so it
 *                             can never be statically resolved
 *   /gemini-live-tools/*      served from the installed Python package
 */
const SERVER_SERVED = ['/chat.js', '/theme-init.js', '/domains/', '/gemini-live-tools/'];

function resolveRootAbsolute(): Plugin {
  return {
    name: 'algebench:resolve-root-absolute',
    enforce: 'pre',
    resolveId(source) {
      if (!source.startsWith('/')) return null;
      // prove.html / renderproof.html load their entry as
      // `/prove.js?v=__APP_VERSION__` — strip the cache-busting query before
      // resolving. The token is re-applied to the emitted tag by the
      // app-version plugin below.
      const path = source.split('?')[0]!;
      if (!path.endsWith('.js')) return null;
      if (SERVER_SERVED.some((p) => path === p || path.startsWith(p))) {
        // Leave it to the browser: a real request to the Python server.
        return { id: source, external: true };
      }
      return join(ROOT, 'src', path.slice(1));
    },
  };
}

/**
 * The server substitutes __APP_VERSION__ into HTML on every request
 * (backend/server.py). Two of the three pages use it as a cache-busting
 * query on their entry script (`/prove.js?v=__APP_VERSION__`), and Vite's
 * HTML transform rewrites `<script src>` — dropping the query.
 *
 * Build: re-append the token to the emitted entry tags so the server-side
 * substitution keeps working exactly as before.
 * Dev:   Vite owns the HTML and the server never sees it, so substitute the
 *        real version here or the page ships a literal __APP_VERSION__.
 */
function appVersion(): Plugin {
  const version = () => readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  return {
    name: 'algebench:app-version',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html.replaceAll('__APP_VERSION__', version());
        // Build: the source tag carried ?v=__APP_VERSION__; Vite dropped it.
        return html.replace(
          /(<script[^>]+src="\/dist\/[^"]+?)(")/g,
          '$1?v=__APP_VERSION__$2',
        );
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  // Built asset URLs are server-root absolute (/dist/...); in dev Vite owns
  // the origin root and proxies everything else to Python.
  base: '/',
  // No Vite public dir — static/ is hand-authored plus build output, and is
  // served by FastAPI, not copied by Vite.
  publicDir: false,
  plugins: [resolveRootAbsolute(), appVersion()],
  build: {
    outDir: 'static',
    // static/ also holds hand-authored files (style.css, chat.js, domains/,
    // fonts/) — never wipe it.
    emptyOutDir: false,
    sourcemap: true,
    // Unminified, unhashed, stable names: the output is COMMITTED, so diffs
    // must stay reviewable and stack traces readable. The server sends
    // no-cache headers, so hashing would buy nothing today.
    minify: false,
    // Vite's module-preload polyfill is emitted as an INLINE script, which
    // the app's CSP (script-src 'self' https://cdn.jsdelivr.net, no
    // 'unsafe-inline' — backend/server.py) blocks outright.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: join(ROOT, 'index.html'),
        prove: join(ROOT, 'prove.html'),
        renderproof: join(ROOT, 'renderproof.html'),
      },
      output: {
        entryFileNames: 'dist/[name].js',
        chunkFileNames: 'dist/[name].js',
        assetFileNames: 'dist/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': BACKEND,
      '/proofs': BACKEND,
      '/scenes': BACKEND,
      '/domains': BACKEND,
      '/chat.js': BACKEND,
      '/theme-init.js': BACKEND,
      '/gemini-live-tools': BACKEND,
      '/fonts': BACKEND,
      '/style.css': BACKEND,
      '/tokens.css': BACKEND,
      '/favicon.ico': BACKEND,
      // Hand-authored CSS living beside the moved modules (static/coach/,
      // static/graph-panel/, static/proof-animation/). Proxying the whole
      // prefix is safe: the .js in those directories is imported as
      // `/graph-panel/x.js`, which the resolver above rewrites to
      // src/graph-panel/x.js, so the browser only ever asks Vite for
      // `/src/...`. Without these the dev server answers the CSS request
      // with its HTML fallback — 200, but zero style rules.
      '/coach': BACKEND,
      '/graph-panel': BACKEND,
      '/proof-animation': BACKEND,
    },
  },
}));
