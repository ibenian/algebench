// createPlanStore against an in-memory IndexedDB: the schema, the CRUD
// contract (validation on the way in and out, recent-first listing, one
// transaction per save) and the cached connection stepping aside for an upgrade.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanStore } from './plan-store.js';
import type { LearningPlan } from './plan-core.js';

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

// ----- an in-memory IndexedDB: just the surface plan-store uses -----

type Req = { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };

/** Requests settle on a later tick, like the real thing; a transaction
 *  completes once its requests have, and commits its writes only then. */
function memoryIdb() {
    const stores = new Map<string, { keyPath: string; indexes: string[]; rows: Map<string, unknown> }>();
    let version = 0;
    let transactions = 0;
    const later = (fn: () => void) => setImmediate(fn);
    const db = {
        objectStoreNames: { contains: (n: string) => stores.has(n) },
        createObjectStore(name: string, opts: { keyPath: string }) {
            const st = { keyPath: opts.keyPath, indexes: [] as string[], rows: new Map<string, unknown>() };
            stores.set(name, st);
            return { createIndex: (idx: string) => { st.indexes.push(idx); } };
        },
        transaction(name: string, mode: 'readonly' | 'readwrite') {
            transactions++;
            const st = stores.get(name);
            if (!st) throw new Error(`no store ${name}`);
            const writes: Array<() => void> = [];
            let pending = 0;
            const tx: Record<string, unknown> = {};
            const settle = () => { if (--pending === 0) later(() => { writes.forEach((w) => w()); (tx.oncomplete as () => void)?.(); }); };
            const request = (result: () => unknown): Req => {
                const req: Req = {};
                pending++;
                later(() => { req.result = result(); req.onsuccess?.(); settle(); });
                return req;
            };
            tx.objectStore = () => ({
                get: (id: string) => request(() => structuredClone(st.rows.get(id))),
                getAll: () => request(() => [...st.rows.values()].map((r) => structuredClone(r))),
                put: (row: Record<string, unknown>) => {
                    assert.equal(mode, 'readwrite', 'writes need a readwrite transaction');
                    const copy = structuredClone(row);
                    writes.push(() => st.rows.set(String(copy[st.keyPath]), copy));
                    return request(() => copy[st.keyPath]);
                },
                delete: (id: string) => {
                    assert.equal(mode, 'readwrite', 'writes need a readwrite transaction');
                    writes.push(() => st.rows.delete(id));
                    return request(() => undefined);
                },
            });
            return tx;
        },
        close() {},
    };
    const factory = {
        open(_name: string, v: number) {
            const req: Req = { result: db };
            later(() => {
                if (v > version) { version = v; req.onupgradeneeded?.(); }
                req.onsuccess?.();
            });
            return req;
        },
    };
    return { factory: factory as unknown as IDBFactory, stores, txCount: () => transactions };
}

const L = 'atmospheric-entry-physics';
function plan(id: string, updatedAt: number): LearningPlan {
    return {
        schemaVersion: 1, id, title: `plan ${id}`, target: { text: id, origin: { builtin: L } },
        status: 'active', createdAt: 0, updatedAt,
        steps: [{ id: 's1', kind: 'scene', title: 's1', why: '', state: 'todo', source: 'learner',
                  ref: { lesson: L, sc: 'a' }, view: { builtin: L, sc: 'a' } }],
    };
}

test('the first open creates the plans store, keyed by id, with its indexes', async () => {
    const mem = memoryIdb();
    await createPlanStore(mem.factory).list();
    const st = mem.stores.get('plans')!;
    assert.equal(st.keyPath, 'id');
    assert.deepEqual(st.indexes.sort(), ['status', 'updatedAt']);
});

test('save, get, list and delete round-trip; list is most recently updated first', async () => {
    const store = createPlanStore(memoryIdb().factory);
    await store.save(plan('old', 1));
    await store.save([plan('new', 3), plan('mid', 2)]);
    assert.deepEqual((await store.list()).map((p) => p.id), ['new', 'mid', 'old']);
    assert.deepEqual(await store.get('mid'), plan('mid', 2));
    await store.save({ ...plan('old', 9), title: 'renamed' });     // put replaces
    assert.deepEqual((await store.list()).map((p) => p.id), ['old', 'new', 'mid'], 'moved to the top by its update');
    assert.equal((await store.get('old'))!.title, 'renamed');
    await store.delete('new');
    assert.equal(await store.get('new'), undefined);
    assert.deepEqual((await store.list()).map((p) => p.id), ['old', 'mid']);
});

test('a multi-plan save is one transaction, and all-or-nothing when any plan is invalid', async () => {
    const mem = memoryIdb();
    const store = createPlanStore(mem.factory);
    await store.list();
    const before = mem.txCount();
    await store.save([plan('a', 1), plan('b', 2)]);
    assert.equal(mem.txCount() - before, 1, 'one transaction for the navigator\'s changed plans');

    const broken = { ...plan('c', 3), steps: 'nope' } as unknown as LearningPlan;
    await assert.rejects(store.save([plan('ok', 4), broken]), /refusing to save an invalid plan/);
    await store.save([]);                        // nothing to do
    assert.equal(mem.txCount() - before, 1, 'a refused or empty save opens no transaction');
    assert.equal(await store.get('ok'), undefined, 'nothing from a refused save is written');
});

test('an unreadable stored record is skipped by list and hidden from get', async () => {
    const mem = memoryIdb();
    const store = createPlanStore(mem.factory);
    await store.save(plan('good', 1));
    mem.stores.get('plans')!.rows.set('bad', { id: 'bad', schemaVersion: 99 });   // e.g. from a newer build
    assert.deepEqual((await store.list()).map((p) => p.id), ['good']);
    assert.equal(await store.get('bad'), undefined);
});
