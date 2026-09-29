// ============================================================
// plan-store.ts — Learning plans persisted in IndexedDB.
//
// One record per saved plan (key: id). A nested sub-plan is part of its
// parent's record; a referenced sub-plan is its own record. All plan logic
// lives in plan-core.ts — this module only reads and writes records.
//
// Plans are per browser: private windows, cleared site data, or another
// browser start empty. Export/import (plan-core) is how a plan moves.
// localStorage keeps only the id of the plan being walked.
// ============================================================

import { validatePlan } from '/plan-core.js';
import type { LearningPlan } from '/plan-core.js';

const DB_NAME = 'algebench-plans';
const DB_VERSION = 1;
const STORE = 'plans';
const ACTIVE_KEY = 'algebench.activePlan';

export interface PlanStore {
    /** Every saved plan, most recently updated first. */
    list(): Promise<LearningPlan[]>;
    get(id: string): Promise<LearningPlan | undefined>;
    /** Save one or more plans in a single transaction (a navigator result's `changed`). */
    save(plans: LearningPlan | LearningPlan[]): Promise<void>;
    delete(id: string): Promise<void>;
}

function promised<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt');
            store.createIndex('status', 'status');
        }
    };
    return promised(req);
}

/**
 * The IndexedDB-backed store. The database opens on first use; a browser
 * that refuses IndexedDB (some private modes) makes every call reject, and
 * the caller shows that plans can't be saved here.
 */
export function createPlanStore(factory: IDBFactory | undefined = globalThis.indexedDB): PlanStore {
    let db: Promise<IDBDatabase> | null = null;
    const conn = (): Promise<IDBDatabase> => {
        if (!factory) return Promise.reject(new Error('IndexedDB is not available in this browser'));
        db ??= openDb(factory).catch((e) => { db = null; throw e; });
        return db;
    };
    return {
        async list() {
            const tx = (await conn()).transaction(STORE, 'readonly');
            const all = await promised(tx.objectStore(STORE).getAll() as IDBRequest<LearningPlan[]>);
            // Skip anything unreadable (a record from a newer schema) rather than fail the list.
            return all.filter((p) => validatePlan(p).length === 0)
                .sort((a, b) => b.updatedAt - a.updatedAt);
        },
        async get(id) {
            const tx = (await conn()).transaction(STORE, 'readonly');
            const p = await promised(tx.objectStore(STORE).get(id) as IDBRequest<LearningPlan | undefined>);
            return p && validatePlan(p).length === 0 ? p : undefined;
        },
        async save(plans) {
            const list = Array.isArray(plans) ? plans : [plans];
            if (!list.length) return;
            for (const p of list) {
                const errs = validatePlan(p);
                if (errs.length) throw new Error(`refusing to save an invalid plan: ${errs[0]}`);
            }
            const tx = (await conn()).transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const p of list) store.put(p);
            await done(tx);
        },
        async delete(id) {
            const tx = (await conn()).transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            await done(tx);
        },
    };
}

/** The id of the plan being walked, or null. Storage may be blocked; that just means none. */
export function getActivePlanId(): string | null {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

export function setActivePlanId(id: string | null): void {
    try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* storage blocked: the walk just isn't remembered across reloads */ }
}
