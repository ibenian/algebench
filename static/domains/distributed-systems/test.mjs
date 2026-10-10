import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { create, all } from 'mathjs';
import test from 'node:test';
import assert from 'node:assert/strict';
let api;
vm.runInNewContext(readFileSync(new URL('./index.js',import.meta.url),'utf8'),{window:{AlgeBenchDomains:{register:(name,functions)=>{assert.equal(name,'distributed-systems');api=functions;}}}});
const modelFor=s=>({submissions:s===3?[{tick:1,count:3}]:s===6?[1,2,3,4].map(tick=>({tick,count:1})):[{tick:1,count:1}],deferredFraction:s===2?.5:0,resumeTick:12,replays:s===5?[{tick:12,request:1,target:1}]:[],admissionBound:s===6,receiptExcluded:s===7?[1]:[],requestPrefix:'n',targetPrefix:'u'});
const args=(scenario=0,frame=24,overrides={})=>[modelFor(scenario),frame,overrides.recipients??6,overrides.workers??2,overrides.rate??2,overrides.failure??0,overrides.dedupe??1,overrides.capacity??12,overrides.policy??1];
const metric=(a,m)=>api.dsMetric(...a,m);
const count=(a,s)=>api.dsCount(...a,s);
const cells=(a,s)=>Array.from({length:Math.min(8,count(a,s))},(_,i)=>api.dsCell(...a,s,i));
test('causal pipeline separates durable admission, fan-out, acceptance, receipt',()=>{
 assert.equal(count(args(0,0),'db'),0);
 assert.equal(metric(args(0,1),'accepted'),6);
 assert.equal(count(args(0,1),'outbox'),1);
 assert.equal(count(args(0,2),'outbox'),0);
 assert.equal(count(args(0,2),'source'),1);
 assert.equal(count(args(0,2),'stage'),1);
 assert.equal(count(args(0,3),'queue'),6);
 assert.equal(count(args(0,4),'workers'),2);
 assert.equal(metric(args(0,5),'effectAccepted'),2);
 assert.equal(metric(args(0,5),'receiptCount'),0);
 assert.equal(metric(args(0,6),'receiptCount'),2);
 assert.equal(metric(args(),'receiptCount'),6);
});
test('healthy lifecycle conserves accepted recipient intents at every tick',()=>{
 for(const scenario of [0,1,2,3,6]) for(let frame=0;frame<=24;frame++){
  const a=args(scenario,frame); assert.equal(metric(a,'accepted'),metric(a,'backlog')+count(a,'ledger')+count(a,'dlq')+metric(a,'expired'),`${scenario}:${frame}`);
 }
});
test('read fan-out defers inactive recipients and reduces durable write amplification',()=>{
 const write=args(1,8),read=args(2,8);
 assert.equal(metric(write,'writes'),8);assert.equal(metric(read,'writes'),5);
 assert.equal(count(read,'deferred'),3);assert.equal(metric(read,'receiptCount'),3);
 assert.equal(metric(args(2,12),'writes'),8);assert.equal(count(args(2,12),'deferred'),0);assert.equal(metric(args(2),'receiptCount'),6);
});
test('429 creates scheduled backoff with a bounded attempt budget',()=>{
 const options={recipients:1,workers:1,rate:1,failure:1};
 assert.deepEqual(cells(args(4,5,options),'retry'),['n1:u1@t7']);
 assert.equal(count(args(4,6,options),'queue'),0);
 assert.equal(count(args(4,7,options),'workers'),1);
 assert.deepEqual(cells(args(4,8,options),'retry'),['n1:u1@t12']);
 assert.equal(metric(args(4,24,options),'attempts'),3);
 assert.equal(metric(args(4,24,options),'receiptCount'),1);
 // A low quota paces healthy dispatch rather than generating retry storms.
 const stressed=args(4,24,{recipients:40,workers:12,rate:1});
 assert.equal(count(stressed,'dlq'),0);assert.equal(metric(stressed,'retries'),0);assert.ok(metric(stressed,'attempts')<=40);
});
test('lost acknowledgement remains ambiguous even with ledger deduplication',()=>{
 const on=args(5,24,{failure:2}),off=args(5,24,{failure:2,dedupe:0});
 assert.equal(metric(on,'receiptCount'),6);assert.equal(metric(on,'effectAccepted'),7);
 assert.equal(metric(on,'duplicates'),1);
 assert.equal(metric(off,'effectAccepted'),8);assert.equal(metric(off,'duplicates'),2);
 assert.match(api.dsAction(...args(5,13,{failure:2})),/Ledger suppresses/);
});
test('admission bounds outstanding work and preserves already accepted intents',()=>{
 for(let frame=0;frame<=24;frame++) assert.ok(metric(args(6,frame,{capacity:8}),'backlog')<=8);
 const end=args(6,24,{capacity:8});assert.equal(metric(end,'accepted'),6);
 assert.equal(metric(end,'rejected'),18);assert.equal(metric(end,'receiptCount'),6);
 const none=args(6,24,{capacity:3});assert.equal(metric(none,'accepted'),0);assert.equal(metric(none,'rejected'),24);
});
test('at-most-once trades loss for fewer attempts; at-least-once cannot promise device delivery',()=>{
 const once=args(7,24,{failure:2,policy:0}),retry=args(7,24,{failure:2,policy:1});
 assert.equal(metric(once,'attempts'),6);assert.equal(metric(once,'expired'),1);
 assert.equal(metric(retry,'attempts'),7);assert.equal(metric(retry,'effectAccepted'),7);
 assert.equal(metric(retry,'receiptCount'),5);assert.equal(count(retry,'ledger'),6);
});
test('invalid tokens are permanent terminal failures, never retry storms',()=>{
 const a=args(4,24,{failure:3});assert.equal(count(a,'dlq'),1);
 assert.equal(metric(a,'retries'),0);assert.equal(metric(a,'receiptCount'),5);
 assert.match(cells(a,'dlq')[0],/permanent-target/);
});
test('scaling parameters alter throughput and deterministic rewind reproduces identities',()=>{
 assert.ok(metric(args(3,8,{workers:6,rate:6}),'receiptCount')>metric(args(3,8,{workers:1,rate:1}),'receiptCount'));
 const a=args(3,7);const before=cells(a,'queue');api.dsAction(...args(3,24));assert.deepEqual(cells(a,'queue'),before);
 assert.equal(count(args(3,3,{recipients:40}),'queue'),120);
 const visible=cells(args(3,3,{recipients:40}),'queue');assert.equal(visible.length,8);assert.equal(visible[7],'+113 more');
 assert.equal(api.dsCell(...args(3,3),'queue',8),'');
});

test('gateway pacing makes extra workers plateau without healthy retries',()=>{
 const small=args(3,14,{workers:2,rate:2}),large=args(3,14,{workers:12,rate:2});
 assert.equal(metric(small,'receiptCount'),metric(large,'receiptCount'));
 assert.equal(metric(large,'retries'),0);assert.equal(metric(large,'attempts'),18);
});
test('duplicate acceptance accounting remains correct for offline devices',()=>{
 const a=args(7,24,{failure:2});assert.equal(metric(a,'duplicates'),1);assert.equal(metric(a,'receiptCount'),5);
 assert.equal(metric(args(7,24,{failure:2,policy:0}),'terminal'),1);
 assert.equal(metric(args(4,24,{failure:3}),'terminal'),1);
});
test('event descriptions remain bounded even for the largest burst',()=>{
 for(let frame=0;frame<=24;frame++) assert.ok(api.dsAction(...args(3,frame,{recipients:40,workers:12,rate:12,failure:1})).length<=220);
});
test('prolonged outage exhausts exactly three attempts and conserves terminal intents',()=>{
 const opts={recipients:1,workers:1,rate:1,failure:4};
 assert.equal(metric(args(4,12,opts),'attempts'),3);
 assert.equal(count(args(4,12,opts),'workers'),1);
 const end=args(4,24,opts);
 assert.equal(metric(end,'attempts'),3);assert.equal(metric(end,'retries'),2);
 assert.equal(metric(end,'effectAccepted'),0);assert.equal(metric(end,'receiptCount'),0);
 assert.equal(count(end,'dlq'),1);assert.equal(metric(end,'terminal'),1);assert.equal(metric(end,'backlog'),0);
 assert.match(cells(end,'dlq')[0],/unavailable/);
 for(let frame=0;frame<=24;frame++) {
  const a=args(4,frame,opts);
  assert.equal(metric(a,'accepted'),metric(a,'backlog')+count(a,'ledger')+metric(a,'terminal'));
 }
});

test('narration derives causal transitions, rejection, and ambiguity from configured events',()=>{
 assert.match(api.dsExplain(...args(0,1,{recipients:4})),/4 target obligations become durable/);
 assert.match(api.dsExplain(...args(0,2)),/processor expands them next tick/);
 assert.match(api.dsExplain(...args(2,3,{recipients:8})),/Processor expands 4 jobs/);
 assert.match(api.dsExplain(...args(2,12)),/Workers can claim them next tick/);
 assert.match(api.dsExplain(...args(4,6,{failure:1,recipients:1})),/wait until tick 7/);
 assert.match(api.dsExplain(...args(5,5,{failure:2})),/acknowledgment was lost/);
 assert.match(api.dsExplain(...args(5,13)),/No new external attempt/);
 assert.match(api.dsExplain(...args(6,1,{capacity:4,recipients:8})),/rejects 8 target obligations before commit/);
 for(let s=0;s<8;s++)for(let f=0;f<=24;f++)assert.doesNotMatch(api.dsExplain(...args(s,f)),/undefined|NaN/);
});
test('Kafka retained logs and consumer positions stay separate across scenarios and failures',()=>{
 for(let scenario=0;scenario<8;scenario++)for(let failure=0;failure<5;failure++)for(let frame=0;frame<=24;frame++){
  const a=args(scenario,frame,{failure});
  assert.equal(count(a,'source'),metric(a,'sourceConsumed')+count(a,'stage'));
  assert.equal(count(a,'delivery'),metric(a,'deliveryConsumed')+count(a,'queue'));
  if(frame){const prev=args(scenario,frame-1,{failure});assert.ok(count(a,'source')>=count(prev,'source'));assert.ok(count(a,'delivery')>=count(prev,'delivery'));}
 }
});
test('architecture highlights reflect relay, fan-out, claim, retry, and receipt transitions',()=>{
 assert.equal(api.dsFlow(...args(0,2),'relay'),1);
 assert.equal(api.dsFlow(...args(0,3),'fanout'),6);
 assert.equal(api.dsFlow(...args(0,4),'claim'),2);
 assert.equal(api.dsFlow(...args(0,6),'receipt'),2);
 assert.equal(api.dsFlow(...args(4,5,{failure:1}),'retry'),2);
 assert.equal(api.dsFlow(...args(4,7,{failure:1}),'resume'),2);
 assert.equal(count(args(2,2),'deferred'),0);assert.equal(count(args(2,3),'deferred'),3);
 assert.equal(api.dsFlow(...args(2,12),'read'),3);
 assert.equal(count(args(0),'delivery'),6);assert.equal(count(args(0),'queue'),0);
});

test('lost acknowledgments and abandoned attempts do not highlight successful ACK or dead-letter storage',()=>{
 const a=args(5,5,{recipients:1,workers:1,rate:1,failure:2});
 assert.equal(api.dsFlow(...a,'accept'),1);assert.equal(api.dsFlow(...a,'ack'),0);
 const b=args(4,5,{recipients:1,workers:1,rate:1,failure:1,policy:0});
 assert.equal(api.dsFlow(...b,'terminal'),1);assert.equal(api.dsFlow(...b,'dead'),0);
 assert.equal(api.dsFlow(...args(4,5,{failure:3}),'dead'),1);
});

test('webhook workload reuses the engine with custom schedule, identities, and latencies',()=>{
 const model={submissions:[{tick:3,count:2}],requestPrefix:'event',targetPrefix:'endpoint',responseDelay:2,receiptDelay:3};
 const a=t=>[model,t,3,2,2,0,1,120,1];
 assert.equal(api.dsCount(...a(2),'db'),0);
 assert.equal(api.dsCount(...a(3),'db'),2);
 assert.equal(api.dsCount(...a(5),'delivery'),6);
 assert.equal(api.dsCell(...a(5),'queue',0),'event1:endpoint1');
 assert.equal(api.dsMetric(...a(7),'effectAccepted'),0);
 assert.equal(api.dsMetric(...a(8),'effectAccepted'),2);
 assert.equal(api.dsMetric(...a(10),'receiptCount'),0);
 assert.equal(api.dsMetric(...a(11),'receiptCount'),2);
 assert.equal(api.dsMetric(...a(24),'receiptCount'),6);
 for(let tick=0;tick<=24;tick++)assert.ok(api.dsCount(...a(tick),'workers')<=2);
});
test('deferred workloads and retry budgets are configurable without scenario identities',()=>{
 const model={deferredFraction:1,resumeTick:6,maxAttempts:1,submissions:[{tick:1,count:1}],outageStart:1};
 const a=t=>[model,t,2,2,2,4,1,12,1];
 assert.equal(api.dsCount(...a(3),'deferred'),2);
 assert.equal(api.dsCount(...a(5),'delivery'),0);
 assert.equal(api.dsFlow(...a(6),'read'),2);
 assert.equal(api.dsCount(...a(8),'dlq'),2);
 assert.equal(api.dsMetric(...a(8),'retries'),0);
 assert.match(api.dsExplain(...a(3)),/trigger tick 6/);
});
test('model validation bounds schedules and rejects malformed or unknown configuration',()=>{
 for(const m of ['not json',null,[],{scenario:2},{maxAttempts:0},{deferredFraction:2},{submissions:[{tick:0,count:1}]},{receiptExcluded:[0]}])assert.throws(()=>api.dsCount(m,0,1,1,1,0,1,12,1,'db'));
});

test('generic narration explains scheduled future work, receipt delays, and duplicate publication',()=>{
 const model={submissions:[{tick:3,count:1}],receiptDelay:3,replays:[{tick:12,request:1,target:1}]};
 const a=t=>[model,t,1,1,1,0,1,12,1];
 assert.match(api.dsExplain(...a(1)),/Next configured submission is at tick 3/);
 assert.match(api.dsExplain(...a(8)),/Awaiting downstream receipts/);
 assert.match(api.dsExplain(...a(12)),/duplicate job record/);
});

test('lesson dashboard expressions use registered metric names in every scenario',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 const math=create(all);
 const keys=['accepted','backlog','effectAccepted','receiptCount','duplicates','attempts','retries','rejected','writes','terminal'];
 for(const scene of lesson.scenes){
  const data=scene.data;
  const model=api.dsModel(data.settings,data.submissions,data.sources,data.targets,data.memberships,data.replays,data.receiptExclusions,1);
  const parameters=[model,16,8,2,2,0,1,24,0];
  data.trace=api.dsTrace(model,24,...parameters.slice(2));
  for(const el of scene.steps.flatMap(step=>step.add??[]).filter(el=>['metrics','scheduling-metrics'].includes(el.id))){
   const offset=el.id==='metrics'?0:5;
   for(let idx=0;idx<5;idx++){
    const scope={arrayCount:rows=>rows.length,dsMetric:api.dsMetric,dsModel:api.dsModel,sender:1,dataTable:(name,row,column)=>row===undefined?data[name]:data[name][row][column],frame:16,recipients:8,workers:2,gatewayRate:2,failure:0,dedupe:1,capacity:24,policy:0,idx};
    assert.equal(math.evaluate(el.valueExpr,scope),api.dsMetric(...parameters,keys[idx+offset]),scene.id+':'+keys[idx+offset]);
   }
  }
 }
});

const directory={sources:['publisher','channel'],targets:['alice','bob','carol','dave'],memberships:[{source:'publisher',target:'alice'},{source:'publisher',target:'bob'},{source:'publisher',target:'bob'},{source:'publisher',target:'carol'},{source:'channel',target:'dave'}],requestPrefix:'n'};
const fromTables=(model,index=1)=>{
 const {sources=[],targets=[],memberships=[],submissions=[{tick:1,count:1}],replays=[],receiptExcluded=[],...settings}=model;
 return api.dsModel([settings],submissions,sources.map(id=>({id})),targets.map(id=>({id})),memberships,replays,receiptExcluded.map(target=>({target})),index);
};
const directoryArgs=(source=1,frame=3,limit=3,options={})=>[fromTables({...directory,...options},source),frame,limit,2,2,0,1,12,1];
test('source provenance and deduplicated directory subscriptions determine the actual audience',()=>{
 const a=directoryArgs();
 assert.deepEqual(cells(a,'source'),['n1 @ publisher']);
 assert.deepEqual(cells(a,'delivery'),['n1:alice','n1:bob','n1:carol']);
 assert.equal(metric(a,'accepted'),3);assert.equal(api.dsFlow(...a,'lookup'),3);
 assert.deepEqual(cells(a,'resolved'),['n1 → alice','n1 → bob','n1 → carol']);
 assert.deepEqual(cells(directoryArgs(2),'delivery'),['n1:dave']);
 assert.deepEqual(cells(directoryArgs(1,3,1),'delivery'),['n1:alice']);
 assert.equal(metric(directoryArgs(2,24,40),'receiptCount'),1);
 assert.match(api.dsExplain(...a),/queries subscriptions for publisher/);
});
test('deferred jobs and capacity use matched directory identities, not query-limit counts',()=>{
 const a=directoryArgs(1,3,40,{deferredFraction:.5});
 assert.deepEqual(cells(a,'delivery'),['n1:alice','n1:bob']);assert.deepEqual(cells(a,'deferred'),['n1:carol']);
 assert.equal(metric(directoryArgs(1,24,40,{deferredFraction:.5}),'receiptCount'),3);
 const bounded=directoryArgs(2,24,40,{admissionBound:true});bounded[7]=1;
 assert.equal(metric(bounded,'accepted'),1);assert.equal(metric(bounded,'rejected'),0);
 const empty=directoryArgs(1,24,3,{memberships:[]});assert.equal(metric(empty,'accepted'),0);assert.equal(count(empty,'db'),1);assert.equal(count(empty,'delivery'),0);
});
test('directory validation rejects unknown endpoints and out-of-range source selection',()=>{
 for(const extra of [{sources:['publisher','publisher']},{targets:['bad id']},{memberships:[{source:'publisher',target:'unknown'}]}])assert.throws(()=>fromTables({...directory,...extra},1));
 assert.throws(()=>fromTables(directory,3));
 assert.throws(()=>fromTables(directory,'1'));
});

test('separate data tables stay editable and update the audience without serialized cells',()=>{
 const settings=[{requestPrefix:'event'}],submissions=[{tick:1,count:1}],sources=[{id:'channel'}],targets=[{id:'alice'},{id:'bob'}],memberships=[{source:'channel',target:'alice'}];
 const get=()=>api.dsModel(settings,submissions,sources,targets,memberships,[],[],1);
 const a=model=>[model,3,40,2,2,0,1,12,1];
 const before=JSON.stringify([settings,submissions,sources,targets,memberships]);
 assert.deepEqual(cells(a(get()),'delivery'),['event1:alice']);
 assert.equal(JSON.stringify([settings,submissions,sources,targets,memberships]),before);
 memberships[0].target='bob';
 assert.deepEqual(cells(a(get()),'delivery'),['event1:bob']);
 assert.throws(()=>api.dsModel([{model:'serialized config'}],submissions,sources,targets,memberships,[],[],1));
 assert.throws(()=>api.dsModel(settings,'serialized events',sources,targets,memberships,[],[],1));
});

test('real service files highlight causal transitions without placeholder operations',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 const math=create(all);math.import({...api,dataTable:(name,row,column)=>row===undefined?tables[name]:tables[name][row][column]},{override:true});
 let tables;
 const files=new Map(lesson.codeFiles.map(file=>[file.id,{...file,compiled:file.activeLineExpr?math.compile(file.activeLineExpr):null}]));
 for(const file of files.values())assert.equal(file.source,readFileSync(new URL('../../../examples/push-notifications/'+file.path.split('/').at(-1),import.meta.url),'utf8'));
 const marked=(id,scenario,frame,overrides={})=>{
  const file=files.get(id);tables=lesson.scenes[scenario].data;
  const scope={frame,recipients:1,workers:1,gatewayRate:1,failure:0,dedupe:1,capacity:24,policy:1,sender:1,...overrides};
  tables.trace=math.evaluate(lesson.scenes[scenario].tableBindings[0].rowsExpr,scope);
  const result=file.compiled.evaluate(scope);
  const lines=file.source.split('\n');
  return new Set(result.toArray().filter(n=>n>0).map(n=>{assert.ok(Number.isInteger(n)&&n<=lines.length);return lines[n-1].trim();}));
 };
 const has=(id,frame,needle,overrides={})=>[...marked(id,0,frame,overrides)].some(s=>s.includes(needle));
 assert.ok(has('submit',1,'INSERT INTO notifications'));
 assert.ok(has('submit',1,'INSERT INTO outbox'));
 assert.ok(has('outbox_relay',2,'publish(producer, topic, payload)'));
 assert.ok(!has('outbox_relay',2,'def publish'));
 assert.ok(has('flink-job',3,'env.from_source'));
 assert.ok(has('flink-job',3,'self.db.execute'));
 assert.ok(has('flink-job',3,'yield json.dumps'));
 assert.ok(has('flink-job',3,'jobs.sink_to'));
 assert.ok(has('worker',4,'consumer.poll'));
 assert.ok(has('worker',4,'requests.post'));
 assert.ok(has('worker',5,'enqueue(db, f"retry:',{failure:2}));
 assert.ok(!has('worker',5,'INSERT INTO completed',{failure:2}));
 assert.ok(has('worker',5,'INSERT INTO completed'));
 assert.ok(has('worker',5,'"dead-letters"',{failure:3}));
 assert.ok(has('worker',5,'# Abandon',{failure:2,policy:0}));
 for(const file of files.values())if(file.compiled){
  assert.equal(marked(file.id,0,0).size,0);
  assert.equal(marked(file.id,0,24).size,0);
  for(let scenario=0;scenario<lesson.scenes.length;scenario++)for(let frame=0;frame<=24;frame++)assert.ok([...marked(file.id,scenario,frame)].every(s=>s.length>0));
 }
});

test('every lesson step has valid source links, including all live code markers',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 for(const file of lesson.codeFiles)for(const location of file.locations??[]){
  const scene=lesson.scenes.find(s=>s.id===location.scene);
  assert.ok(scene?.steps.some(s=>s.id===location.step));
  assert.ok(location.line>0&&location.line<=file.source.split('\n').length);
 }
 for(const scene of lesson.scenes){
  for(const step of scene.steps)assert.ok(lesson.codeFiles.some(f=>f.locations?.some(l=>l.scene===scene.id&&l.step===step.id)),scene.id+':'+step.id);
  for(const file of lesson.codeFiles){
   const markers=[...file.activeLineExpr?.matchAll(/\? (\d+) : 0/g)??[]].map(m=>Number(m[1]));
   for(const line of markers)assert.ok(file.locations.some(l=>l.scene===scene.id&&l.step==='execute'&&l.line===line));
  }
 }
});

test('explicit trace rows match all state readers and isolate snapshots',()=>{
 const a=args(0,24,{recipients:3,failure:2});
 const rows=api.dsTrace(...a);
 assert.equal(rows.length,25);assert.equal(api.dsTrace(...a),rows);
 for(let frame=0;frame<25;frame++){
  const selected=[a[0],frame,...a.slice(2)],row=rows[frame];
  assert.equal(row.tick,frame);assert.equal(row.message,api.dsExplain(...selected));
  for(const store of ['db','outbox','source','delivery','stage','queue','workers','retry','ledger','dlq','deferred','effects','receipts'])assert.equal(row[store].length,count(selected,store));
  for(const key of ['accepted','backlog','retries','duplicates','receiptCount'])assert.equal(row[key],metric(selected,key));
 }
 assert.equal(rows[0].db.length,0);assert.equal(rows[1].db.length,1);
 assert.notEqual(rows[1].db,rows[2].db);
 const changed=api.dsTrace(...args(0,24,{recipients:1,failure:2}));
 assert.equal(changed[3].delivery.length,1);assert.equal(rows[3].delivery.length,3);
 assert.equal(api.dsTraceCell(rows[3].delivery,0),'n1:u1');
});
test('saved lesson traces are the reproducible defaults for each scene',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 for(const scene of lesson.scenes){
  const d=scene.data,defaults=Object.fromEntries(scene.steps.flatMap(step=>(step.sliders??[]).map(s=>[s.id,s.default])));
  const model=api.dsModel(d.settings,d.submissions,d.sources,d.targets,d.memberships,d.replays,d.receiptExclusions,defaults.sender);
  const trace=api.dsTrace(model,24,defaults.recipients,defaults.workers,defaults.gatewayRate,defaults.failure,defaults.dedupe,defaults.capacity,defaults.policy);
  assert.equal(JSON.stringify(d.trace),JSON.stringify(trace),scene.id);
  assert.equal(scene.steps.find(s=>s.id==='execute').descriptionExpr,"dataTable('trace', frame, 'message')");
 }
});

test('all trace-backed lesson expressions evaluate with changed parameters and tick zero',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 const math=create(all);
 let data;
 math.import({...api,arrayAt:(rows,idx)=>(rows?.toArray?rows.toArray():rows)[idx],concat:(...args)=>args.map(String).join(''),arrayCount:rows=>rows?.toArray?rows.toArray().length:Array.isArray(rows)?rows.length:0,
  dataTable:(name,row,column)=>row===undefined?data[name]:(data[name]?.[row]?.[column]??0)}, {override:true});
 for(const scene of lesson.scenes){
  data={...scene.data};
  const expressions=new Set();
  function walk(value){if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(key.endsWith('Expr')&&typeof child==='string')expressions.add(child);else if(child&&typeof child==='object')walk(child);}}
  walk(scene.steps);lesson.codeFiles.forEach(file=>expressions.add(file.activeLineExpr));
  const compiled=[...expressions].filter(Boolean).map(expr=>[expr,math.compile(expr)]);
  for(const frame of [0,3,5,12,24]){
   const scope={sender:2,frame,recipients:3,workers:2,gatewayRate:1,failure:2,dedupe:1,capacity:8,policy:1,idx:0,value:'sample-record'};
   data.trace=math.evaluate(scene.tableBindings[0].rowsExpr,scope);
   for(const [expr,fn] of compiled)assert.doesNotThrow(()=>fn.evaluate(scope),scene.id+': '+expr);
  }
 }
});

test('Kafka arrays show all records and highlight unread occurrences including replays',()=>{
 const lesson=JSON.parse(readFileSync(new URL('../../../scenes/draft/push-notification-system-design.json',import.meta.url),'utf8'));
 const arrays=[];
 function walk(o){if(!o||typeof o!=='object')return;if(o.type==='array'&&['source','delivery','inside-source','inside-delivery'].includes(o.id))arrays.push(o);for(const v of Object.values(o))if(typeof v==='object')walk(v);}
 walk(lesson);
 assert.equal(arrays.length,32);
 const math=create(all);
 const trace=api.dsTrace(...args(5,24,{recipients:6}));
 math.import({arrayCount:rows=>rows.length,dataTable:(_name,frame,column)=>trace[frame][column]},{override:true});
 for(const array of arrays){
  const source=array.id.endsWith('source'),store=source?'source':'delivery',position=source?'sourceConsumed':'deliveryConsumed';
  assert.equal(array.lengthExpr,`arrayCount(dataTable('trace', frame, '${store}'))`);
  assert.equal(array.valueExpr,`arrayAt(dataTable('trace', frame, '${store}'), idx)`);
  const highlighted=math.compile(array.highlightExpr);
  for(const frame of [2,3,4,5,7,12,13,24])for(let idx=0;idx<Math.min(3,trace[frame][store].length);idx++){
   assert.equal(highlighted.evaluate({frame,idx}),idx>=trace[frame][position],`${array.id}:${frame}:${idx}`);
  }
  if(array.id==='delivery'){
   // Every occurrence is retained; the replay stays unread until its own claim.
   assert.equal(trace[12].delivery[0],trace[12].delivery[6]);
   assert.equal(highlighted.evaluate({frame:12,idx:6}),true);
   assert.equal(highlighted.evaluate({frame:13,idx:6}),false);
  }
 }
});
