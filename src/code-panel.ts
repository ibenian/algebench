import { setSliderValue } from '/sliders.js';
import { state } from '/state.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { makeAiAskButton } from '/labels.js';
import { navigateTo } from '/scene-loader.js';
import { fileTree, markedSegments, relatedLocations, activeCodeLines, lineActionsFor, resolveCodeRef } from '/code-panel-model.js';
import { setCodeFocus } from '/code-focus.js';
import { analyzeCode, lineReferences, setSymbolHover, hoveredSymbols, hoveredCodeLine, codeLineKey } from '/code-symbols.js';
import { labelsForSymbol } from '/labels.js';
import { showCodeSymbolTooltip } from '/label-tooltip.js';
import type { CodeReference } from '/code-symbols.js';
import type { CodeFile, FileTree } from '/code-panel-model.js';
import { highlightCode, lineTokens, paintTokens, wrapColumns } from '/code-highlight.js';
import type { LessonFormat, Scene } from '/types/lesson.js';

export function setupCodePanel(): void {
    const host=document.getElementById('dock-tab-code');
    if(!host)return;
    const tree=document.createElement('div');tree.className='code-file-tree';tree.setAttribute('aria-label','Code files');
    const title=document.createElement('div');title.className='code-file-title';
    const execution=document.createElement('div');execution.className='code-execution-status';execution.setAttribute('role','status');
    let lastExecution='';
    const body=document.createElement('div');body.className='code-source';body.setAttribute('aria-label','Source code');
    const actions=document.createElement('div');actions.className='code-selection-actions';actions.hidden=true;
    const selectionLabel=document.createElement('span');
    let lesson: AlgeBenchLessonSpec | null | undefined, files: CodeFile[]=[], selected: CodeFile | undefined;
    let first=0,last=0,excerpt='',active: CompiledExpr|null=null,followed: CodeFile | undefined;
    const compiled=new Map<string,CompiledExpr|null>();
    const targets=document.createElement('div');targets.className='code-step-targets';targets.hidden=true;
    const ask=makeAiAskButton('ai-ask-btn','Ask AI about selected code',()=>{
        if(!selected||!first)return null;
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex];
        return `Explain this selected code in the context of the current lesson. This source is displayed, not executed.\nFile: ${selected.path}\nLines: ${first}–${last}\nSelected text:\n${excerpt}\nCurrent scene: ${scene?.title??''}\nCurrent lesson step: ${state.currentStepIndex+1}\nScalar variables: ${JSON.stringify(Object.fromEntries(Object.entries(state.sceneSliders).filter(([,v])=>v.kind!=='tensor').map(([k,v])=>[k,v.value])))}`;
    });
    const jump=document.createElement('button');jump.type='button';jump.textContent='↗ Go to step';
    const what=document.createElement('span');what.className='code-line-actions';
    actions.append(selectionLabel,ask,jump,what);host.append(tree,title,execution,body,actions,targets);
    function renderLineActions() {
        what.replaceChildren();
        const scene=(state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined)?.id;
        if(!selected||!first)return;
        for(const action of lineActionsFor(selected,first,last,scene,id=>Object.hasOwn(state.sceneSliders,id))){
            const button=document.createElement('button');button.type='button';button.textContent=action.label;
            button.title='Sets '+Object.keys(action.set).join(', ')+' — the simulation replays deterministically with the new setting';
            button.onclick=()=>{
                window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
                // Evaluate every value against the current state before writing any of them.
                const values=Object.entries(action.set).map(([id,v])=>[id,typeof v==='string'?Number(evalExpr(compileExpr(v),0)):v] as const);
                for(const [id,value] of values)if(Number.isFinite(value))setSliderValue(id,value);
            };
            what.append(button);
        }
    }
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
        if(selected)setCodeFocus({fileId:selected.id,first,last});
        renderLineActions();
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
    function evaluate(expr: string) {
        if(!compiled.has(expr))try{compiled.set(expr,compileExpr(expr));}catch{compiled.set(expr,null);}
        const fn=compiled.get(expr);
        if(!fn)throw new Error('Invalid code expression.');
        return evalExpr(fn,0);
    }
    /**
     * A scene's codeRef names the file and line executing now: the panel follows that file when it changes
     * (or on scene entry) and marks the line only there. Scenes without one use the open file's activeLineExpr.
     */
    function refreshBinding(entering=false) {
        let lines=new Set<number>();
        // A step may override the scene's codeRef (a step playing its own data table).
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined;
        const ref=scene?.steps?.[state.currentStepIndex]?.codeRef??scene?.codeRef;
        if(ref){
            const target=resolveCodeRef(files,ref,evaluate);
            if(target&&(entering||target.file!==followed)&&target.file!==selected){followed=target.file;open(target.file);return;}
            followed=target?.file;
            if(target&&target.file===selected)lines=new Set([target.line]);
        }
        else if(active)try{lines=activeCodeLines(evalExpr(active,0));}catch{ /* unavailable slider or data clears the active marker */ }
        const bound=!!ref||!!active;
        const signature=[...lines].join(', ');
        execution.textContent=bound?(signature?'Active lines: '+signature:'No active lines at this position'):'';
        let firstActive:HTMLElement|undefined;
        body.querySelectorAll<HTMLElement>('.code-line').forEach(row=>{
            const current=lines.has(Number(row.dataset.line));
            if(current&&!firstActive)firstActive=row;
            row.classList.toggle('execution-line',current);
            if(current)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');
        });
        if(signature!==lastExecution&&firstActive&&body.clientHeight>0){
            const row=firstActive.getBoundingClientRect(),viewport=body.getBoundingClientRect();
            if(row.top<viewport.top||row.bottom>viewport.bottom)body.scrollTop+=row.top-viewport.top;
        }
        lastExecution=signature;
    }
    function open(file: CodeFile) {
        selected=file;lastExecution='';first=last=0;excerpt='';actions.hidden=targets.hidden=true;active=null;setCodeFocus(null);
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
        // Syntax colours arrive from the server; the file may have been switched meanwhile.
        void highlightCode(file).then(tokens=>{
            if(selected!==file||!tokens.length)return;
            body.querySelectorAll<HTMLElement>('.code-line code').forEach(code=>paintTokens(code,lineTokens(tokens,Number(code.dataset.line))));
        });
        tree.querySelectorAll<HTMLButtonElement>('[data-file]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.file===file.id)));
        refreshBinding();
        void analyzeCode(file).then(analysis=>{if(analysis&&selected===file)markSymbols(analysis.references);});
    }
    /** Wrap each variable reference in a span keyed by its expression; nested ones wrap inside their parents. */
    function markSymbols(references: CodeReference[]) {
        body.querySelectorAll<HTMLElement>('.code-line code').forEach(code=>{
            for(const ref of lineReferences(references,Number(code.dataset.line)))wrapRange(code,ref);
        });
        paintSymbolHover();
    }
    /** One variable reference: a `code-sym` span over its columns (wrapColumns splits whatever spans are there). */
    function wrapRange(code: HTMLElement, ref: CodeReference) {
        wrapColumns(code,ref.col,ref.endCol,()=>{
            const span=document.createElement('span');span.className='code-sym';
            span.dataset.key=ref.key;span.dataset.root=ref.root;span.dataset.kind=ref.kind;
            return span;
        });
    }
    /** LaTeX for what the visible labels say about a symbol, one line each; null when nothing shows it. */
    function symbolTex(key:string):string|null {
        const found=labelsForSymbol(key);
        if(!found.length)return null;
        const plain=(t:string)=>'\\text{'+t.replace(/[\\{}$&#%_^~]/g,c=>c==='\\'?'\\backslash ':'\\'+c)+'}';
        return found.map(f=>f.tooltip||plain(f.text)).join('\\\\');
    }
    function paintSymbolHover() {
        const keys=hoveredSymbols(),line=hoveredCodeLine();
        body.querySelectorAll<HTMLElement>('.code-sym').forEach(span=>span.classList.toggle('code-sym-hover',keys.includes(span.dataset.key!)));
        body.querySelectorAll<HTMLElement>('.code-line').forEach(row=>row.classList.toggle('code-line-ref-hover',!!selected&&line===codeLineKey(selected.id,Number(row.dataset.line))));
    }
    // Pointing at a variable lights every occurrence of it here and every row in the view that names it;
    // pointing elsewhere on a line lights the rows whose codeRef is that line.
    body.addEventListener('pointerover',event=>{
        const target=event.target as HTMLElement;
        const span=target.closest<HTMLElement>('.code-sym');
        const row=target.closest<HTMLElement>('.code-line');
        if(span)setSymbolHover([span.dataset.key!]);
        else setSymbolHover([],row&&selected?codeLineKey(selected.id,Number(row.dataset.line)):null);
        // What the scene shows for this symbol, as a KaTeX tooltip: a label's formula, else its value.
        showCodeSymbolTooltip(span,span?symbolTex(span.dataset.key!):null);
    });
    body.addEventListener('pointerleave',()=>showCodeSymbolTooltip(null,null));
    body.addEventListener('pointerleave',()=>setSymbolHover([]));
    window.addEventListener('algebench:symbolhover',paintSymbolHover);
    // A value that changed lights its variable where it is executing, after this step's line is marked.
    window.addEventListener('algebench:symbolflash',event=>{
        const keys=(event as CustomEvent<{keys:string[]}>).detail.keys;
        requestAnimationFrame(()=>{
            body.querySelectorAll<HTMLElement>('.code-line.execution-line .code-sym').forEach(span=>{
                // An exact match, or an element of the changed variable (answer[j]); not a method call (stack.pop).
                if(!keys.includes(span.dataset.key!)&&!(keys.includes(span.dataset.root!)&&span.dataset.kind==='subscript'))return;
                // A timer, not an animation, ends the flash: the light holds a moment, then fades by transition.
                span.classList.add('code-sym-flash');
                clearTimeout(Number(span.dataset.flash));
                span.dataset.flash=String(setTimeout(()=>span.classList.remove('code-sym-flash'),900));
            });
        });
    });
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
            selected=followed=undefined;active=null;compiled.clear();setCodeFocus(null);build(fileTree(files),tree);
            if(files[0])open(files[0]);else title.textContent='This lesson has no code files.';
        }
        refreshBinding(true);
        // Scene and step changes add or remove sliders, so the selected line's actions must be re-evaluated.
        renderLineActions();
    }
    window.addEventListener('algebench:opencode', event => {
        // select: false only reveals the line. Caption links point at the line that is executing now, which
        // is already highlighted; selecting it too would leave a stale selection behind as playback moves on.
        const target = (event as CustomEvent<{fileId: string; line: number; select?: boolean}>).detail;
        refresh();
        const file = files.find(file => file.id === target?.fileId);
        if (!file || !Number.isInteger(target.line) || target.line < 1 || target.line > file.source.split('\n').length) return;
        window.dispatchEvent(new CustomEvent('algebench:playbackpause'));
        document.querySelector<HTMLButtonElement>('.dock-tab[data-dock-tab="code"]')?.click();
        open(file);
        if (target.select !== false) choose(target.line, target.line, file.source.split('\n')[target.line - 1]!); // bounds checked above
        const row = body.querySelector<HTMLElement>(`[data-line="${target.line}"]`);
        if (row) {
            const rect = row.getBoundingClientRect(), viewport = body.getBoundingClientRect();
            body.scrollTop += rect.top - viewport.top - Math.max(0, (viewport.height - rect.height) / 2);
            // Focus follows a selection; a revealed (unselected) line keeps no focus ring behind.
            if (target.select !== false) row.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
        }
    });
    window.addEventListener('algebench:navchange',refresh);
    window.addEventListener('algebench:sliderchange',()=>refreshBinding());
    refresh();
}
