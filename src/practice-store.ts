// ============================================================
// practice-store.ts — Type along's attempts (code-practice.ts), persisted in IndexedDB.
//
// One record per block practised (key: lesson id, file path and block), so what a learner types never weighs on localStorage
// and a lesson's attempts stay its own. Per browser, like the watches (watch-store.ts) and the plans: a private
// window or cleared site data starts empty. A browser that refuses IndexedDB keeps attempts for the session only.
// ============================================================

const DB_NAME = 'algebench-practice';
const DB_VERSION = 1;
const STORE = 'attempts';

interface AttemptRecord<T> { key: string; lesson: string; file: string; block: string; attempt: T; updatedAt: number }

export const attemptKey = (lesson: string, file: string, block: string): string => [lesson, file, block].join('\u0000');

export interface PracticeStore<T> {
    get(lesson: string, file: string, block: string): Promise<T | undefined>;
    put(lesson: string, file: string, block: string, attempt: T): Promise<void>;
    /** The attempt stored under a raw key (an older key format), removed as it is read: for moving it. */
    take(key: string): Promise<T | undefined>;
}

function promised<R>(req: IDBRequest<R>): Promise<R> {
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
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'key'}).createIndex('lesson', 'lesson');
    };
    return promised(req);
}

/** In memory, for a browser without IndexedDB: attempts last the session. */
function memoryStore<T>(): PracticeStore<T> {
    const all = new Map<string, T>();
    return {
        async get(lesson, file, block) { return all.get(attemptKey(lesson, file, block)); },
        async put(lesson, file, block, attempt) { all.set(attemptKey(lesson, file, block), attempt); },
        async take(key) { const t = all.get(key);all.delete(key);return t; },
    };
}

export function createPracticeStore<T>(factory: IDBFactory | undefined = globalThis.indexedDB): PracticeStore<T> {
    if (!factory) return memoryStore<T>();
    let db: Promise<IDBDatabase> | null = null;
    const conn = (): Promise<IDBDatabase> => {
        db ??= openDb(factory).then(d => {
            // Another tab upgrading the schema asks open connections to close; reopen on the next call.
            d.onversionchange = () => { d.close();db = null; };
            d.onclose = () => { db = null; };
            return d;
        }, e => { db = null;throw e; });
        return db;
    };
    const fallback = memoryStore<T>();
    return {
        async get(lesson, file, block) {
            try {
                const tx = (await conn()).transaction(STORE, 'readonly');
                const row = await promised(tx.objectStore(STORE).get(attemptKey(lesson, file, block)) as IDBRequest<AttemptRecord<T> | undefined>);
                return row?.attempt ?? await fallback.get(lesson, file, block);
            } catch { return fallback.get(lesson, file, block); }
        },
        async put(lesson, file, block, attempt) {
            try {
                const tx = (await conn()).transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({key: attemptKey(lesson, file, block), lesson, file, block, attempt, updatedAt: Date.now()} satisfies AttemptRecord<T>);
                await done(tx);
            } catch { await fallback.put(lesson, file, block, attempt); }
        },
        async take(key) {
            try {
                const tx = (await conn()).transaction(STORE, 'readwrite');
                const store = tx.objectStore(STORE);
                const row = await promised(store.get(key) as IDBRequest<AttemptRecord<T> | undefined>);
                if (row) store.delete(key);
                await done(tx);
                return row?.attempt;
            } catch { return fallback.take(key); }
        },
    };
}
