// createPlanStore: its cached IndexedDB connection steps aside for an upgrade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanStore } from './plan-store.js';

/** A stand-in IDBFactory: each open() yields a fresh fake connection. */
function fakeFactory() {
    const opened: Array<{ closed: boolean; onversionchange: (() => void) | null; onclose: (() => void) | null }> = [];
    const factory = {
        open() {
            const db = {
                closed: false, onversionchange: null, onclose: null,
                objectStoreNames: { contains: () => true },
                close() { this.closed = true; },
                // Every read fails fast: these tests only watch the connection.
                transaction() { throw new Error('no stores in the fake'); },
            };
            opened.push(db);
            const req: Record<string, unknown> = { result: db };
            setImmediate(() => (req.onsuccess as () => void)());
            return req;
        },
    };
    return { factory: factory as unknown as IDBFactory, opened };
}

test('the store reuses one connection until another tab asks it to close', async () => {
    const { factory, opened } = fakeFactory();
    const store = createPlanStore(factory);
    await assert.rejects(store.list());
    await assert.rejects(store.list());
    assert.equal(opened.length, 1, 'one cached connection');

    opened[0]!.onversionchange!();           // another tab upgrades the schema
    assert.equal(opened[0]!.closed, true, 'the old connection closes so the upgrade can proceed');
    await assert.rejects(store.list());
    assert.equal(opened.length, 2, 'the next call opens a fresh connection');

    opened[1]!.onclose!();                   // the browser closed it
    await assert.rejects(store.get('x'));
    assert.equal(opened.length, 3);
});
