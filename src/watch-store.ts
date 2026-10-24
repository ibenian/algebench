// ============================================================
// watch-store.ts — The Code panel's watch expressions, persisted in IndexedDB.
//
// One record per watch (key: lesson, file, line and expression), indexed by lesson, so a lesson loads only its
// own and the list can grow without weighing on localStorage. Per browser, like the plans (plan-store.ts): a
// private window or cleared site data starts empty. A browser that refuses IndexedDB keeps watches for the
// session only.
// ============================================================

const DB_NAME = 'algebench-watches';
const DB_VERSION = 1;
const STORE = 'watches';

/** A watch: an expression the reader selected on a line of a lesson's code file. */
export interface Watch { lesson: string; file: string; line: number; expr: string }
interface WatchRecord extends Watch { key: string; addedAt: number }

export const watchKey = (w: Watch): string => [w.lesson, w.file, w.line, w.expr].join('\u0000');

export interface WatchStore {
    /** The lesson's watches, oldest first. */
    list(lesson: string): Promise<Watch[]>;
    add(w: Watch): Promise<void>;
    remove(w: Watch): Promise<void>;
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
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'key'}).createIndex('lesson', 'lesson');
    };
    return promised(req);
}

const valid = (w: unknown): w is Watch => !!w && typeof (w as Watch).lesson === 'string' && typeof (w as Watch).file === 'string'
    && Number.isInteger((w as Watch).line) && typeof (w as Watch).expr === 'string';

/** In memory, for a browser without IndexedDB: the watches last the session. */
function memoryStore(): WatchStore {
    const all = new Map<string, Watch>();
    return {
        async list(lesson) { return [...all.values()].filter(w => w.lesson === lesson); },
        async add(w) { all.set(watchKey(w), w); },
        async remove(w) { all.delete(watchKey(w)); },
    };
}

export function createWatchStore(factory: IDBFactory | undefined = globalThis.indexedDB): WatchStore {
    if (!factory) return memoryStore();
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
    const fallback = memoryStore();
    return {
        async list(lesson) {
            try {
                const tx = (await conn()).transaction(STORE, 'readonly');
                const rows = await promised(tx.objectStore(STORE).index('lesson').getAll(lesson) as IDBRequest<WatchRecord[]>);
                return rows.filter(valid).sort((a, b) => a.addedAt - b.addedAt).map(({lesson, file, line, expr}) => ({lesson, file, line, expr}));
            } catch { return fallback.list(lesson); }
        },
        async add(w) {
            try {
                const tx = (await conn()).transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({...w, key: watchKey(w), addedAt: Date.now()} satisfies WatchRecord);
                await done(tx);
            } catch { await fallback.add(w); }
        },
        async remove(w) {
            try {
                const tx = (await conn()).transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(watchKey(w));
                await done(tx);
            } catch { await fallback.remove(w); }
        },
    };
}
