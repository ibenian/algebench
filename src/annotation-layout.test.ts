import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationGroups, annotationRows, annotationText, annotationGroupAnchor, annotationInsertionIndex, annotationContainerTitle } from '/annotation-layout.js';
import type { AnnotationBox } from '/annotation-layout.js';
const marker = (name: string, value: number, group='input', x=0): AnnotationBox => ({kind:'marker',text:'',index:{name,value,group},x,y:0,width:60,height:25});
test('Vars requires every row to contain an assignment form', () => {
    assert.equal(annotationContainerTitle(['i = 2', 'size = 3']), 'Vars');
    assert.equal(annotationContainerTitle(['i = j = 2']), 'Vars');
    for (const rows of [[], ['i = 2', 'Hello'], ['i == 2'], ['i >= 2'], ['= 2'], ['i =']]) {
        assert.equal(annotationContainerTitle(rows), 'Labels');
    }
});
test('world labels do not merge into screen overlays just because they project nearby', () => {
    const base: AnnotationBox = {kind:'label',text:'a',x:0,y:0,width:80,height:40,coordinateMode:'world'};
    assert.deepEqual(annotationGroups([base, {...base,coordinateMode:'screen'}]), [[0],[1]]);
});
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

test('merged label box follows moving members while preserving independent anchors',()=>{
    const points=[{x:100,y:50},{x:120,y:50}];
    assert.deepEqual(annotationGroupAnchor(points),{x:110,y:50});
    points[1]!.x=160;
    assert.deepEqual(annotationGroupAnchor(points),{x:130,y:50});
    assert.deepEqual(points[0],{x:100,y:50});
    assert.deepEqual(annotationGroupAnchor([points[1]!]),{x:160,y:50});
});

test('dragged rows insert above, between, or below existing rows', () => {
    assert.equal(annotationInsertionIndex([10, 30, 50], 0), 0);
    assert.equal(annotationInsertionIndex([10, 30, 50], 20), 1);
    assert.equal(annotationInsertionIndex([10, 30, 50], 30), 2);
    assert.equal(annotationInsertionIndex([10, 30, 50], 60), 3);
    assert.equal(annotationInsertionIndex([], 20), 0);
});

test('a freely dragged label does not shift a target box before snapping', () => {
    const labels: AnnotationBox[] = [
        {kind:'label', text:'target', x:0, y:0, width:100, height:25},
        {kind:'label', text:'dragged', x:20, y:0, width:100, height:25, detached:true},
    ];
    assert.deepEqual(annotationGroups(labels), [[0],[1]]);
    labels[1]!.detached = false;
    labels[1]!.x = 0;
    assert.deepEqual(annotationGroups(labels), [[0,1]]);
});
