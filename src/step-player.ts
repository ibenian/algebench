/** Generic discrete state playback. It writes a slider; views bind to its data. */
import { state } from '/state.js';
import { setSliderValue } from '/sliders.js';
import { updateStepCaption } from '/overlay.js';
import { createNarrator } from '/state-narrator.js';
import type { Scene, StepPlayback } from '/types/lesson.js';

/** The player shows the slider's own value over its maximum ("0 / 36"), so the counter
 *  agrees with captions and views that read the slider (Tick 0 is "0 / 36", not "1 / 37"). */
export function playbackPosition(value: number, min: number, max: number) {
    const current=Math.max(min,Math.min(max,Math.round(value)));
    return {current,total:max-min+1,display:`${current} / ${max}`};
}

export function setupStepPlayer(): void {
    const wrapper=document.getElementById('mathbox-wrapper');
    if(!wrapper)return;
    const host=wrapper;
    const bar=document.createElement('div');bar.id='state-player';bar.hidden=true;
    bar.setAttribute('role','group');bar.setAttribute('aria-label','Execution state player');
    const previous=document.createElement('button'),play=document.createElement('button'),next=document.createElement('button');
    // Vector icons keep transport controls consistent across fonts and zoom levels.
    const icon=(path:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style="display:block;margin:auto"><path d="${path}"/></svg>`;
    const playIcon=icon('M7 4v16l13-8z');
    const pauseIcon=icon('M6 4h4v16H6z M14 4h4v16h-4z');
    previous.innerHTML=icon('M17 4v16L4 12z');next.innerHTML=playIcon;
    previous.setAttribute('aria-label','Previous execution state');next.setAttribute('aria-label','Next execution state');
    // Player buttons show a styled tip above them (data-tip), quicker and more visible than a native title.
    previous.dataset.tip='Previous state';next.dataset.tip='Next state';
    for(const button of [previous,play,next])button.type='button';
    const track=document.createElement('input');track.type='range';track.step='1';track.setAttribute('aria-label','Execution state');
    const counter=document.createElement('output');counter.setAttribute('aria-label','Execution position');
    // Optional speed selector: multiplies the authored interval; the choice persists across scenes.
    const speed=document.createElement('select');speed.className='state-player-speed';speed.setAttribute('aria-label','Playback speed');
    for(const factor of [0.25,0.5,1,2,4]){const option=document.createElement('option');option.value=String(factor);option.textContent=factor+'×';speed.append(option);}
    speed.value='1';speed.hidden=true;
    // Narration: the tutor explains each state in one short sentence as the learner moves (state-narrator.ts).
    const narrate=document.createElement('button');narrate.type='button';narrate.className='state-player-narrate';
    narrate.innerHTML=icon('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z');
    const paintNarrate=()=>{
        narrate.setAttribute('aria-pressed',String(narrator.on));
        narrate.setAttribute('aria-label',narrator.on?'Stop narrating each state':'Narrate each state');
        narrate.dataset.tip=narrator.on?'Narrating each state · click to stop':'Narrate each state: the tutor explains it in one sentence as you move';
    };
    bar.append(previous,play,next,track,counter,speed,narrate);host.append(bar);
    // Reserve the actual player height for legends, including responsive wrapping.
    // ResizeObserver runs on geometry changes, not on animation frames.
    const resizeObserver=new ResizeObserver(()=>{
        host.style.setProperty('--state-player-h',`${bar.offsetHeight}px`);
    });
    resizeObserver.observe(bar);
    let timer:ReturnType<typeof setTimeout>|null=null;
    let config:StepPlayback|undefined;
    const slider=()=>config?state.sceneSliders[config.slider]:undefined;
    const narrator=createNarrator(()=>{
        const s=slider();
        return s&&!bar.hidden?`${state.currentSceneIndex}/${state.currentStepIndex}:${playbackPosition(s.value,s.min,s.max).current}`:null;
    },()=>{
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined;
        const step=scene?.steps?.[state.currentStepIndex];
        const s=slider();
        return `scene "${scene?.title??''}"${step?.title?`, step "${step.title}"`:''}${s?`, execution state ${playbackPosition(s.value,s.min,s.max).display}`:''}`;
    });
    narrate.onclick=()=>{narrator.set(!narrator.on);paintNarrate();};
    // Narration speaks for itself: the Chat tab's welcome stays quiet while it is on.
    window.algebenchNarrating=()=>narrator.on;
    paintNarrate();
    const interval=()=>(config?.intervalMs??900)/Number(speed.value||1);
    function pause(){if(timer!==null)clearTimeout(timer);timer=null;play.innerHTML=playIcon;play.setAttribute('aria-label','Play execution');play.dataset.tip='Play';}
    function render(){
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined;
        if(scene?.steps?.[state.currentStepIndex]?.descriptionExpr)updateStepCaption(scene,state.currentStepIndex,true);
        const s=slider();
        if(!s||s.kind==='tensor'||!Number.isInteger(s.min)||!Number.isInteger(s.max)){pause();bar.hidden=true;host.classList.remove('has-state-player');return;}
        bar.hidden=false;
        host.classList.add('has-state-player');
        const p=playbackPosition(s.value,s.min,s.max);
        track.min=String(s.min);track.max=String(s.max);track.value=String(p.current);
        track.setAttribute('aria-valuetext',`${p.current} of ${s.max}`);
        counter.textContent=p.display;
        previous.disabled=p.current<=s.min;next.disabled=p.current>=s.max;
        play.disabled=p.total<=1;
        if(p.current>=s.max)pause();
        narrator.stateChanged();
    }
    function move(value:number){if(config)setSliderValue(config.slider,value);render();}
    previous.onclick=()=>{pause();const s=slider();if(s)move(s.value-1);};
    next.onclick=()=>{pause();const s=slider();if(s)move(s.value+1);};
    track.oninput=()=>{pause();move(Number(track.value));};
    // While narrating, play waits for the tutor: after the usual interval, a state is held until its narration
    // has been answered and spoken (rechecked every WAIT_MS), and the next move follows as soon as it has.
    const narrationPending=()=>narrator.on&&(narrator.busy||!!window.algebenchTTSActive?.());
    const WAIT_MS=150;
    function advance(){
        timer=null;
        if(narrationPending()){timer=setTimeout(advance,WAIT_MS);return;}
        const current=slider();
        if(!current){pause();return;}
        move(current.value+1);
        if(play.getAttribute('aria-label')==='Pause execution'&&slider()&&slider()!.value<slider()!.max)timer=setTimeout(advance,interval());
    }
    function start(){
        play.innerHTML=pauseIcon;play.setAttribute('aria-label','Pause execution');play.dataset.tip='Pause';
        timer=setTimeout(advance,interval());
    }
    play.onclick=()=>{
        if(timer!==null){pause();return;}
        const s=slider();if(!s)return;
        if(s.value>=s.max)move(s.min);
        start();
    };
    speed.onchange=()=>{if(timer!==null){clearTimeout(timer);timer=null;start();}};
    // A navigation event that lands where we already are (a re-render, the tutor naming the current step) must not
    // stop playback; only a real scene or step change does.
    let shownAt='';
    function refresh(){
        const at=`${state.currentSceneIndex}/${state.currentStepIndex}`;
        if(at!==shownAt||timer===null)pause();
        shownAt=at;
        config=(state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined)?.stepPlayback;
        speed.hidden=!config?.speedControl;
        render();
        // The bound parameter remains in state for expressions and deeplinks;
        // only its redundant ordinary slider row is hidden.
        document.querySelectorAll<HTMLInputElement>('.slider-range').forEach(input=>{
            const row=input.closest<HTMLElement>('.slider-row');if(row)row.hidden=input.dataset.sliderId===config?.slider;
        });
    }
    window.addEventListener('algebench:playbackpause',pause);
    // A conversation the reader now drives (interview, quiz): narration would answer each new state over it.
    window.addEventListener('algebench:narrationoff',()=>{if(narrator.on){narrator.set(false);paintNarrate();}});
    window.addEventListener('algebench:navchange',refresh);
    window.addEventListener('algebench:sliderchange',render);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
    pause();refresh();
}
