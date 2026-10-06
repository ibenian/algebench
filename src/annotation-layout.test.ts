import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationGroups, annotationRows, annotationText } from '/annotation-layout.js';
import type { AnnotationBox } from '/annotation-layout.js';
const marker = (name: string, value: number, group='input', x=0): AnnotationBox => ({kind:'marker',text:'',index:{name,value,group},x,y:0,width:60,height:25});
test('same data target merges index names, different targets stay separate rows', () => {
    assert.deepEqual(annotationRows([marker('i',2),marker('j',2)]),['i = j = 2']);
    assert.deepEqual(annotationRows([marker('i',2),marker('j',3)]),['i = 2','j = 3']);
    assert.deepEqual(annotationRows([marker('i',2),marker('j',2,'other')]),['i = 2','j = 2']);
});
test('indices regroup deterministically after separating and seeking backwards', () => {
    assert.deepEqual(annotationGroups([marker('i',2),marker('j',2)]),[[0,1]]);
    assert.deepEqual(annotationGroups([marker('i',2),marker('j',3,'input',100)]),[[0],[1]]);
    assert.deepEqual(annotationGroups([marker('i',2),marker('j',2)]),[[0,1]]);
});
test('overlapping expression labels retain every row, including identical values', () => {
    const labels: AnnotationBox[] = ['false','false','42'].map((text,i)=>({kind:'label',text,x:i*40,y:0,width:60,height:25}));
    assert.deepEqual(annotationGroups(labels),[[0,1,2]]);
    assert.deepEqual(annotationRows(labels),['false','false','42']);
    assert.deepEqual(annotationGroups([...labels, marker('i',0)]),[[0,1,2],[3]]);
});
test('expression label formatting preserves values instead of rounding or coercing strings', () => {
    for (const [value, expected] of [[false,'false'],[null,'null'],[2.75,'2.75'],['<b>text</b>','<b>text</b>'],[[1,'two'],'[1,"two"]'],[{a:1},'{"a":1}']] as const) assert.equal(annotationText(value),expected);
});
