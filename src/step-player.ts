/** Generic discrete state playback. It writes a slider; views bind to its data. */
import { state } from '/state.js';
import { setSliderValue } from '/sliders.js';
import { updateStepCaption } from '/overlay.js';
import type { Scene, StepPlayback } from '/types/lesson.js';

export function playbackPosition(value: number, min: number, max: number) {
    const current=Math.max(min,Math.min(max,Math.round(value)));
    return {current,ordinal:current-min+1,total:max-min+1};
}

export function setupStepPlayer(): void {
    const wrapper=document.getElementById('mathbox-wrapper');
    if(!wrapper)return;
    const host=wrapper;
    const bar=document.createElement('div');bar.id='state-player';bar.hidden=true;
    bar.setAttribute('role','group');bar.setAttribute('aria-label','Execution state player');
    const previous=document.createElement('button'),play=document.createElement('button'),next=document.createElement('button');
    previous.textContent='◀';next.textContent='▶';
    previous.setAttribute('aria-label','Previous execution state');next.setAttribute('aria-label','Next execution state');
    for(const button of [previous,play,next])button.type='button';
    const track=document.createElement('input');track.type='range';track.step='1';track.setAttribute('aria-label','Execution state');
    const counter=document.createElement('output');counter.setAttribute('aria-label','Execution position');
    bar.append(previous,play,next,track,counter);host.append(bar);
    // Reserve the actual player height for legends, including responsive wrapping.
    // ResizeObserver runs on geometry changes, not on animation frames.
    const resizeObserver=new ResizeObserver(()=>{
        host.style.setProperty('--state-player-h',`${bar.offsetHeight}px`);
    });
    resizeObserver.observe(bar);
    let timer:ReturnType<typeof setInterval>|null=null;
    let config:StepPlayback|undefined;
    const slider=()=>config?state.sceneSliders[config.slider]:undefined;
    function pause(){if(timer!==null)clearInterval(timer);timer=null;play.textContent='▷';play.setAttribute('aria-label','Play execution');}
    function render(){
        const scene=state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined;
        if(scene?.steps?.[state.currentStepIndex]?.descriptionExpr)updateStepCaption(scene,state.currentStepIndex,true);
        const s=slider();
        if(!s||s.kind==='tensor'||!Number.isInteger(s.min)||!Number.isInteger(s.max)){pause();bar.hidden=true;host.classList.remove('has-state-player');return;}
        bar.hidden=false;
        host.classList.add('has-state-player');
        const p=playbackPosition(s.value,s.min,s.max);
        track.min=String(s.min);track.max=String(s.max);track.value=String(p.current);
        track.setAttribute('aria-valuetext',`${p.ordinal} of ${p.total}`);
        counter.textContent=`${p.ordinal} / ${p.total}`;
        previous.disabled=p.current<=s.min;next.disabled=p.current>=s.max;
        play.disabled=p.total<=1;
        if(p.current>=s.max)pause();
    }
    function move(value:number){if(config)setSliderValue(config.slider,value);render();}
    previous.onclick=()=>{pause();const s=slider();if(s)move(s.value-1);};
    next.onclick=()=>{pause();const s=slider();if(s)move(s.value+1);};
    track.oninput=()=>{pause();move(Number(track.value));};
    play.onclick=()=>{
        if(timer!==null){pause();return;}
        const s=slider();if(!s)return;
        if(s.value>=s.max)move(s.min);
        play.textContent='Ⅱ';play.setAttribute('aria-label','Pause execution');
        timer=setInterval(()=>{const current=slider();if(current)move(current.value+1);else pause();},config?.intervalMs??900);
    };
    function refresh(){
        pause();
        config=(state.lessonSpec?.scenes?.[state.currentSceneIndex] as Scene|undefined)?.stepPlayback;
        render();
        // The bound parameter remains in state for expressions and deeplinks;
        // only its redundant ordinary slider row is hidden.
        document.querySelectorAll<HTMLInputElement>('.slider-range').forEach(input=>{
            const row=input.closest<HTMLElement>('.slider-row');if(row)row.hidden=input.dataset.sliderId===config?.slider;
        });
    }
    window.addEventListener('algebench:playbackpause',pause);
    window.addEventListener('algebench:navchange',refresh);
    window.addEventListener('algebench:sliderchange',render);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
    pause();refresh();
}
