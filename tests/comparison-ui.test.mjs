import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel} from '../src/dsp.js';
async function harness(){
 const elements=new Map(),workers=[],sources=[],timers=[];
 function element(){const handlers=new Map();return {style:{setProperty(){}},children:[],dataset:{},checked:false,disabled:false,value:0,classList:{add(){},remove(){},contains(){return false;},toggle(){}},addEventListener(n,f){handlers.set(n,f);},fire(n){return handlers.get(n)?.({target:this});},setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},getBoundingClientRect(){return {width:0};}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const document={...element(),getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:element};
 const gain=()=>({value:1,setTargetAtTime(){},setValueAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
 const context={currentTime:0,resume:async()=>{},createGain:()=>({gain:gain(),connect(){},disconnect(){}}),createBuffer:(channels,length,sampleRate)=>({length,sampleRate,duration:length/sampleRate,copyToChannel(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){this.disconnected=true;},start(at,offset){this.offset=offset;},stop(){this.stopped=true;}};sources.push(s);return s;}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={document,window:element(),DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel,Worker,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:f=>{timers.push(f);return timers.length-1;},clearTimeout:i=>{timers[i]=null;},URL,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={applyPreset,applyRF,prepareMatch,cancelComparison,checkComparison,playFile,stopPlayback,switchMode,sendParams,setup(c){context=c;monitorGain=c.createGain();fileBuffer={sampleRate:48000,duration:1,length:48000};monoSamples=new Float32Array(48000).fill(.1);},ready(){return !!comparison;},get params(){return params;},get worker(){return comparisonWorker;},get playing(){return playing;},get pausedAt(){return pausedAt;},setWorklet(w){worklet=w;}};`,scope);
 scope.api.setup(context);return {...scope,get,workers,sources,timers,context};
}
const readyData=()=>({data:{dry:new Float32Array(64800),wet:new Float32Array(64800),dryGain:.5,wetGain:1}});
test('comparison cancellation and parameter changes reject stale worker replies',async()=>{
 const h=await harness();h.api.prepareMatch();const old=h.workers.at(-1);h.api.cancelComparison();old.onmessage(readyData());assert.equal(h.api.ready(),false);assert.ok(old.terminated);
 h.api.prepareMatch();const changed=h.workers.at(-1);h.api.params.output=30;h.api.checkComparison();changed.onmessage(readyData());assert.equal(h.api.ready(),false);assert.ok(changed.terminated);
 h.api.prepareMatch();h.api.params.mix=0;h.api.checkComparison();h.workers.at(-1).onmessage(readyData());assert.equal(h.api.ready(),true);
});
test('prepared A/B keeps offset, detaches old worklet, stops safely and isolates microphone mode',async()=>{
 const h=await harness();h.api.prepareMatch();await h.api.playFile();assert.equal(h.sources.length,0);
 let disconnected=false,closed=false;h.api.setWorklet({disconnect(){disconnected=true;},port:{postMessage(){},close(){closed=true;}}});h.workers.at(-1).onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));assert.ok(disconnected&&closed);h.context.currentTime=.4;h.get('dry').fire('click');await new Promise(resolve=>setImmediate(resolve));
 assert.ok(Math.abs(h.sources.at(-1).offset-.4)<1e-8);h.api.stopPlayback();assert.equal(h.api.playing,false);
 h.api.switchMode('mic');assert.equal(h.api.ready(),false);assert.equal(h.get('match-prepare').disabled,true);const count=h.workers.length;h.api.prepareMatch();assert.equal(h.workers.length,count);
});
test('rapid repeated toggles leave one active source and old async play cannot resume after stop',async()=>{
 const h=await harness();h.api.prepareMatch();h.workers.at(-1).onmessage(readyData());await h.api.playFile();
 h.context.currentTime=.25;h.get('dry').fire('click');h.get('wet').fire('click');h.api.stopPlayback();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.playing,false);
 assert.ok(h.sources.every(s=>s.stopped));
});

 test('automatic matched refresh preserves intent and position while rejecting stale renders',async()=>{
  const h=await harness();h.api.prepareMatch();h.workers.at(-1).onmessage(readyData());await h.api.playFile();h.context.currentTime=.45;
  h.api.params.drive=2.8;h.api.sendParams();assert.equal(h.api.playing,false);assert.equal(h.api.pausedAt,.45);assert.equal(h.api.ready(),false);
  for(const f of h.timers.splice(0))f?.();const obsolete=h.workers.at(-1);
  h.api.params.drive=3.3;h.api.sendParams();assert.ok(obsolete.terminated);obsolete.onmessage(readyData());assert.equal(h.api.ready(),false);
  for(const f of h.timers.splice(0))f?.();const latest=h.workers.at(-1);assert.equal(latest.sent.params.drive,3.3);latest.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.api.playing,true);assert.equal(h.sources.at(-1).offset,.45);
 });
 test('pause and stop during matched update never resume from a late result',async()=>{
  for(const action of ['pause','stop']){const h=await harness();h.api.prepareMatch();await h.api.playFile();const pending=h.workers.at(-1);
   if(action==='pause')await h.api.playFile();else h.get('stop').fire('click');
   pending.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.playing,false);assert.equal(h.sources.length,0);
  }
 });
 test('listening volume changes neither render parameters nor matched worker snapshot',async()=>{
  const h=await harness();h.api.prepareMatch();const pending=h.workers.at(-1),before=h.api.params.output;h.get('listen-volume').value=25;h.get('listen-volume').fire('input');
  assert.equal(h.api.params.output,before);assert.equal(h.api.worker,pending);assert.ok(!pending.terminated);pending.onmessage(readyData());assert.equal(h.api.ready(),true);
 });
 test('mode switch cancels pending matching and stale completion cannot start playback',async()=>{
  const h=await harness();h.api.prepareMatch();await h.api.playFile();const pending=h.workers.at(-1);h.api.switchMode('mic');pending.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.api.playing,false);assert.equal(h.api.ready(),false);assert.equal(h.get('export').disabled,true);assert.equal(h.get('file-transport').hidden,true);
 });

test('voice and RF profile changes refresh matched snapshots at the same position without changing take or other dimensions',async()=>{
 const h=await harness();h.api.params.cueLevel=28;h.api.params.drive=3;h.api.prepareMatch();const seed=h.workers.at(-1).sent.seed;h.workers.at(-1).onmessage(readyData());await h.api.playFile();h.context.currentTime=.37;
 h.api.applyPreset('patrol');assert.equal(h.api.pausedAt,.37);assert.equal(h.api.params.cueLevel,28);for(const f of h.timers.splice(0))f?.();const old=h.workers.at(-1);
 h.api.applyRF('fringe');assert.ok(old.terminated);for(const f of h.timers.splice(0))f?.();const next=h.workers.at(-1);assert.equal(next.sent.seed,seed);assert.equal(next.sent.params.highpass,TIMBRE_PROFILES.patrol.params.highpass);assert.equal(next.sent.params.quality,30);next.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.playing,true);assert.equal(h.sources.at(-1).offset,.37);
});

test('receiver monitor changes invalidate matched snapshots without autoplay and preserve source seed',async()=>{
 const h=await harness();h.api.prepareMatch();const seed=h.workers.at(-1).sent.seed;h.workers.at(-1).onmessage(readyData());h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');for(const f of h.timers.splice(0))f?.();const next=h.workers.at(-1);assert.equal(next.sent.params.fmMonitor,true);assert.equal(next.sent.seed,seed);next.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.playing,false);
});

test('propagation changes refresh matched snapshots at retained position with the same seed',async()=>{
 const h=await harness();h.api.prepareMatch();const seed=h.workers.at(-1).sent.seed;h.workers.at(-1).onmessage(readyData());await h.api.playFile();h.context.currentTime=.37;
 h.get('fm-propagation').value='moving';h.get('fm-propagation').fire('change');for(const f of h.timers.splice(0))f?.();const next=h.workers.at(-1);assert.equal(next.sent.params.fmPropagation,'moving');assert.equal(next.sent.seed,seed);next.onmessage(readyData());await new Promise(resolve=>setImmediate(resolve));assert.equal(h.api.playing,true);assert.equal(h.sources.at(-1).offset,.37);
});
