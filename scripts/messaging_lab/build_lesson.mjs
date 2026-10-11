#!/usr/bin/env node
// Build scenes/draft/messaging-systems-lab.json.
//
//   node scripts/messaging_lab/build_lesson.mjs           # write the lesson
//   node scripts/messaging_lab/build_lesson.mjs --check   # fail if the committed lesson is stale
//
// The lesson is generated rather than hand-written because every messaging system
// repeats the same wiring: a trace table bound to the `messaging` domain, a
// system_dag whose blocks read that table, code files whose active lines follow
// the simulated operations, and the same scenario sliders. Adding a system means
// adding one entry to SYSTEMS (plus its adapter in static/domains/messaging).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, FILES, source, lineOf } from './util.mjs';
import { SYSTEMS } from './systems.mjs';
import { SCENES } from './scenes.mjs';
import { CONCEPT_SCENE } from './concepts.mjs';
import { GLOSSARY } from './glossary.mjs';

const OUT = join(ROOT, 'scenes', 'draft', 'messaging-systems-lab.json');

/** Code files: the samples, with active lines bound to simulated operations and crash actions on consumer lines. */
function codeFiles(systemIds) {
    const processOps = systemIds.map(id => `mqOp(dataTable('${id}', frame, 'ops'), 'process')`).join(' or ');
    const files = [{ id: 'common', path: 'messaging_lab/' + FILES.common, language: 'python', source: source('common'),
        activeLineExpr: `[(${processOps}) ? ${lineOf('common', 'print("charged"')} : 0]` }];
    for (const id of systemIds) for (const file of SYSTEMS[id].code) {
        const ops = Object.entries(file.ops).map(([op, needle]) => [op, lineOf(file.id, needle)]);
        const lineActions = (file.actions ?? []).map(a => ({ line: lineOf(file.id, a.at), label: a.label, set: a.set }));
        files.push({
            id: file.id, path: 'messaging_lab/' + FILES[file.id], language: 'python', source: source(file.id),
            activeLineExpr: '[' + ops.map(([op, line]) => `(mqOp(dataTable('${id}', frame, 'ops'), '${op}') ? ${line} : 0)`).join(', ') + ']',
            ...(lineActions.length ? { lineActions } : {}),
        });
    }
    return files;
}

// ── Lesson assembly ──────────────────────────────────────────────────────────
function build() {
    const systemIds = Object.keys(SYSTEMS);
    const lesson = {
        title: 'Messaging Systems Laboratory',
        import: ['messaging'],
        glossaryMatchThreshold: 4,
        glossary: GLOSSARY,
        codeFiles: codeFiles(systemIds),
        scenes: [...SCENES.map(scene => scene()), CONCEPT_SCENE()].filter(Boolean),
    };
    return JSON.stringify(lesson, null, 2) + '\n';
}

const json = build();
if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== json) { console.error('messaging-systems-lab.json is stale: run node scripts/messaging_lab/build_lesson.mjs'); process.exit(1); }
    console.log('messaging-systems-lab.json is up to date');
} else {
    writeFileSync(OUT, json);
    console.log(`wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
}
