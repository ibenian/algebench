#!/usr/bin/env node
// Build scenes/draft/distributed-databases-lab.json.
//
//   node scripts/lesson_builders/distributed-databases-lab/build_lesson.mjs           # write the lesson
//   node scripts/lesson_builders/distributed-databases-lab/build_lesson.mjs --check   # fail if the committed lesson is stale
//
// Generated rather than hand-written because the scenarios, their settings and the board wiring
// all come from the `distdb` domain library, so the lesson and the simulation cannot drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, T, readExample, lineIn } from './util.mjs';
import { SCENES } from './scenes.mjs';
import { GLOSSARY } from './glossary.mjs';

const OUT = join(ROOT, 'scenes', 'draft', 'distributed-databases-lab.json');

// Client code in the Code tab. Lines light while an operation of that kind starts or finishes
// on the board, under the topology the file belongs to (single leader or leaderless).
const CODE = [
    { id: 'postgres-conf', path: 'distdb_lab/postgres/postgresql.conf', language: 'ini', topology: 'leader', lines: [] },
    { id: 'postgres-client', path: 'distdb_lab/postgres/client.py', language: 'python', topology: 'leader',
        lines: [['put', 'primary.execute("UPDATE kv'], ['get', 'return replica.execute(']] },
    { id: 'mongodb-client', path: 'distdb_lab/mongodb/client.py', language: 'python', topology: 'leader',
        lines: [['put', 'kv.update_one({"_id": key}, {"$set": {"v": value}}, upsert=True)'], ['get', 'return kv.find_one(']] },
    { id: 'cassandra-client', path: 'distdb_lab/cassandra/client.py', language: 'python', topology: 'leaderless',
        lines: [['put', 'session.execute(stmt, (value, key))'], ['get', 'return session.execute(stmt, (key,))'], ['del', 'session.execute(SimpleStatement("DELETE']] },
    { id: 'dynamodb-client', path: 'distdb_lab/dynamodb/client.py', language: 'python', topology: 'leader',
        lines: [['put', 'table.put_item(Item={"k": key, "v": value})'], ['get', 'return table.get_item(Key={"k": key})["Item"]']] },
    { id: 'redis-cluster', path: 'distdb_lab/redis/cluster.py', language: 'python', topology: 'leader', lines: [['put', '    r.set(key, value)  #']] },
];
function codeFiles() {
    return CODE.map(file => {
        const source = readExample(file.path.replace('distdb_lab/', ''));
        const active = file.lines.map(([op, needle]) => `ddCodeLine(${T('ops')}, ${T('topology')}, '${file.topology}', '${op}', ${lineIn(source, needle)})`);
        return { id: file.id, path: file.path, language: file.language, source, ...(active.length ? { activeLineExpr: `[${active.join(', ')}]` } : {}) };
    });
}

/** This lab lights every state change: arrays, tensors and system_dag links (contained elements included). */
function highlightAllStateChanges(node) {
    if (Array.isArray(node)) { node.forEach(highlightAllStateChanges); return; }
    if (!node || typeof node !== 'object') return;
    if (['array', 'tensor', 'system_dag'].includes(node.type) && node.highlightStateChanges === undefined) node.highlightStateChanges = true;
    for (const value of Object.values(node)) highlightAllStateChanges(value);
}

function build() {
    const lesson = {
        title: 'Distributed Databases Laboratory',
        import: ['distdb'],
        glossaryMatchThreshold: 4,
        glossary: GLOSSARY,
        codeFiles: codeFiles(),
        scenes: SCENES.map(scene => scene()),
    };
    highlightAllStateChanges(lesson.scenes);
    return JSON.stringify(lesson, null, 2) + '\n';
}

// The lesson must stay pure math.js: any expression matching the app's JS detector (src/expr.ts
// _JS_ONLY_RE — even a string literal such as 'delete') makes the app show the untrusted-JS dialog.
function assertNoJs(lesson) {
    const src = readFileSync(join(ROOT, 'src', 'expr.ts'), 'utf8').match(/export const _JS_ONLY_RE = (\/.*\/);/)[1];
    const re = new RegExp(src.slice(1, -1));
    const bad = [];
    (function walk(o, key, path) {
        if (typeof o === 'string') { if (key && /.Expr$|^(expr|x|y|z|expression)$/.test(key) && re.test(o)) bad.push(`${path}: ${o.match(re)[0]}`); return; }
        if (Array.isArray(o)) { o.forEach((v, i) => walk(v, key, `${path}[${i}]`)); return; }
        if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, k, `${path}.${k}`);
    })(lesson, null, '');
    if (bad.length) throw new Error('expressions the app would treat as JavaScript:\n' + bad.slice(0, 10).join('\n'));
}

assertNoJs(JSON.parse(build()));
const json = build();
if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== json) { console.error('distributed-databases-lab.json is stale: run node scripts/lesson_builders/distributed-databases-lab/build_lesson.mjs'); process.exit(1); }
    console.log('distributed-databases-lab.json is up to date');
} else {
    writeFileSync(OUT, json);
    console.log(`wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
}
