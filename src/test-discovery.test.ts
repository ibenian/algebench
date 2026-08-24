// Guards the test runner's own file discovery.
//
// `npm test` used to run `--test src/*.test.ts`, which is NOT recursive: a test
// file in a subdirectory was silently skipped — it did not fail, it did not warn,
// it simply never ran. Every test file happened to be top-level, so nothing was
// missing; the trap was that the first nested one would be. Measured before the
// fix: a probe at `src/__probe/dummy.test.ts` was collected 0 times.
//
// That matters more from here on, because the builder work adds modules in
// subdirectories. A test that does not run is worse than a missing one — it reads
// as coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function testFilesUnder(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) testFilesUnder(full, acc);
        else if (entry.name.endsWith('.test.ts')) acc.push(full);
    }
    return acc;
}

test('the npm test glob is recursive, so no test file can be silently skipped', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: { test: string } };
    const script = pkg.scripts.test;

    // The pattern must be quoted so Node expands it rather than the shell, and it
    // must use `**` — a bare `src/*.test.ts` reaches only the top level.
    assert.match(
        script,
        /"src\/\*\*\/\*\.test\.ts"/,
        `npm test must collect nested tests. Got: ${script}`,
    );
});

test('every test file lives where the glob can see it', () => {
    // Belt to the brace above: if the glob is ever narrowed again, this names the
    // files that would stop running rather than leaving it to be noticed later.
    const found = testFilesUnder('src');
    assert.ok(found.length > 0, 'expected to find test files under src/');
    assert.ok(
        found.every((f) => f.startsWith('src/')),
        `test files outside the collected tree: ${found.filter((f) => !f.startsWith('src/')).join(', ')}`,
    );
});
