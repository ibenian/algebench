// DEV/TEST-TIME ONLY. Registers the `node --test` resolve hook (see
// scripts/node-test-resolver.mjs, which mirrors the resolver plugin in
// vite.config.mts). Loaded via `node --import` from the `test` script in
// package.json; never loaded by the browser or by production.

import { register } from 'node:module';

register('./node-test-resolver.mjs', import.meta.url);
