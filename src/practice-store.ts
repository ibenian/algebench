// ============================================================
// practice-store.ts — Type along's attempts (code-practice.ts), persisted in IndexedDB.
//
// One record per block practised (key: lesson and block), so what a learner types never weighs on localStorage
// and a lesson's attempts stay its own. Per browser, like the watches (watch-store.ts) and the plans: a private
// window or cleared site data starts empty. A browser that refuses IndexedDB keeps attempts for the session only.
// ============================================================

const DB_NAME = 'algebench-practice';
const DB_VERSION = 1;
const STORE = 'attempts';

interface AttemptRecord<T> { key: string; lesson: string; block: string; attempt: T; updatedAt: number }

export const attemptKey = (lesson: string, block: string): string => `${lesson}\u0000${block}`;

export interface PracticeStore<T> {
    get(lesson: string, block: string): Promise<T | undefined>;
    put(lesson: string, block: string, attempt: T): Promise<void>;
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
        async get(lesson, block) { return all.get(attemptKey(lesson, block)); },
        async put(lesson, block, attempt) { all.set(attemptKey(lesson, block), attempt); },
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
        async get(lesson, block) {
            try {
                const tx = (await conn()).transaction(STORE, 'readonly');
                const row = await promised(tx.objectStore(STORE).get(attemptKey(lesson, block)) as IDBRequest<AttemptRecord<T> | undefined>);
                return row?.attempt ?? await fallback.get(lesson, block);
            } catch { return fallback.get(lesson, block); }
        },
        async put(lesson, block, attempt) {
            try {
                const tx = (await conn()).transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({key: attemptKey(lesson, block), lesson, block, attempt, updatedAt: Date.now()} satisfies AttemptRecord<T>);
                await done(tx);
            } catch { await fallback.put(lesson, block, attempt); }
        },
    };
}
