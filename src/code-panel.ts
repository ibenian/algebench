import { setSliderValue } from '/sliders.js';
import { state } from '/state.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { makeAiAskButton } from '/labels.js';
import { navigateTo } from '/scene-loader.js';
import { fileTree, markedSegments, relatedLocations } from '/code-panel-model.js';
import type { CodeFile, FileTree } from '/code-panel-model.js';
import type { LessonFormat, Scene } from '/types/lesson.js';

export function setupCodePanel(): void {
    const host=document.getElementById('dock-tab-code');
    if(!host)return;
    const tree=document.createElement('div');tree.className='code-file-tree';tree.setAttribute('aria-label','Code files');
    const title=document.createElement('div');title.className='code-file-title';
    const body=document.createElement('div');body.className='code-source';body.setAttribute('aria-label','Source code');
    const actions=document.createElement('div');actions.className='code-selection-actions';actions.hidden=true;
    const selectionLabel=document.createElement('span');
    let lesson: AlgeBenchLessonSpec | null | undefined, files: CodeFile[]=[], selected: CodeFile | undefined;
    let first=0,last=0,excerpt='',active: CompiledExpr|null=null;
    const targets=document.createElement('div');targets.className='code-step-targets';targets.hidden=true;
    const ask=makeAiAskButton('ai-ask-btn','Ask AI about selected code',()=>{
        if(!selected||!first)return null;
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex];
        return `Explain this selected code in the context of the current lesson. This source is displayed, not executed.\nFile: ${selected.path}\nLines: ${first}–${last}\nSelected text:\n${excerpt}\nCurrent scene: ${scene?.title??''}\nCurrent lesson step: ${state.currentStepIndex+1}\nScalar variables: ${JSON.stringify(Object.fromEntries(Object.entries(state.sceneSliders).filter(([,v])=>v.kind!=='tensor').map(([k,v])=>[k,v.value])))}`;
    });
    const jump=document.createElement('button');jump.type='button';jump.textContent='↗ Go to step';
    actions.append(selectionLabel,ask,jump);host.append(tree,title,body,actions,targets);
    function resolve(location: NonNullable<CodeFile['locations']>[number]) {
        const scenes=state.lessonSpec?.scenes??[];
        const scene=scenes.findIndex(s=>s.id===location.scene);
        const step=scenes[scene]?.steps?.findIndex(s=>s.id===location.step)??-1;
        return scene>=0&&step>=0 ? {scene,step,snapshot:location.snapshot,label:location.label??scenes[scene]?.steps?.[step]?.title??location.step} : null;
    }
    function choose(start: number,end: number,text: string) {
        first=start;last=end;excerpt=text;
        selectionLabel.textContent=start===end?`Line ${start}`:`Lines ${start}–${end}`;
        actions.hidden=false;targets.hidden=true;
        jump.disabled=!selected||!relatedLocations(selected,first,last).some(l=>resolve(l));
        jump.title=jump.disabled?'No linked lesson step for this selection':'Navigate only when you press this button';
        body.querySelectorAll<HTMLElement>('.code-line').forEach(row=>row.classList.toggle('selected',Number(row.dataset.line)>=first&&Number(row.dataset.line)<=last));
    }
    function go(choice: NonNullable<ReturnType<typeof resolve>>) {
        window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
        navigateTo(choice.scene,choice.step);
        const playback=(state.lessonSpec?.scenes?.[choice.scene] as Scene|undefined)?.stepPlayback;
        if(playback && choice.snapshot!==undefined){
            setSliderValue(playback.slider,choice.snapshot);
        }
    }
    jump.addEventListener('click',()=>{
        if(!selected)return;
        const choices=relatedLocations(selected,first,last).map(resolve).filter(v=>v!==null);
        if(choices.length===1){go(choices[0]!);return;} // length guard
        targets.replaceChildren();targets.hidden=false;
        for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=choice.label;button.onclick=()=>{targets.hidden=true;go(choice);};targets.append(button);}
    });
    function refreshBinding() {
        let line=0;
        if(active)try{line=Number(evalExpr(active,0));}catch{ /* unavailable slider or data clears the active marker */ }
        body.querySelectorAll<HTMLElement>('.code-line').forEach(row=>{
            const current=Number(row.dataset.line)===line;
            row.classList.toggle('execution-line',current);
            if(current)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');
        });
    }
    function open(file: CodeFile) {
        selected=file;first=last=0;excerpt='';actions.hidden=targets.hidden=true;active=null;
        title.textContent=file.path+' · read only';body.replaceChildren();
        if(file.activeLineExpr)try{active=compileExpr(file.activeLineExpr);}catch{/* invalid expressions leave source readable */}
        file.source.split('\n').forEach((text,i)=>{
            const row=document.createElement('div');row.className='code-line';row.dataset.line=String(i+1);
            const number=document.createElement('button');number.type='button';number.className='code-line-number';number.textContent=String(i+1);number.setAttribute('aria-label',`Select line ${i+1}`);
            number.onclick=()=>choose(i+1,i+1,text);
            const code=document.createElement('code');code.dataset.line=String(i+1);
            for(const segment of markedSegments(text,(file.marks??[]).filter(m=>m.line===i+1))){const span=document.createElement('span');span.textContent=segment.text;if(segment.color)span.className=`code-mark-${segment.color}`;code.append(span);}
            row.append(number,code);body.append(row);
        });
        tree.querySelectorAll<HTMLButtonElement>('[data-file]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.file===file.id)));
        refreshBinding();
    }
    body.addEventListener('mouseup',event=>{
        const selection=window.getSelection();
        const nodeElement=(n:Node|null)=>n instanceof Element?n:n?.parentElement;
        const a=nodeElement(selection?.anchorNode??null)?.closest<HTMLElement>('.code-line');
        const b=nodeElement(selection?.focusNode??null)?.closest<HTMLElement>('.code-line');
        if(selection&&!selection.isCollapsed&&a&&b&&body.contains(a)&&body.contains(b)){
            const x=Number(a.dataset.line),y=Number(b.dataset.line);choose(Math.min(x,y),Math.max(x,y),selection.toString());return;
        }
        const row=(event.target as HTMLElement).closest<HTMLElement>('.code-line');
        if(row){const n=Number(row.dataset.line);choose(n,n,selected?.source.split('\n')[n-1]??'');}
    });
    function build(node: FileTree,parent: HTMLElement) {
        for(const [name,folder] of [...node.folders].sort(([a],[b])=>a.localeCompare(b))){const details=document.createElement('details');details.open=true;const summary=document.createElement('summary');summary.textContent=name;details.append(summary);build(folder,details);parent.append(details);}
        for(const file of node.files){const button=document.createElement('button');button.type='button';button.textContent=file.path.split('/').pop()??file.path;button.dataset.file=file.id;button.title=file.path;button.onclick=()=>open(file);parent.append(button);}
    }
    function refresh() {
        if(lesson!==state.lessonSpec){
            lesson=state.lessonSpec;files=(lesson as LessonFormat|null)?.codeFiles??[];tree.replaceChildren();body.replaceChildren();actions.hidden=targets.hidden=true;
            selected=undefined;active=null;build(fileTree(files),tree);
            if(!files[0])title.textContent='This lesson has no code files.';
        }
        // Follow navigation to the file whose locations cite the current scene; otherwise keep the reader's choice.
        const sceneId=state.lessonSpec?.scenes?.[state.currentSceneIndex]?.id;
        const cited=files.find(f=>f.locations?.some(l=>l.scene===sceneId));
        const target=cited&&!selected?.locations?.some(l=>l.scene===sceneId)?cited:selected??files[0];
        if(target&&target!==selected)open(target);
        refreshBinding();
    }
    window.addEventListener('algebench:navchange',refresh);
    window.addEventListener('algebench:sliderchange',refreshBinding);
    refresh();
}
