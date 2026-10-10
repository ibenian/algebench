/** Deterministic bounded durable fan-out pipeline. Models are structured table data; no hidden scenario IDs, clocks, network calls, or lesson-specific providers. */
(function () {
    'use strict';
    const traceCache = new Map();
    const cache = new Map(), modelCache = new Map(), tableModelCache = new Map();
    const integer = (x, low, high, fallback) => Number.isFinite(Number(x)) ? Math.max(low, Math.min(high, Math.floor(Number(x)))) : fallback;
    function validateModel(raw) {
        if(!raw||Array.isArray(raw)||typeof raw!=='object')throw new Error('Model must be structured data.');
        const fingerprint=JSON.stringify(raw);
        if(fingerprint.length>16000)throw new Error('Model exceeds the bounded data limit.');
        if(modelCache.has(fingerprint))return modelCache.get(fingerprint);
        const m={...raw};
        const allowed=['submissions','deferredFraction','resumeTick','replays','admissionBound','receiptExcluded','requestPrefix','targetPrefix','maxAttempts','backoffBase','responseDelay','receiptDelay','outageStart','outageEnd','sources','targets','memberships','source'];
        for(const k of Object.keys(m))if(!allowed.includes(k))throw new Error('Unknown model option: '+k);
        const bounded=(v,lo,hi,name)=>{if(!Number.isInteger(v)||v<lo||v>hi)throw new Error('Invalid '+name);return v;};
        const submissions=m.submissions??[{tick:1,count:1}],replays=m.replays??[];
        if(!Array.isArray(submissions)||submissions.length>120||!Array.isArray(replays)||replays.length>120)throw new Error('Invalid event schedule.');
        for(const e of submissions){if(!e||typeof e!=='object')throw new Error('Invalid submission');bounded(e.tick,1,240,'submission tick');bounded(e.count,1,12,'submission count');}
        if(submissions.reduce((n,e)=>n+e.count,0)>120)throw new Error('At most 120 requests per run.');
        for(const e of replays){if(!e||typeof e!=='object')throw new Error('Invalid replay');bounded(e.tick,1,240,'replay tick');bounded(e.request,1,120,'replay request');bounded(e.target,1,40,'replay target');}
        const fraction=m.deferredFraction??0;if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new Error('Invalid deferredFraction');
        const excluded=m.receiptExcluded??[];if(!Array.isArray(excluded)||excluded.length>40)throw new Error('Invalid receiptExcluded');for(const target of excluded)bounded(target,1,40,'excluded target');
        for(const k of ['requestPrefix','targetPrefix'])if(m[k]!==undefined&&(typeof m[k]!=='string'||!/^[-a-zA-Z0-9_]{1,24}$/.test(m[k])))throw new Error('Invalid '+k);
        if(m.admissionBound!==undefined&&typeof m.admissionBound!=='boolean')throw new Error('Invalid admissionBound');
        if(m.sources!==undefined||m.targets!==undefined||m.memberships!==undefined||m.source!==undefined){
            for(const key of ['sources','targets']){
                const values=m[key];
                if(!Array.isArray(values)||values.length<1||values.length>40||values.some(v=>typeof v!=='string'||!/^[-a-zA-Z0-9_]{1,24}$/.test(v))||new Set(values).size!==values.length)throw new Error('Invalid '+key+' directory');
            }
            if(!Array.isArray(m.memberships)||m.memberships.length>1600)throw new Error('Invalid memberships');
            for(const relation of m.memberships)if(!relation||!m.sources.includes(relation.source)||!m.targets.includes(relation.target))throw new Error('Unknown membership endpoint');
            m.source=m.source??m.sources[0];
            if(!m.sources.includes(m.source))throw new Error('Unknown request source');
        }
        const parsed={...m,submissions,replays,deferredFraction:fraction,receiptExcluded:excluded,requestPrefix:m.requestPrefix??'r',targetPrefix:m.targetPrefix??'t',resumeTick:bounded(m.resumeTick??12,1,240,'resumeTick'),maxAttempts:bounded(m.maxAttempts??3,1,10,'maxAttempts'),backoffBase:bounded(m.backoffBase??2,1,4,'backoffBase'),responseDelay:bounded(m.responseDelay??1,1,24,'responseDelay'),receiptDelay:bounded(m.receiptDelay??1,1,24,'receiptDelay'),outageStart:bounded(m.outageStart??5,1,240,'outageStart'),outageEnd:bounded(m.outageEnd??10,1,240,'outageEnd')};
        if(modelCache.size>=128)modelCache.delete(modelCache.keys().next().value);
        modelCache.set(fingerprint,parsed);return parsed;
    }
    function config(model,frame,targets,workers,effectRate,failure,dedupe,capacity,policy) {
        return [validateModel(model),integer(frame,0,240,0),integer(targets,1,40,6),integer(workers,1,12,2),integer(effectRate,1,12,2),integer(failure,0,4,0),integer(dedupe,0,1,1),integer(capacity,1,120,12),integer(policy,0,1,1)];
    }
    function simulate(args) {
        const [model,frame,recipients,workers,rate,failure,dedupe,capacity,policy] = config(...args);
        const key = [JSON.stringify(model),frame,recipients,workers,rate,failure,dedupe,capacity,policy].join(':');
        if (cache.has(key)) return cache.get(key);
        const s = { db:[], outbox:[], source:[], delivery:[], queue:[], workers:[], retry:[], effects:[], receipts:[], ledger:[], dlq:[], deferred:[], accepted:0,effectAccepted:0,receiptCount:0,duplicates:0,rejected:0,expired:0,retries:0,attempts:0,writes:0, sourceConsumed:0,deliveryConsumed:0,relayed:0,flows:{},action:'Ready: no durable request exists.', explanation:'**Tick 0 — before admission.** No request has committed yet; every structure is empty. Advance through the configured submission schedule to persist requests and their outbox intents.' };
        // Optional directory-backed audience resolution. Generic sources may be
        // publishers, channels, organizations, webhook topics, or other entities.
        const directoryBacked=!!model.memberships;
        const targetsFor=()=>directoryBacked?[...new Set(model.memberships.filter(r=>r.source===model.source).map(r=>r.target))].slice(0,recipients).map(id=>model.targets.indexOf(id)+1):Array.from({length:recipients},(_,i)=>i+1);
        const requestTargets=new Map();
        s.sources=directoryBacked?[...model.sources]:[];
        s.senders=directoryBacked?[model.source]:[];
        s.targets=directoryBacked?[...model.targets]:[];
        s.memberships=directoryBacked?[...new Set(model.memberships.filter(r=>r.source===model.source).map(r=>r.source+' → '+r.target))]:[];
        s.followers=directoryBacked?[...new Set(model.memberships.filter(r=>r.source===model.source).map(r=>r.target))]:[];
        s.resolved=[];s.intents=[];
        s.matchedTargets=targetsFor().length;
        if(directoryBacked)s.explanation='**Tick 0 — before admission.** The source and target directories and subscription relations already exist. No request has committed. The follower query limit bounds the audience selected for the current source; it does not generate users.';
        const identity=n=>model.requestPrefix+n+(directoryBacked?' @ '+model.source:'');
        const fanout = [], scheduledReceipts = [], completed = new Set(), seenReceipt = new Set(), seenEffect = new Set();
        let nextNotification = 1, acceptedThisTick = 0, lostAckInjected = false;
        const job = (n,u) => ({ id:model.requestPrefix+n+':'+(directoryBacked?model.targets[u-1]:model.targetPrefix+u),n,u,attempt:0 });
        const outstanding = () => s.outbox.reduce((n,r)=>n+r.remaining,0)+fanout.reduce((n,r)=>n+r.remaining,0)+s.queue.length+s.workers.length+s.retry.length+s.deferred.length;
        for (let tick=1;tick<=frame;tick++) {
            const events = [];
            s.flows={lookup:0,commit:0,relay:0,fanout:0,claim:0,accept:0,receipt:0,retry:0,resume:0,read:0,terminal:0,dedupe:0,ack:0,dead:0,expand:0,defer:0,replay:0,reject:0,abandon:0,admit:0,permanent:0,exhausted:0};
            const before = { accepted:s.effectAccepted, duplicates:s.duplicates, retries:s.retries, terminal:s.dlq.length, expired:s.expired, attempts:s.attempts };
            // An external effect can succeed without a downstream receipt.
            for (let i=scheduledReceipts.length-1;i>=0;i--) if (scheduledReceipts[i].due<=tick) {
                const r=scheduledReceipts.splice(i,1)[0];
                s.receipts.push(r.id);s.flows.receipt++;
                if(!seenReceipt.has(r.id)) { seenReceipt.add(r.id); s.receiptCount++; }
                events.push(`Downstream receipt ${r.id}`);
            }
            acceptedThisTick=0;
            const responding=s.workers.filter(w=>w.due<=tick);
            s.workers=s.workers.filter(w=>w.due>tick);
            for(const w of responding) {
                const permanent=failure===3 && w.u===1;
                const outage=(failure===1 && tick>=model.outageStart && tick<=model.outageEnd) || (failure===4 && tick>=model.outageStart);
                const throttled=acceptedThisTick>=rate;
                if(permanent) {s.dlq.push({...w,reason:'permanent-target'});s.flows.terminal++;s.flows.dead++;s.flows.permanent++; events.push(`${w.id}: permanent target failure → DLQ`); continue;}
                const lostAck=failure===2 && w.n===1 && w.u===1 && w.attempt===1 && !lostAckInjected;
                if(!outage && !throttled) {
                    acceptedThisTick++; s.effectAccepted++;s.flows.accept++;
                    if(seenEffect.has(w.id)) s.duplicates++; else seenEffect.add(w.id);
                    s.effects.push(`${w.id}#${w.attempt}`);
                    // Receipt exclusions model targets without downstream confirmation.
                    if(!(model.receiptExcluded.includes(w.u))) scheduledReceipts.push({id:w.id,due:tick+model.receiptDelay});
                    if(lostAck) lostAckInjected=true;
                    if(!lostAck) {s.flows.ack++;completed.add(w.id); if(!s.ledger.includes(w.id)) s.ledger.push(w.id); events.push(`External service accepted ${w.id}; acknowledgement stored`); continue;}
                }
                const reason=lostAck?'lost-ack':outage?'unavailable':'rate-limit';
                if(policy===0) {s.expired++;s.flows.terminal++;s.flows.abandon++; events.push(`${w.id}: ${reason}; at-most-once abandons`);}
                else if(w.attempt>=model.maxAttempts) {s.dlq.push({...w,reason});s.flows.terminal++;s.flows.dead++;s.flows.exhausted++; events.push(`${w.id}: attempts exhausted → DLQ`);}
                else {const due=tick+model.backoffBase**w.attempt; s.retry.push({...w,due,reason}); s.retries++;s.flows.retry++; events.push(`${w.id}: ${reason}; retry due t${due}`);}
            }
            const ready=s.retry.filter(r=>r.due<=tick);
            s.retry=s.retry.filter(r=>r.due>tick);
            s.queue.push(...ready.map(r=>({...r,enqueued:tick})));
            s.delivery.push(...ready.map(r=>r.id));s.flows.resume=ready.length;
            const availableSlots=Math.min(Math.max(0,workers-s.workers.length),rate);
            for(let slot=0;slot<availableSlots && s.queue.length;slot++) {
                const w=s.queue.shift();s.deliveryConsumed++;
                if(dedupe && completed.has(w.id)) {s.flows.dedupe++;events.push(`Ledger suppresses completed replay ${w.id}`);continue;}
                s.attempts++;s.flows.claim++; s.workers.push({...w,attempt:w.attempt+1,due:tick+model.responseDelay}); events.push(`Worker claims ${w.id} attempt ${w.attempt+1}`);
            }
            // A separate service materializes recipient jobs after outbox relay.
            while(fanout.length) {
                const row=fanout.shift();s.sourceConsumed++;s.flows.expand++;
                const audience=targetsFor(),active=audience.length-Math.floor(audience.length*model.deferredFraction);
                row.users=audience.slice(0,active);row.deferred=audience.slice(active);
                if(directoryBacked){s.flows.lookup+=audience.length;s.resolved.push(...audience.map(u=>model.requestPrefix+row.n+' → '+model.targets[u-1]));events.push('Resolve '+model.source+' subscriptions: '+audience.length+' known targets');}
                for(const u of row.deferred)s.deferred.push(job(row.n,u));s.flows.defer+=row.deferred.length;
                s.delivery.push(...row.users.map(u=>job(row.n,u).id));s.flows.fanout+=row.users.length;
                s.queue.push(...row.users.map(u=>({...job(row.n,u),enqueued:tick})));
                s.writes+=row.users.length;
                events.push(`Fan-out materializes ${row.users.length} jobs for ${model.requestPrefix}${row.n}`);
            }
            if(model.deferredFraction>0 && tick===model.resumeTick) {
                const offline=s.deferred.splice(0);
                s.writes+=offline.length;s.flows.read=offline.length;
                s.delivery.push(...offline.map(w=>w.id));
                s.queue.push(...offline.map(w=>({...w,enqueued:tick})));
                events.push(`Deferred trigger: materialize ${offline.length} deferred jobs`);
            }
            const rows=s.outbox.splice(0);
            for(const row of rows) {
                fanout.push({n:row.n,remaining:row.remaining});
                s.source.push(identity(row.n));s.relayed++;s.flows.relay++;
                events.push(`Relay ${model.requestPrefix}${row.n}; outbox row acknowledged`);
            }
            for(const replay of model.replays.filter(e=>e.tick===tick)) {
                if(!requestTargets.get(replay.request)?.includes(replay.target))continue;
                const item=job(replay.request,replay.target);s.queue.push({...item,enqueued:tick});s.delivery.push(item.id);s.flows.replay++;events.push('Replay publisher appends '+item.id);
            }
            const batch=model.submissions.filter(e=>e.tick===tick).reduce((n,e)=>n+e.count,0);
            for(let b=0;b<batch;b++) {
                const n=nextNotification++;s.flows.admit++;
                const audience=targetsFor(),targetCount=audience.length;
                if(model.admissionBound && outstanding()+targetCount>capacity) {s.rejected+=targetCount;s.flows.reject++; events.push(`Reject ${model.requestPrefix}${n} before commit: admission capacity ${capacity}`);continue;}
                s.accepted+=targetCount;s.flows.commit+=targetCount; s.db.push(`${model.requestPrefix}${n}`);s.intents.push(identity(n));requestTargets.set(n,audience);s.outbox.push({n,remaining:targetCount});s.writes+=2;
                events.push(`Atomic commit ${identity(n)}: request + outbox (${targetCount} targets)`);
            }
            const trace=events.length?`t${tick}: ${events.join('; ')}`:`t${tick}: no transition; waiting for retry, read, or receipts receipt.`;
            s.action=trace.length<=220?trace:trace.slice(0,196)+`… (${events.length} events)`;
            const parts=[];
            const publishedReplays=events.filter(e=>e.startsWith('Replay publisher')).length;
            if(publishedReplays)parts.push('Replay publisher appends '+publishedReplays+' duplicate job record(s) to the delivery log and backlog. The completion ledger decides whether another effect is attempted on claim.');
            if(s.flows.commit)parts.push(s.flows.commit+' target obligations become durable through an atomic request/outbox commit.');
            if(directoryBacked&&events.some(e=>e.startsWith('Atomic commit')))parts.push('Intent carries source '+model.source+'. Admission reserves capacity for '+s.matchedTargets+' matched subscriptions from the static directory snapshot.');
            if(directoryBacked&&events.some(e=>e.startsWith('Resolve')))parts.push('Fan-out queries subscriptions for '+model.source+', joins known target identities, deduplicates followers, and applies the query limit of '+recipients+'. It resolves '+s.flows.lookup+' target(s); the slider does not create users.');
            if(s.flows.relay)parts.push('Relay appends '+s.flows.relay+' intent(s) to the retained source log. The processor expands them next tick.');
            if(s.flows.fanout)parts.push('Processor expands '+s.flows.fanout+' jobs into the delivery log and worker backlog.');
            if(s.flows.read)parts.push('Deferred trigger publishes '+s.flows.read+' jobs. Workers can claim them next tick.');
            if(s.flows.claim)parts.push('Workers claim '+s.flows.claim+' jobs; consumer position advances while retained records stay in the log. Responses are due after '+model.responseDelay+' tick(s).');
            if(s.flows.accept)parts.push('External service accepts '+s.flows.accept+' effect(s). Acceptance does not prove a downstream receipt.');
            if(s.flows.receipt)parts.push('Record '+s.flows.receipt+' downstream receipt(s); distinct receipt count and receipt history are separate.');
            if(s.flows.ack)parts.push('Store '+s.flows.ack+' acknowledged completion(s) in the ledger.');
            if(s.flows.retry)parts.push(s.flows.retry+' failed or uncertain job(s) enter backoff, eligible at tick(s) '+[...new Set(s.retry.filter(r=>r.due>tick).map(r=>r.due))].join(', ')+'.');
            if(s.flows.resume)parts.push('Promote '+s.flows.resume+' due retries to the delivery log and backlog.');
            if(events.some(e=>e.includes('lost-ack')))parts.push('An external effect occurred, but its acknowledgment was lost. The ledger cannot suppress an unknown completion.');
            if(s.flows.dedupe)parts.push('Ledger suppresses '+s.flows.dedupe+' completed replay(s). No new external attempt occurs.');
            if(s.flows.dead)parts.push(s.flows.dead+' job(s) enter dead-letter storage: a permanent target failure or the retry budget is exhausted.');
            if(s.expired>before.expired)parts.push('At-most-once abandons '+(s.expired-before.expired)+' failed or uncertain job(s). No retry is scheduled.');
            const rejected=events.filter(e=>e.startsWith('Reject')).length;if(rejected)parts.push('Admission rejects '+rejected*s.matchedTargets+' target obligations before commit; capacity includes all outstanding work.');
            if(s.deferred.length)parts.push(s.deferred.length+' target(s) remain deferred until trigger tick '+model.resumeTick+'.');
            if(!events.length){parts.unshift('No transition this tick.');if(s.retry.length)parts.push(s.retry.length+' retry job(s) wait until tick '+Math.min(...s.retry.map(r=>r.due))+'.');else if(!s.deferred.length){
                    const nextSubmission=model.submissions.filter(e=>e.tick>tick).map(e=>e.tick);
                    if(nextSubmission.length)parts.push('Next configured submission is at tick '+Math.min(...nextSubmission)+'.');
                    else if(s.workers.length)parts.push('In-flight workers await their next external response at tick '+Math.min(...s.workers.map(w=>w.due))+'.');
                    else if(scheduledReceipts.length)parts.push('Awaiting downstream receipts; the next is due at tick '+Math.min(...scheduledReceipts.map(r=>r.due))+'.');
                    else parts.push('Live scheduling state is drained. Completion records do not prove every downstream target received the effect.');
                }}
            s.explanation='**Tick '+tick+' — '+(events.length?'what changed':'waiting')+'.**\n\n'+parts.join(' ');


        }
        s.terminal=s.dlq.length+s.expired;
        s.queued=s.queue.length;
        s.backlog=outstanding();
        // Logs retain events after consumption; processor staging and worker lag are separate views.
        s.stage=fanout.map(r=>identity(r.n));
        s.outbox=s.outbox.map(r=>identity(r.n)+':committed');
        s.queue=s.queue.map(w=>w.id);
        s.workers=s.workers.map(w=>`${w.id}#${w.attempt}`);
        s.retry=s.retry.map(w=>`${w.id}@t${w.due}`);
        s.deferred=s.deferred.map(w=>w.id);
        s.dlq=s.dlq.map(w=>`${w.id}:${w.reason}`);
        if(cache.size>=256) cache.delete(cache.keys().next().value);
        cache.set(key,s);return s;
    }
    /** Full, serializable snapshots; parameter changes select a new trace, frame only selects a row. */
    function dsTrace(model,lastFrame,recipients,workers,rate,failure,dedupe,capacity,policy) {
        const args=config(model,lastFrame,recipients,workers,rate,failure,dedupe,capacity,policy);
        const key=JSON.stringify(args);
        if(traceCache.has(key))return traceCache.get(key);
        const rows=[];
        for(let frame=0;frame<=args[1];frame++) {
            const state=simulate([args[0],frame,...args.slice(2)]);
            const flows=Object.fromEntries('lookup commit relay fanout claim accept receipt retry resume read terminal dedupe ack dead expand defer replay reject abandon admit permanent exhausted'.split(' ').map(key=>['flow_'+key,state.flows[key]??0]));
            rows.push(JSON.parse(JSON.stringify({...state,...flows,tick:frame,message:state.explanation})));
        }
        if(traceCache.size>=16)traceCache.delete(traceCache.keys().next().value);
        traceCache.set(key,rows);return rows;
    }
    function dsTraceCell(rows,idx) {
        if(rows && typeof rows.toArray==='function')rows=rows.toArray();
        if(!Array.isArray(rows))return '';
        const i=integer(idx,0,999,0);
        return rows.length>8 && i===7 ? '+'+(rows.length-7)+' more' : i<8 ? (rows[i]??'') : '';
    }
    function dsCount(s,f,r,w,g,e,d,c,p,store) { const a=simulate([s,f,r,w,g,e,d,c,p])[store]; return Array.isArray(a)?a.length:0; }
    function dsCell(s,f,r,w,g,e,d,c,p,store,idx) { const a=simulate([s,f,r,w,g,e,d,c,p])[store]; const i=integer(idx,0,999,0);return !Array.isArray(a)?'':a.length>8&&i===7?`+${a.length-7} more`:i<8?(a[i]||''):''; }
    function dsMetric(s,f,r,w,g,e,d,c,p,metric) { const a=simulate([s,f,r,w,g,e,d,c,p])[metric];return typeof a==='number'?a:0; }
    function dsAction(s,f,r,w,g,e,d,c,p) { return simulate([s,f,r,w,g,e,d,c,p]).action; }
    function dsExplain(s,f,r,w,g,e,d,c,p) { return simulate([s,f,r,w,g,e,d,c,p]).explanation; }
    function dsFlow(s,f,r,w,g,e,d,c,p,edge) { const value=simulate([s,f,r,w,g,e,d,c,p]).flows[edge];return typeof value==='number'?value:0; }
    function dsModel(settings,submissions,sources,targets,memberships,replays,exclusions,sourceIndex){
        const tables=[settings,submissions,sources,targets,memberships,replays,exclusions];
        if(tables.some(table=>!Array.isArray(table)||table.some(row=>!row||Array.isArray(row)||typeof row!=='object')))throw new Error('Simulation inputs must be data tables of row objects.');
        if(settings.length!==1||submissions.length>120||sources.length>40||targets.length>40||memberships.length>1600||replays.length>120||exclusions.length>40)throw new Error('Invalid simulation table sizes.');
        if(!Number.isInteger(sourceIndex)||sourceIndex<1||sourceIndex>Math.max(1,sources.length))throw new Error('Unknown source selection');
        const fingerprint=JSON.stringify([...tables,sourceIndex]);
        if(fingerprint.length>16000)throw new Error('Simulation tables exceed the bounded data limit.');
        if(tableModelCache.has(fingerprint))return tableModelCache.get(fingerprint);
        const model={...settings[0],submissions:submissions.map(row=>({...row})),replays:replays.map(row=>({...row})),receiptExcluded:exclusions.map(row=>row.target)};
        if(sources.length||targets.length||memberships.length){
            model.sources=sources.map(row=>row.id);model.targets=targets.map(row=>row.id);
            model.memberships=memberships.map(row=>({source:row.source,target:row.target}));
            model.source=model.sources[sourceIndex-1];
        }
        const validated=validateModel(model);
        if(tableModelCache.size>=128)tableModelCache.delete(tableModelCache.keys().next().value);
        tableModelCache.set(fingerprint,validated);return validated;
    }
    window.AlgeBenchDomains.register('distributed-systems',{dsCount,dsCell,dsMetric,dsAction,dsExplain,dsFlow,dsModel,dsTrace,dsTraceCell});
})();
