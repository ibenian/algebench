import { setSliderValue } from '/sliders.js';
import { state } from '/state.js';
import { compileExpr, evalExpr } from '/expr.js';
import type { CompiledExpr } from '/expr.js';
import { makeAiAskButton, sendAiPrompt } from '/labels.js';
import { navigateTo } from '/scene-loader.js';
import { fileTree, markedSegments, relatedLocations, activeCodeLines, lineActionsFor, resolveCodeRef } from '/code-panel-model.js';
import { setCodeFocus } from '/code-focus.js';
import { analyzeCode, lineReferences, setSymbolHover, hoveredSymbols, hoveredCodeLine, codeLineKey, symbolValues, rowSymbolKeys } from '/code-symbols.js';
import { labelsForSymbol, labelsForCodeLine } from '/labels.js';
import { showCodeSymbolTooltip } from '/label-tooltip.js';
import type { CodeReference, CodeFunction, CodeCall } from '/code-symbols.js';
import type { CodeFile, FileTree } from '/code-panel-model.js';
import { highlightCode, lineTokens, paintTokens, wrapColumns } from '/code-highlight.js';
import { CODE_PROMPTS, codePromptMessage } from '/code-prompts.js';
import { menuPlacement } from '/menu-placement.js';
import { lineJump, jumpArrowPath, waitingCalls, callArrowPath, JUMP_HOLD_MS, lineTransitions, movesAt } from '/code-jump.js';
import type { LessonFormat, Scene } from '/types/lesson.js';

/** Where the gutter's arrows meet the line numbers (px from the panel's left edge). */
const GUTTER_X=37;

export function setupCodePanel(): void {
    const host=document.getElementById('dock-tab-code');
    if(!host)return;
    const tree=document.createElement('div');tree.className='code-file-tree';tree.setAttribute('aria-label','Code files');
    const title=document.createElement('div');title.className='code-file-title';
    const titleText=document.createElement('span');titleText.className='code-file-path';
    const execution=document.createElement('div');execution.className='code-execution-status';execution.setAttribute('role','status');
    let lastExecution='',lastLines=new Set<number>(),lastPlace='';
    const body=document.createElement('div');body.className='code-source';body.setAttribute('aria-label','Source code');
    const actions=document.createElement('div');actions.className='code-selection-actions';actions.hidden=true;
    const selectionLabel=document.createElement('span');
    let lesson: AlgeBenchLessonSpec | null | undefined, files: CodeFile[]=[], selected: CodeFile | undefined;
    let first=0,last=0,excerpt='',active: CompiledExpr|null=null,followed: CodeFile | undefined;
    let references: CodeReference[]=[];
    const settings=loadSettings();
    const compiled=new Map<string,CompiledExpr|null>();
    const targets=document.createElement('div');targets.className='code-step-targets';targets.hidden=true;
    const ask=makeAiAskButton('ai-ask-btn','Ask AI about selected code',()=>{
        if(!selected||!first)return null;
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex];
        return `Explain this selected code in the context of the current lesson. This source is displayed, not executed.\nFile: ${selected.path}\nLines: ${first}–${last}\nSelected text:\n${excerpt}\nCurrent scene: ${scene?.title??''}\nCurrent lesson step: ${state.currentStepIndex+1}\nScalar variables: ${JSON.stringify(Object.fromEntries(Object.entries(state.sceneSliders).filter(([,v])=>v.kind!=='tensor').map(([k,v])=>[k,v.value])))}`;
    });
    const jump=document.createElement('button');jump.type='button';jump.textContent='↗ Go to step';
    const what=document.createElement('span');what.className='code-line-actions';
    title.append(titleText,viewSettingsMenu());
    actions.append(selectionLabel,ask,jump,what,codePromptsMenu());host.append(tree,title,execution,body,actions,targets);
    /**
     * "⋯": prompts that analyze the selected code (code-prompts.ts), in a menu that opens upward. They are sent
     * silently: the request carries the whole file and state, so only the tutor's reply shows in the chat.
     */
    function codePromptsMenu() {
        const wrap=document.createElement('span');wrap.className='preset-more code-prompts';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='code-prompts-btn';toggle.textContent='⋯';
        toggle.title='Ask AI to analyze this code';toggle.setAttribute('aria-label','More AI prompts about this code');
        toggle.setAttribute('aria-haspopup','menu');toggle.setAttribute('aria-expanded','false');
        const menu=document.createElement('div');menu.className='preset-more-menu';menu.setAttribute('role','menu');menu.hidden=true;
        const close=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
        const outside=(e:Event)=>{if(!wrap.contains(e.target as Node))close();};
        const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();toggle.focus();}};
        for(const prompt of CODE_PROMPTS){
            const item=document.createElement('button');item.type='button';item.className='preset-more-item';item.setAttribute('role','menuitem');
            item.textContent=prompt.label;item.title=prompt.prompt+'\n\nClick to send · ⌘/Ctrl-click to edit';
            item.addEventListener('click',e=>{close();const message=codeMessage(prompt);if(message)sendAiPrompt(message,e,{silent:true});});
            menu.append(item);
        }
        toggle.addEventListener('click',()=>{
            if(!menu.hidden){close();return;}
            menu.hidden=false;menu.style.left='0px';menu.style.maxWidth='';
            const bounds=(wrap.closest('.tab-content, #dock-tab-code')??document.documentElement).getBoundingClientRect();
            const {offset,maxWidth}=menuPlacement(wrap.getBoundingClientRect().left,menu.getBoundingClientRect().width,Math.max(0,bounds.left),Math.min(bounds.right,document.documentElement.clientWidth));
            menu.style.maxWidth=`${maxWidth}px`;menu.style.left=`${offset}px`;
            toggle.setAttribute('aria-expanded','true');
            document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
            menu.querySelector<HTMLButtonElement>('button')?.focus();
        });
        wrap.append(toggle,menu);
        return wrap;
    }
    function codeMessage(prompt: typeof CODE_PROMPTS[number]) {
        if(!selected||!first)return null;
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex];
        return codePromptMessage(prompt,{path:selected.path,source:selected.source,first,last,excerpt,executing:[...lastLines],waitingCalls:shownCalls,
            scene:scene?.title??'',step:state.currentStepIndex+1,
            values:Object.fromEntries(Object.entries(state.sceneSliders).filter(([,v])=>v.kind!=='tensor').map(([k,v])=>[k,v.value]))});
    }
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
        let calls:number[]=[],entry:number|undefined;
        if(ref){
            const target=resolveCodeRef(files,ref,evaluate);
            if(target&&(entering||target.file!==followed)&&target.file!==selected){followed=target.file;open(target.file);return;}
            followed=target?.file;
            if(target&&target.file===selected){
                lines=new Set([target.line]);
                runMoves(scene!,ref);
                if(ref.callsExpr&&ref.callEntryLine){entry=ref.callEntryLine;try{calls=waitingCalls(evaluate(ref.callsExpr),target.file.source.split('\n').length);}catch{/* no stack at this position */}}
            }
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
        // Only a move within one run is a jump: going to another step or scene starts afresh. The arrow is the run's
        // own step into this state (trace[state - 1] → trace[state]), whichever way or how far the reader moved.
        const place=`${state.currentSceneIndex}/${state.currentStepIndex}`;
        const changed=place===lastPlace&&lineJump(lastLines,lines)!==null;
        drawArrows(changed?stepInto():null,calls,entry);
        lastLines=lines;lastPlace=place;
        scheduleInline();
    }
    /** The run's step into the current state: from the line at the previous state to the current one, or null. */
    function stepInto():{from:number;to:number}|null {
        const slider=runSlider?state.sceneSliders[runSlider.id]:undefined;
        const at=runSlider&&slider?Math.round((Number(slider.value)-runSlider.min)/runSlider.step):0;
        const from=runLines[at-1],to=runLines[at];
        return at>0&&from!==undefined&&to!==undefined&&from!==to?{from,to}:null;
    }
    /**
     * The gutter's arrows: each call still waiting to return keeps one from its call site to the entry line,
     * and a move of the executing line gets one that fades after a moment, with both line numbers lit.
     */
    /**
     * Every move between lines in the step's whole run, for the hover arrows: the slider the codeRef's line follows
     * is replayed over its range (with the slider overridden, not moved). Cached per scene, step and codeRef.
     */
    let moves:{from:number;to:number}[]=[],movesKey='',runLines:number[]=[],runSlider:{id:string;min:number;step:number}|null=null;
    function runMoves(scene: Scene, ref: NonNullable<Scene['codeRef']>) {
        const key=`${state.currentSceneIndex}/${state.currentStepIndex}/${ref.lineExpr??ref.line}`;
        if(key===movesKey)return;
        movesKey=key;moves=[];runLines=[];runSlider=null;
        if(!ref.lineExpr)return;
        // The current step's own sliders first: a later step may reuse the id over a different range.
        const steps=scene.steps??[],own=steps[state.currentStepIndex];
        const sliders=[...(own?.sliders??[]),...steps.flatMap(step=>step.sliders??[])] as {id?:string;min?:number;max?:number;step?:number}[];
        const slider=sliders.find(s=>s.id&&new RegExp(`\\b${s.id}\\b`).test(ref.lineExpr!));
        if(!slider?.id||slider.min===undefined||slider.max===undefined)return;
        let fn:CompiledExpr;try{fn=compileExpr(ref.lineExpr);}catch{return;}
        const step=slider.step&&slider.step>0?slider.step:1,sequence:number[]=[];
        for(let v=slider.min,i=0;v<=slider.max&&i<5000;v+=step,i++){
            try{const line=evalExpr(fn,0,{overrideScope:{[slider.id]:v}});if(typeof line==='number')sequence.push(line);}catch{/* a position the expression cannot read */}
        }
        moves=lineTransitions(sequence);runLines=sequence;runSlider={id:slider.id,min:slider.min,step};
    }
    /**
     * Hovering the code shows the step that led to the current state: from the line at the previous state to the
     * current one, in the run's own order; hovering a line's number shows every move into it (teal) and out of it
     * (gold) across the run. Hovering a call's name
     * instead links it to its function: the def's name lights and an outgoing arrow runs to it; hovering a def's
     * name lights every call to it, with an incoming arrow from each.
     */
    function drawHover(target:HTMLElement|null) {
        body.querySelectorAll('.code-link-lit').forEach(n=>n.classList.remove('code-link-lit'));
        if(!arrows)return;
        arrows.querySelectorAll('.code-arrow-in, .code-arrow-out').forEach(p=>p.remove());
        const row=target?.closest<HTMLElement>('.code-line');
        if(!target||!row)return;
        const line=Number(row.dataset.line),call=target.closest<HTMLElement>('.code-call'),fn=target.closest<HTMLElement>('.code-fn');
        const rowY=(l:number)=>{const r=body.querySelector<HTMLElement>(`.code-line[data-line="${l}"]`);return r?r.offsetTop+r.offsetHeight/2:null;};
        let incoming:{from:number;to:number}[]=[],outgoing:{from:number;to:number}[]=[];
        if(call){
            const def=Number(call.dataset.def);
            call.classList.add('code-link-lit');body.querySelector(`.code-fn[data-def="${def}"]`)?.classList.add('code-link-lit');
            if(def!==line)outgoing=[{from:line,to:def}];
        } else if(fn){
            const def=Number(fn.dataset.def);fn.classList.add('code-link-lit');
            body.querySelectorAll<HTMLElement>(`.code-call[data-def="${def}"]`).forEach(c=>{
                c.classList.add('code-link-lit');
                const from=Number(c.closest<HTMLElement>('.code-line')!.dataset.line);
                if(from!==def&&!incoming.some(m=>m.from===from))incoming.push({from,to:def});
            });
        } else if(target.closest('.code-line-number'))({incoming,outgoing}=movesAt(moves,line));
        else {
            // The step into the current state, in the run's own order: trace[state - 1] → trace[state].
            const step=stepInto();
            if(step)incoming=[step];
        }
        for(const [list,kind] of [[incoming,'in'],[outgoing,'out']] as const)for(const m of list){
            const y1=rowY(m.from),y2=rowY(m.to);if(y1===null||y2===null)continue;
            const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class',`code-arrow-${kind}`);
            path.setAttribute('d',jumpArrowPath(GUTTER_X,y1,y2));path.setAttribute('marker-end',`url(#code-arrow-${kind})`);arrows.append(path);
        }
    }
    body.addEventListener('pointerover',event=>drawHover(event.target as HTMLElement));
    body.addEventListener('pointerleave',()=>drawHover(null));
    let arrows: SVGSVGElement|null=null,fade=0,shownCalls:number[]=[],shownEntry:number|undefined;
    // Rows have no position while the Code tab is hidden: lay the waiting calls' arrows out again once it shows.
    new ResizeObserver(()=>{if(body.clientHeight>0)drawArrows(null,shownCalls,shownEntry);}).observe(body);
    function drawArrows(jump:{from:number;to:number}|null, calls:number[], entry:number|undefined) {
        const called=calls.length>shownCalls.length;
        shownCalls=calls;shownEntry=entry;
        if(body.clientHeight===0)return;
        const rowY=(line:number)=>{const row=body.querySelector<HTMLElement>(`.code-line[data-line="${line}"]`);return row?row.offsetTop+row.offsetHeight/2:null;};
        if(!arrows||!arrows.isConnected){
            arrows=document.createElementNS('http://www.w3.org/2000/svg','svg');arrows.classList.add('code-arrows');arrows.setAttribute('aria-hidden','true');
            arrows.innerHTML='<defs><marker id="code-arrow-jump" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L6,3 L0,6 z"/></marker>'
                +['call','in','out'].map(k=>`<marker id="code-arrow-${k}" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L6,3 L0,6 z"/></marker>`).join('')+'</defs>';
            body.prepend(arrows);
        }
        arrows.style.height=`${body.scrollHeight}px`;
        const x=GUTTER_X,svg='http://www.w3.org/2000/svg';
        arrows.querySelectorAll('.code-arrow-call').forEach(p=>p.remove());
        body.querySelectorAll('.code-line-number.calling').forEach(n=>n.classList.remove('calling'));
        const to=entry===undefined?null:rowY(entry);
        calls.forEach((line,depth)=>{
            const from=rowY(line);if(from===null||to===null)return;
            const path=document.createElementNS(svg,'path');path.setAttribute('class','code-arrow-call');path.setAttribute('d',callArrowPath(x,from,to,depth));path.setAttribute('marker-end','url(#code-arrow-call)');
            arrows!.append(path);
            body.querySelector(`.code-line[data-line="${line}"] .code-line-number`)?.classList.add('calling');
        });
        // A move that makes a call is drawn by that call's own arrow.
        if(!jump||called)return;
        const y1=rowY(jump.from),y2=rowY(jump.to);if(y1===null||y2===null)return;
        arrows.querySelectorAll('.code-arrow-jump').forEach(p=>p.remove());
        body.querySelectorAll('.code-line-number.jump-lit').forEach(n=>n.classList.remove('jump-lit'));
        const path=document.createElementNS(svg,'path');path.setAttribute('class','code-arrow-jump');path.setAttribute('d',jumpArrowPath(x,y1,y2));path.setAttribute('marker-end','url(#code-arrow-jump)');path.setAttribute('pathLength','1');
        arrows.append(path);
        const numbers=[jump.from,jump.to].map(l=>body.querySelector(`.code-line[data-line="${l}"] .code-line-number`)).filter((n):n is Element=>!!n);
        numbers.forEach(n=>n.classList.add('jump-lit'));
        clearTimeout(fade);
        fade=window.setTimeout(()=>{path.classList.add('fading');numbers.forEach(n=>n.classList.remove('jump-lit'));setTimeout(()=>path.remove(),400);},JUMP_HOLD_MS);
    }
    /** View settings ("⚙", top right): inline values on or off, and which variables show them. Kept per browser. */
    type ViewSettings={inline:boolean;onHover:boolean;hidden:string[]};
    function loadSettings():ViewSettings {
        try{
            const saved=JSON.parse(localStorage.getItem('algebench-code-view')??'null') as Partial<ViewSettings>|null;
            return {inline:saved?.inline??true,onHover:saved?.onHover??true,hidden:Array.isArray(saved?.hidden)?saved.hidden.filter(h=>typeof h==='string'):[]};
        }catch{return {inline:true,onHover:true,hidden:[]};}
    }
    function saveSettings() {
        try{localStorage.setItem('algebench-code-view',JSON.stringify(settings));}catch{/* private mode: settings last the session */}
    }
    function viewSettingsMenu() {
        const wrap=document.createElement('span');wrap.className='code-view-settings';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='code-view-settings-btn';toggle.textContent='⚙';
        toggle.title='Code view settings';toggle.setAttribute('aria-label','Code view settings');
        toggle.setAttribute('aria-haspopup','true');toggle.setAttribute('aria-expanded','false');
        const menu=document.createElement('div');menu.className='code-view-menu';menu.hidden=true;
        const close=()=>{menu.hidden=true;toggle.setAttribute('aria-expanded','false');document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
        const outside=(e:Event)=>{if(!wrap.contains(e.target as Node))close();};
        const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){close();toggle.focus();}};
        const check=(text:string,on:boolean,change:(on:boolean)=>void,disabled=false)=>{
            const label=document.createElement('label');label.className='code-view-option';
            const box=document.createElement('input');box.type='checkbox';box.checked=on;box.disabled=disabled;
            box.addEventListener('change',()=>{change(box.checked);saveSettings();renderInline();fill();});
            const name=document.createElement('span');name.textContent=text;
            label.append(box,name);
            return label;
        };
        // Built on each open: the variables are the ones this file names that the scene shows a value for now.
        function fill() {
            menu.replaceChildren(check('Inline values',settings.inline,on=>{settings.inline=on;}),
                check('Only on the hovered line',settings.onHover,on=>{settings.onHover=on;},!settings.inline));
            const vars=availableVariables();
            const heading=document.createElement('div');heading.className='code-view-heading';
            heading.textContent=vars.length?'Variables':'No variables shown at this step';
            menu.append(heading);
            const toggleHidden=(key:string)=>(on:boolean)=>{settings.hidden=on?settings.hidden.filter(h=>h!==key):[...settings.hidden,key];};
            for(const key of vars)menu.append(check(key,!settings.hidden.includes(key),toggleHidden(key),!settings.inline));
            const exprs=availableExpressions();
            if(exprs.length){
                const sub=document.createElement('div');sub.className='code-view-heading';sub.textContent='Expressions';menu.append(sub);
                for(const name of exprs)menu.append(check(name,!settings.hidden.includes(EXPR+name),toggleHidden(EXPR+name),!settings.inline));
            }
        }
        toggle.addEventListener('click',()=>{
            if(!menu.hidden){close();return;}
            fill();menu.hidden=false;toggle.setAttribute('aria-expanded','true');
            document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
            menu.querySelector<HTMLInputElement>('input')?.focus();
        });
        wrap.append(toggle,menu);
        return wrap;
    }
    /** What the scene says about a variable: its label rows (`v = 3`) and the objects holding it (`state = [1, 2]`). */
    function valueTexts(key:string):string[] {
        return [...labelsForSymbol(key).map(f=>f.text),...symbolValues(key).map(v=>`${key} = ${v}`)]
            .filter(t=>!t.trim().endsWith('—'));
    }
    /**
     * Expressions: label rows tied to a line by codeRef that are not a plain `name = value` row (`taken < n: …`,
     * `check: …`, `len(queue) = 0`). Their text changes every frame, so each is named by what precedes its value.
     */
    const EXPR='expr:';
    /** Unchecking a variable hides it and its elements and attributes (`state` hides `state[3]`). */
    const hiddenKey=(key:string)=>settings.hidden.includes(key)||settings.hidden.includes(key.split(/[[.]/)[0]!);
    const isExpression=(text:string)=>!rowSymbolKeys(text).length;
    const expressionName=(text:string)=>text.split(/: | = /)[0]!.trim();
    function lineExpressions(fileId:string,line:number):string[] {
        // `v: —` is a variable with no value yet, not an expression.
        return labelsForCodeLine(fileId,line).filter(t=>isExpression(t)&&!t.trim().endsWith('—'));
    }
    /** The expressions the scene shows for the lines in view, in line order. */
    function availableExpressions():string[] {
        if(!selected)return [];
        const scope=inlineScope(selected.source,lastLines),names:string[]=[];
        const count=selected.source.split('\n').length;
        for(let line=scope?.from??1;line<=(scope?.to??count);line++)
            for(const text of lineExpressions(selected.id,line))if(!names.includes(expressionName(text)))names.push(expressionName(text));
        return names;
    }
    /** The variables the open file names that the scene shows a value for, in order of first appearance. */
    function availableVariables():string[] {
        const keys:string[]=[];
        for(const ref of [...references].sort((a,b)=>a.line-b.line||a.col-b.col))if(!keys.includes(ref.key)&&valueTexts(ref.key).length)keys.push(ref.key);
        return keys;
    }
    /**
     * Inline values: right of each line, a tag for every value the scene shows for what the line names, then the
     * label rows tied to the line by codeRef (conditions and other expressions). A tag too long for its room is
     * cut with an ellipsis and floats out in full while pointed at.
     */
    let inlinePending=false;
    function scheduleInline() {
        // Labels and arrays take a new state on the next frame; read them after it.
        if(inlinePending)return;inlinePending=true;
        requestAnimationFrame(()=>requestAnimationFrame(()=>{inlinePending=false;renderInline();}));
    }
    /**
     * The lines whose names mean what the scene shows: the top-level block (def or class) holding the executing
     * line. Another function's `u` is a different variable. Null (every line) when nothing is executing.
     */
    function inlineScope(source:string,executing:Set<number>):{from:number;to:number}|null {
        const at=Math.min(...executing);
        if(!Number.isFinite(at))return null;
        const lines=source.split('\n'),top=(i:number)=>/^\S/.test(lines[i-1]??'');
        let from=at;while(from>1&&!top(from))from--;
        let to=at+1;while(to<=lines.length&&!top(to))to++;
        return {from,to:to-1};
    }
    // A pointed-at line that does not fit (its code or tags running past the code view's edge, or a tag cut short)
    // shows in full here, code and tags on one line fixed over the page: the code view scrolls, so it would clip it.
    const float=document.createElement('div');float.className='code-inline-float';float.hidden=true;document.body.append(float);
    let floated:HTMLElement|null=null;
    function floatLine(row:HTMLElement|null) {
        const code=row?.querySelector<HTMLElement>('code')??null;
        const holder=row?.querySelector<HTMLElement>('.code-inline-values')??null;
        const shown=!!holder&&getComputedStyle(holder).visibility!=='hidden';
        const tags=shown?[...holder!.querySelectorAll<HTMLElement>('.code-inline-value')]:[];
        const edge=body.getBoundingClientRect().right;
        const clipped=!!code&&(code.getBoundingClientRect().right>edge||tags.some(t=>t.scrollWidth>t.clientWidth||t.getBoundingClientRect().right>edge));
        if(!clipped){float.hidden=true;floated=null;return;}
        if(floated===row&&!float.hidden)return;
        floated=row;
        const line=document.createElement('code');line.className='code-inline-float-code';
        line.append(...[...code!.childNodes].map(n=>n.cloneNode(true)));
        float.replaceChildren(line,...tags.map(t=>{const copy=document.createElement('span');copy.className=t.className;copy.textContent=t.textContent;return copy;}));
        float.classList.toggle('executing',!!row?.classList.contains('execution-line'));
        float.hidden=false;
        const at=code!.getBoundingClientRect(),width=float.getBoundingClientRect().width;
        // Over the line's code, moved left as far as it takes to stay inside the window.
        float.style.left=`${Math.max(8,Math.min(at.left-4,window.innerWidth-8-width))}px`;
        float.style.top=`${at.top+at.height/2}px`;
    }
    body.addEventListener('pointerover',event=>floatLine((event.target as HTMLElement).closest<HTMLElement>('.code-line')));
    body.addEventListener('pointerleave',()=>floatLine(null));
    body.addEventListener('scroll',()=>floatLine(null));
    function renderInline() {
        const hovered=floated;floatLine(null);
        body.querySelectorAll('.code-inline-values').forEach(n=>n.remove());
        // On hover: every line gets its tags, shown only while the line is pointed at (style.css).
        body.classList.toggle('code-inline-on-hover',settings.onHover);
        if(!settings.inline||!selected)return;
        const file=selected,scope=inlineScope(file.source,lastLines);
        body.querySelectorAll<HTMLElement>('.code-line').forEach(row=>{
            const line=Number(row.dataset.line),texts:string[]=[];
            if(scope&&(line<scope.from||line>scope.to))return;
            const add=(t:string)=>{if(!t.trim().endsWith('—')&&!texts.includes(t))texts.push(t);};
            for(const ref of lineReferences(references,line))if(!hiddenKey(ref.key))valueTexts(ref.key).forEach(add);
            labelsForCodeLine(file.id,line).filter(t=>isExpression(t)
                ?!settings.hidden.includes(EXPR+expressionName(t))
                :!rowSymbolKeys(t).some(hiddenKey)).forEach(add);
            if(!texts.length)return;
            const holder=document.createElement('span');holder.className='code-inline-values';
            for(const text of texts){
                const tag=document.createElement('span');tag.className='code-inline-value';
                const inner=document.createElement('span');inner.textContent=text;
                tag.append(inner);holder.append(tag);
            }
            row.append(holder);
        });
        // Values changed under the pointer: show the line's new ones.
        if(hovered?.isConnected&&hovered.matches(':hover'))floatLine(hovered);
    }
    function open(file: CodeFile) {
        selected=file;references=[];lastExecution='';lastLines=new Set();first=last=0;excerpt='';actions.hidden=targets.hidden=true;active=null;setCodeFocus(null);
        titleText.textContent=file.path+' · read only';body.replaceChildren();
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
        void analyzeCode(file).then(analysis=>{if(analysis&&selected===file){markSymbols(analysis.references);markCalls(analysis.functions??[],analysis.calls??[]);}});
    }
    /** Wrap each variable reference in a span keyed by its expression; nested ones wrap inside their parents. */
    function markSymbols(found: CodeReference[]) {
        references=found;
        body.querySelectorAll<HTMLElement>('.code-line code').forEach(code=>{
            for(const ref of lineReferences(references,Number(code.dataset.line)))wrapRange(code,ref);
        });
        paintSymbolHover();
        scheduleInline();
    }
    /** Wrap each def's name and each call to it, so pointing at either links the two (see drawHover). */
    function markCalls(functions: CodeFunction[], calls: CodeCall[]) {
        const wrap=(f:CodeFunction,cls:string,def:number)=>{
            const code=body.querySelector<HTMLElement>(`.code-line[data-line="${f.line}"] code`);
            if(code)wrapColumns(code,f.col,f.endCol,()=>{const span=document.createElement('span');span.className=cls;span.dataset.def=String(def);return span;});
        };
        for(const f of functions)wrap(f,'code-fn',f.line);
        for(const c of calls)wrap(c,'code-call',c.defLine);
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
        // Two labels saying the same thing (a row and a marker) show once.
        return [...new Set(found.map(f=>f.tooltip||plain(f.text)))].join('\\\\');
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
            if(files[0])open(files[0]);else titleText.textContent='This lesson has no code files.';
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
