import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel} from '../src/dsp.js';
async function harness({cryptoAvailable=true}={}){
 let entropy=100;
 const elements=new Map(),workers=[],sources=[],processors=[],downloads=[];
 function element(id=''){const handlers=new Map(),classes=new Set();return {id,tagName:'DIV',style:{setProperty(){}},children:[],dataset:{},checked:false,disabled:false,value:0,classList:{add(x){classes.add(x);},remove(x){classes.delete(x);},contains(x){return classes.has(x);},toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},addEventListener(n,f){handlers.set(n,f);},fire(n){return handlers.get(n)?.({target:this,preventDefault(){}});},setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},getBoundingClientRect(){return {width:0};},click(){downloads.push(this.download);}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const document={...element(),getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:element};
 const gain=()=>({value:1,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
 const buffer=(duration=10)=>({sampleRate:48000,duration,length:duration*48000,numberOfChannels:1,getChannelData:()=>new Float32Array(duration*48000).fill(.1)});
 const context={currentTime:0,resume:async()=>{},close(){},createGain:()=>({gain:gain(),connect(){},disconnect(){}}),createBuffer:(channels,length,sampleRate)=>({length,sampleRate,duration:length/sampleRate,copyToChannel(){},getChannelData:()=>new Float32Array(length)}),createMediaStreamSource:()=>({connect(){},disconnect(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){this.disconnected=true;},start(at,offset){this.offset=offset;},stop(){this.stopped=true;}};sources.push(s);return s;}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
 class AudioWorkletNode{constructor(c,n,options){this.options=options;this.port={postMessage(message){this.lastMessage=message;},close(){}};processors.push(this);}connect(){}disconnect(){this.disconnected=true;}}
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={crypto:cryptoAvailable?{getRandomValues(a){a[0]=++entropy;return a;}}:undefined,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]})}},document,window:{...element(),isSecureContext:true},DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel,Worker,AudioWorkletNode,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(){return 1;},clearTimeout(){},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},Blob,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={controls,format,loadFile,createTakeSeed,demo,startMic,stopMic,prepareMatch,matchKey,checkComparison,ptt,get fileSeed(){return fileSeed;},get micSeed(){return micSeed;},applyPreset,applyRF,updateControls,playFile,stopPlayback,switchMode,setFile,exportWav,finishExport,setup(c,b){context=c;monitorGain=c.createGain();setFile(b,'original.wav');},get params(){return params;},get playing(){return playing;},get pausedAt(){return pausedAt;},get exportBusy(){return exportBusy;}};`,scope);
 scope.api.setup(context,buffer());return {...scope,get,workers,sources,processors,downloads,context,buffer};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('QA: voice profile preserves active processor, position and unrelated dimensions; paused selection stays paused',async()=>{
 const h=await harness();Object.assign(h.api.params,{perspective:'receiver',radio:'digital',quality:57,noise:29,squelch:23,cueLevel:31,tailMs:75,permit:'off',output:63,mix:0,vox:true,voxThreshold:-37});
 const before={...h.api.params};await h.api.playFile();h.context.currentTime=3.2;h.api.applyPreset('mini');await tick();
 assert.equal(h.api.playing,true);assert.equal(h.sources.length,1);assert.equal(h.processors.length,1);assert.ok(!h.sources[0].stopped);assert.ok(!h.processors[0].disconnected);
 for(const key of Object.keys(before))assert.equal(h.api.params[key],TIMBRE_KEYS.includes(key)?TIMBRE_PROFILES.mini.params[key]:before[key],key);
 assert.equal(h.processors[0].port.lastMessage.params.highpass,TIMBRE_PROFILES.mini.params.highpass);
 await h.api.playFile();const count=h.sources.length;h.api.applyPreset('patrol');await tick();assert.equal(h.sources.length,count);assert.equal(h.api.playing,false);assert.equal(h.api.pausedAt,3.2);
});
test('QA: modified status and reset track tone only; RF changes are isolated and operator RF is inert',async()=>{
 const h=await harness();h.api.params.radio='digital';h.api.params.cueLevel=24;h.api.applyRF('fringe');assert.equal(h.get('preset-state').textContent,'原始音色');
 for(const [key,value] of Object.entries(CHANNEL_PROFILES.fringe.params))assert.equal(h.api.params[key],value);
 h.api.params.drive=3;h.api.updateControls();assert.equal(h.get('preset-state').textContent,'音色已修改');h.get('reset').fire('click');assert.equal(h.get('preset-state').textContent,'原始音色');assert.equal(h.api.params.quality,30);assert.equal(h.api.params.radio,'digital');assert.equal(h.api.params.cueLevel,24);
 h.api.params.perspective='operator';h.api.updateControls();h.api.applyRF('stable');assert.equal(h.api.params.quality,30);for(const id of ['quality','noise','squelch'])assert.equal(h.get(id).disabled,true);
});
test('QA: rapid profile selection then source-mode switch cannot start old file audio',async()=>{
 const h=await harness();await h.api.playFile();h.context.currentTime=2;h.api.applyPreset('mini');h.api.applyPreset('patrol');h.api.switchMode('mic');await tick();
 assert.equal(h.api.playing,false);assert.ok(h.sources.every(s=>s.stopped));assert.equal(h.get('export').disabled,true);assert.equal(h.get('file-transport').hidden,true);
});
test('QA: replacing source cancels pending export and labels new source',async()=>{
 const h=await harness();h.api.exportWav();const old=h.workers.at(-1);h.api.setFile(h.buffer(2),'replacement.wav');assert.ok(old.terminated);assert.equal(h.api.exportBusy,false);assert.match(h.get('export-source').textContent,/replacement.wav/);
});
test('QA: cancelled export replies cannot download or cancel a newer export',async()=>{
 const h=await harness();h.api.exportWav();const old=h.workers.at(-1);h.api.finishExport();h.api.exportWav();const fresh=h.workers.at(-1);
 old.onmessage({data:{buffer:new ArrayBuffer(44)}});
 assert.equal(h.downloads.length,0);assert.equal(h.api.exportBusy,true);assert.ok(!fresh.terminated);
 h.api.switchMode('mic');fresh.onmessage({data:{buffer:new ArrayBuffer(44)}});assert.equal(h.downloads.length,0);
});

test('take seed stays stable across file replay, voice profile selection, matching and export',async()=>{
 const h=await harness(),seed=h.api.fileSeed;assert.equal(seed,101);
 await h.api.playFile();assert.equal(h.processors.at(-1).options.processorOptions.seed,seed);
 h.api.stopPlayback();await h.api.playFile();assert.equal(h.processors.at(-1).options.processorOptions.seed,seed);
 h.context.currentTime=2;h.api.applyPreset('mini');await tick();assert.equal(h.sources.at(-1).offset,0);assert.ok(!h.sources.at(-1).stopped);assert.equal(h.processors.at(-1).options.processorOptions.seed,seed);
 h.api.prepareMatch();assert.equal(h.workers.at(-1).sent.seed,seed);h.api.exportWav();assert.equal(h.workers.at(-1).sent.seed,seed);
 assert.equal(JSON.parse(h.api.matchKey()).seed,seed);
});
test('source replacement and a newly generated demo renew seed and reject stale matching',async()=>{
 const h=await harness(),seed=h.api.fileSeed;h.api.prepareMatch();const old=h.workers.at(-1),key=h.api.matchKey();
 h.api.setFile(h.buffer(1),'next.wav');assert.notEqual(h.api.fileSeed,seed);assert.notEqual(h.api.matchKey(),key);assert.ok(old.terminated);
 old.onmessage({data:{dry:new Float32Array(48000),wet:new Float32Array(48000),dryGain:1,wetGain:1}});
 assert.notEqual(h.get('match-status').textContent,'匹配就绪');
 const next=h.api.fileSeed;await h.api.demo();assert.notEqual(h.api.fileSeed,next);
});
test('each microphone session renews seed while PTT, parameter edits, and file return preserve correct scope',async()=>{
 const h=await harness(),fileSeed=h.api.fileSeed;h.api.switchMode('mic');await h.api.startMic();
 const first=h.api.micSeed,processor=h.processors.at(-1);assert.equal(processor.options.processorOptions.seed,first);assert.equal(h.get('monitor').checked,false);
 h.api.ptt(true);h.api.ptt(false);h.api.applyPreset('dispatch');assert.equal(h.api.micSeed,first);assert.equal(h.processors.at(-1),processor);
 h.api.stopMic();await h.api.startMic();assert.notEqual(h.api.micSeed,first);assert.equal(h.get('monitor').checked,false);
 h.api.switchMode('file');assert.equal(h.api.fileSeed,fileSeed);await h.api.playFile();assert.equal(h.processors.at(-1).options.processorOptions.seed,fileSeed);
});
test('take seed fallback remains usable without browser crypto',async()=>{
 const h=await harness({cryptoAvailable:false});for(let i=0;i<10;i++){const seed=h.api.createTakeSeed();assert.ok(Number.isInteger(seed)&&seed>0&&seed<=0xffffffff);}
});

test('obsolete file decode cannot replace current take or consume a seed',async()=>{
 const h=await harness();let finishOld;
 h.context.decodeAudioData=bytes=>bytes==='old'?new Promise(resolve=>{finishOld=resolve;}):Promise.resolve(h.buffer(1));
 const old=h.api.loadFile({size:1,name:'old.wav',arrayBuffer:async()=> 'old'});await tick();
 await h.api.loadFile({size:1,name:'new.wav',arrayBuffer:async()=> 'new'});const seed=h.api.fileSeed;
 finishOld(h.buffer(2));await old;assert.equal(h.api.fileSeed,seed);assert.equal(seed,102);assert.equal(h.get('file-name').textContent,'new.wav');
});
test('obsolete microphone permission result stops its tracks without changing session seed',async()=>{
 const h=await harness();let finishOld,stopped=false;
 h.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{finishOld=resolve;});
 h.api.switchMode('mic');const old=h.api.startMic();await tick();h.api.stopMic();
 h.navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]});await h.api.startMic();const seed=h.api.micSeed;
 finishOld({getTracks:()=>[{stop(){stopped=true;}}]});await old;
 assert.ok(stopped);assert.equal(h.api.micSeed,seed);assert.equal(seed,102);assert.equal(h.processors.length,1);assert.equal(h.get('monitor').checked,false);
});

test('all profile slider values are exactly representable and display without losing precision',async()=>{
 const h=await harness();for(const [profile,p] of Object.entries(TIMBRE_PROFILES))for(const group of h.api.controls)for(const [key,,min,max,step,unit] of group.items){
  if(!(key in p.params))continue;const value=p.params[key];assert.ok(value>=min&&value<=max,`${profile}.${key} range`);const steps=(value-min)/step;assert.ok(Math.abs(steps-Math.round(steps))<1e-8,`${profile}.${key} must align to slider step`);assert.equal(parseFloat(h.api.format(value,unit)),value,`${profile}.${key} display`);
 }
 assert.equal(h.api.format(1.15,'×'),'1.15×');assert.equal(h.api.format(1.8,'dB'),'1.8 dB');
});
