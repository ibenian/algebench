import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeSections, sectionAt, sectionsOutline, sectionPrompt } from '/code-sections.js';

const source = Array.from({length: 10}, (_, i) => `line ${i + 1}`).join('\n');
const s = (id: string, from: number, to: number) => ({id, title: id, from, to});

test('sections come in line order, clipped to the file', () => {
    assert.deepEqual(codeSections({source, sections: [s('b', 5, 12), s('a', 1, 3)]}).map(x => [x.id, x.from, x.to]),
        [['a', 1, 3], ['b', 5, 10]]);
    assert.deepEqual(codeSections({source}), [], 'a file without sections');
});

test('an inverted, outside or overlapping section is left out, not the panel broken', () => {
    const kept = codeSections({source, sections: [s('ok', 1, 4), s('overlap', 4, 6), s('inverted', 8, 7), s('outside', 11, 12), s('next', 5, 6)]});
    assert.deepEqual(kept.map(x => x.id), ['ok', 'next']);
});

test('a line belongs to the section whose range holds it', () => {
    const sections = codeSections({source, sections: [s('a', 1, 3), s('b', 5, 6)]});
    assert.equal(sectionAt(sections, 2)?.id, 'a');
    assert.equal(sectionAt(sections, 6)?.id, 'b');
    assert.equal(sectionAt(sections, 4), null, 'between sections');
});

test('the tutor reads the structure as ranges and titles, and asks about a section by its prompt or its title', () => {
    assert.equal(sectionsOutline([{id: 'a', title: 'Start', from: 1, to: 1}, {id: 'b', title: 'Loop', from: 2, to: 4}]),
        'line 1: Start\nlines 2–4: Loop');
    assert.equal(sectionPrompt({id: 'a', title: 'Start', from: 1, to: 1, prompt: 'Why start here?'}).prompt, 'Why start here?');
    assert.match(sectionPrompt({id: 'b', title: 'Loop', from: 2, to: 4}).prompt, /"Loop"/);
});
