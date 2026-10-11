#!/usr/bin/env node
// Build scenes/draft/database-systems-lab.json.
//
//   node scripts/database_lab/build_lesson.mjs           # write the lesson
//   node scripts/database_lab/build_lesson.mjs --check   # fail if the committed lesson is stale
//
// Generated rather than hand-written because the scenarios, their SQL and the board
// wiring all come from the `database` domain library: the SQL in the Code tab is
// rendered from the same programs the engine runs, so code and simulation cannot drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, LAB, T, readExample, lineIn } from './util.mjs';
import { SCENES } from './scenes.mjs';
import { GLOSSARY } from './glossary.mjs';

const OUT = join(ROOT, 'scenes', 'draft', 'database-systems-lab.json');

/** Every step of every transaction scene, with the scenarios its Scenario slider can reach. */
function stepsOf(scenes) {
    return scenes.flatMap(scene => {
        const reach = scene.steps[0].sliders.find(s => s.id === 'scenario');
        return reach ? scene.steps.map(step => ({ scene: scene.id, step: step.id, maxScenario: reach.max,
            retry: scene.steps[0].sliders.some(s => s.id === 'retry') })) : [];
    });
}

// Locations make the step caption link to code: the caption lists a location only while its line is
// active (activeLineExpr), so listing every statement line for every step yields one link that follows
// the tick — the statement running now — and, where retries exist, the abort and retry lines.
function codeFiles(scenes) {
    const steps = stepsOf(scenes);
    const files = LAB.SCENARIOS.map((sc, i) => {
        const { source, lines } = LAB.renderSql(i);
        const text = source.split('\n');
        const statements = Object.entries(lines).map(([ref, line]) => ({ line, label: `${ref.split(':')[0]} · ${text[line - 1].replace(/\s+--.*$/, '')}` }));
        return {
            id: 'sql-' + sc.id, path: `database_lab/sql/${sc.id}.sql`, language: 'sql', source,
            activeLineExpr: `[dbSqlLine(${i}, scenario, ${T('opref')})]`,
            locations: steps.filter(st => i <= st.maxScenario).flatMap(st => statements.map(x => ({ line: x.line, scene: st.scene, step: st.step, label: x.label }))),
        };
    });
    const retry = readExample('retry.py');
    const at = (op, needle) => `(dbOp(${T('ops')}, '${op}') ? ${lineIn(retry, needle)} : 0)`;
    const retryLines = [['abort', 'except RETRYABLE:', 'the database aborted the transaction: catch 40001 / 40P01'],
        ['retry', 'for attempt in range', 'rerun the whole transaction']];
    files.push({
        id: 'retry', path: 'database_lab/retry.py', language: 'python', source: retry,
        activeLineExpr: '[' + [at('read', 'SELECT v FROM'), at('write', 'UPDATE accounts'), at('commit', 'leaving the block COMMITs'),
            ...retryLines.map(([op, needle]) => at(op, needle))].join(', ') + ']',
        locations: steps.filter(st => st.retry).flatMap(st => retryLines.map(([, needle, label]) => ({ line: lineIn(retry, needle), scene: st.scene, step: st.step, label }))),
    });
    return files;
}

function build() {
    const lesson = {
        title: 'Database Systems Laboratory',
        import: ['database'],
        glossaryMatchThreshold: 4,
        glossary: GLOSSARY,
        codeFiles: null,
        scenes: SCENES.map(scene => scene()),
    };
    lesson.codeFiles = codeFiles(lesson.scenes);
    return JSON.stringify(lesson, null, 2) + '\n';
}

const json = build();
if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== json) { console.error('database-systems-lab.json is stale: run node scripts/database_lab/build_lesson.mjs'); process.exit(1); }
    console.log('database-systems-lab.json is up to date');
} else {
    writeFileSync(OUT, json);
    console.log(`wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
}
