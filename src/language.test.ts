import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLanguage, DEFAULT_LANGUAGE, LANGUAGES, LANGUAGE_MAX_CHARS } from '/language.js';
import { languageSuggestions } from '/chat-settings.js';

test('a typed language is trimmed, capped, and takes a listed name\'s spelling', () => {
    assert.equal(cleanLanguage('  turkish '), 'Turkish');
    assert.equal(cleanLanguage('Türkçe'), 'Türkçe');
    assert.equal(cleanLanguage('x'.repeat(40)).length, LANGUAGE_MAX_CHARS);
    assert.equal(cleanLanguage('Swahili!!'), 'Swahili');
    assert.equal(cleanLanguage(''), DEFAULT_LANGUAGE);
    assert.equal(cleanLanguage(null), DEFAULT_LANGUAGE);
});

test('the list has the common languages, Turkish among them', () => {
    assert.ok(LANGUAGES.length >= 20 && LANGUAGES.includes('Turkish') && LANGUAGES[0] === DEFAULT_LANGUAGE);
    assert.ok(LANGUAGES.every(l => l.length <= LANGUAGE_MAX_CHARS));
});

test('suggestions put names that start with the typed text first', () => {
    assert.deepEqual(languageSuggestions('tu'), ['Turkish', 'Portuguese']);
    assert.deepEqual(languageSuggestions('xyz'), []);
    assert.equal(languageSuggestions('').length, LANGUAGES.length);
});
