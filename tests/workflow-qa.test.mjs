import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import { OUTPUT_FADE_SECONDS, outputFadeSamples } from '../src/output-boundary.js';
import {DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel} from '../src/dsp.js';
async function harness({cryptoAvailable=true,fetchImpl}={}){
 let entropy=100;
 const elements=new Map(),workers=[],sources=[],processors=[],downloads=[],timers=[],gains=[];
 function element(id=''){const handlers=new Map(),classes=new Set();return {id,tagName:'DIV',style:{setProperty(){}},children:[],dataset:{},checked:false,disabled:false,value:0,classList:{add(x){classes.add(x);},remove(x){classes.delete(x);},contains(x){return classes.has(x);},toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},addEventListener(n,f){handlers.set(n,f);},fire(n,event={}){return handlers.get(n)?.({target:this,preventDefault(){},...event});},setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},getBoundingClientRect(){return {width:0};},click(){downloads.push(this.download);}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const document={...element(),getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:element};
 const gain=()=>({value:1,events:[],setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);},setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);},cancelScheduledValues(t){this.events.push(['cancel',t]);},linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);}});
 const buffer=(duration=10)=>({sampleRate:48000,duration,length:duration*48000,numberOfChannels:1,getChannelData:()=>new Float32Array(duration*48000).fill(.1)});
 const context={sampleRate:48000,audioWorklet:{addModule:async()=>{}},currentTime:0,resume:async()=>{},close(){},createGain:()=>{const node={gain:gain(),connect(){},disconnect(){this.disconnected=true;}};gains.push(node);return node;},createBuffer:(channels,length,sampleRate)=>({length,sampleRate,duration:length/sampleRate,copyToChannel(){},getChannelData:()=>new Float32Array(length)}),createMediaStreamSource:()=>({connect(){},disconnect(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){this.disconnected=true;},start(at,offset){this.startAt=at;this.offset=offset;},stop(at){this.stopAt=at;this.stopped=true;}};sources.push(s);return s;}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
 class AudioWorkletNode{constructor(c,n,options){this.options=options;this.port={postMessage(message){this.lastMessage=message;},close(){this.closed=true;}};processors.push(this);}connect(){}disconnect(){this.disconnected=true;}}
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={OUTPUT_FADE_SECONDS,outputFadeSamples,fetch:fetchImpl,AbortController,crypto:cryptoAvailable?{getRandomValues(a){a[0]=++entropy;return a;}}:undefined,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]})}},document,window:{...element(),isSecureContext:true},DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel,Worker,AudioWorkletNode,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(fn,ms){timers.push({fn,ms});return timers.length-1;},clearTimeout(id){if(timers[id])timers[id].cancelled=true;},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},Blob,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={controls,format,cnrLabel,meter,calibrateInput,undoInputCalibration,ensureAudio,resetContext(){context=null;initPromise=null;},loadFile,createTakeSeed,demo,humanDemo,startMic,stopMic,prepareMatch,matchKey,checkComparison,ptt,get fileSeed(){return fileSeed;},get micSeed(){return micSeed;},applyPreset,applyRF,updateControls,playFile,stopPlayback,switchMode,setFile,exportWav,finishExport,setup(c,b){context=c;monitorGain=c.createGain();setFile(b,'original.wav');},get params(){return params;},get playing(){return playing;},get pausedAt(){return pausedAt;},get exportBusy(){return exportBusy;}};`,scope);
 scope.api.setup(context,buffer());return {...scope,get,workers,sources,processors,downloads,timers,gains,context,buffer};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('QA: voice profile preserves active processor, position and unrelated dimensions; paused selection stays paused',async()=>{
 const h=await harness();Object.assign(h.api.params,{perspective:'receiver',radio:'digital',quality:57,noise:29,squelch:23,cueLevel:31,tailMs:75,permit:'off',output:63,mix:0,vox:true,voxThreshold:-37});
 const before={...h.api.params};await h.api.playFile();h.context.currentTime=3.2;h.api.applyPreset('patrol');await tick();
 assert.equal(h.api.playing,true);assert.equal(h.sources.length,1);assert.equal(h.processors.length,1);assert.ok(!h.sources[0].stopped);assert.ok(!h.processors[0].disconnected);
 for(const key of Object.keys(before))assert.equal(h.api.params[key],TIMBRE_KEYS.includes(key)?TIMBRE_PROFILES.patrol.params[key]:before[key],key);
 assert.equal(h.processors[0].port.lastMessage.params.highpass,TIMBRE_PROFILES.patrol.params.highpass);
 await h.api.playFile();const count=h.sources.length;h.api.applyPreset('patrol');await tick();assert.equal(h.sources.length,count);assert.equal(h.api.playing,false);assert.equal(h.api.pausedAt,3.2);
});
test('QA: modified status and reset track tone only; RF changes are isolated and operator RF is inert',async()=>{
 const h=await harness();h.api.params.radio='digital';h.api.params.cueLevel=24;h.api.applyRF('fringe');assert.equal(h.get('preset-state').textContent,'默认基线 · 未校准');
 for(const [key,value] of Object.entries(CHANNEL_PROFILES.fringe.params))assert.equal(h.api.params[key],value);
 h.api.params.drive=3;h.api.updateControls();assert.equal(h.get('preset-state').textContent,'基线已调整 · 未校准');h.get('reset').fire('click');assert.equal(h.get('preset-state').textContent,'默认基线 · 未校准');assert.equal(h.api.params.quality,30);assert.equal(h.api.params.radio,'digital');assert.equal(h.api.params.cueLevel,24);
 h.api.params.perspective='operator';h.api.updateControls();h.api.applyRF('stable');assert.equal(h.api.params.quality,30);for(const id of ['quality','noise','squelch'])assert.equal(h.get(id).disabled,true);
});
test('QA: rapid profile selection then source-mode switch cannot start old file audio',async()=>{
 const h=await harness();await h.api.playFile();h.context.currentTime=2;h.api.applyPreset('patrol');h.api.applyPreset('patrol');h.api.switchMode('mic');await tick();
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
 h.context.currentTime=2;h.api.applyPreset('patrol');await tick();assert.equal(h.sources.at(-1).offset,0);assert.ok(!h.sources.at(-1).stopped);assert.equal(h.processors.at(-1).options.processorOptions.seed,seed);
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
 h.api.ptt(true);h.api.ptt(false);h.api.applyPreset('patrol');assert.equal(h.api.micSeed,first);assert.equal(h.processors.at(-1),processor);
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

test('QA: display describes actual listening path and sidetone suppresses remote RF reading',async()=>{
 const h=await harness();h.api.updateControls();assert.equal(h.get('screen-preset').textContent,'实验性 FM 接收');assert.equal(h.get('channel').textContent,'RX');
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('screen-preset').textContent,'数字式接收近似');assert.equal(h.get('radio-screen').textContent,'NO VOCODER');
 h.api.params.perspective='operator';h.api.updateControls();assert.equal(h.get('screen-preset').textContent,'本机侧音');assert.equal(h.get('channel').textContent,'LOCAL');assert.equal(h.get('quality-screen').textContent,'—');assert.equal(h.get('radio-screen').textContent,'LOCAL AUDIO APPROX.');assert.match(h.get('radio-help').textContent,/不经过远端 FM/);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(status=200)=>({ok:status===200,status,arrayBuffer:async()=>new ArrayBuffer(8)});
test('QA: human demo uses bundled source, creates one take seed and never autoplays',async()=>{
 const requests=[];const h=await harness({fetchImpl:async(url,options)=>{requests.push({url:String(url),options});return response();}});
 h.context.decodeAudioData=async()=>h.buffer(10.315);const seed=h.api.fileSeed;await h.api.humanDemo('slt');
 assert.match(requests[0].url,/\/assets\/speech\/clean-human-slt-a0001-a0003.wav$/);assert.ok(requests[0].options.signal);assert.notEqual(h.api.fileSeed,seed);assert.equal(h.api.playing,false);assert.match(h.get('file-name').textContent,/CMU ARCTIC SLT/);assert.equal(h.get('cancel-demo').hidden,true);
 const current=h.api.fileSeed;h.api.applyPreset('patrol');h.api.exportWav();assert.equal(h.api.fileSeed,current);assert.equal(h.workers.at(-1).sent.seed,current);
});
test('QA: missing demo asset, network and decode errors keep the previous file recoverable',async()=>{
 for(const kind of ['http','network','decode']){
  const h=await harness({fetchImpl:async()=>{if(kind==='network')throw Error('offline');return response(kind==='http'?404:200);}});h.context.decodeAudioData=async()=>{throw Error('invalid WAV');};const seed=h.api.fileSeed;
  await h.api.humanDemo('bdl');assert.match(h.get('status-text').textContent,/载入失败/);assert.equal(h.get('file-name').textContent,'original.wav');assert.equal(h.api.fileSeed,seed);assert.equal(h.get('play').disabled,false);assert.equal(h.get('cancel-demo').hidden,true);
 }
});
test('QA: cancel and source-mode switch abort human fetch and ignore late completion',async()=>{
 for(const action of ['cancel','mic']){
  const pending=deferred();let signal;const h=await harness({fetchImpl:async(url,options)=>{signal=options.signal;return pending.promise;}});h.context.decodeAudioData=async()=>h.buffer();const seed=h.api.fileSeed;
  const load=h.api.humanDemo('slt');await tick();if(action==='cancel')h.get('cancel-demo').fire('click');else h.api.switchMode('mic');assert.equal(signal.aborted,true);
  pending.resolve(response());await load;assert.equal(h.api.fileSeed,seed);assert.equal(h.get('file-name').textContent,'original.wav');assert.equal(h.api.playing,false);assert.equal(h.get('cancel-demo').hidden,true);
 }
});
test('QA: latest human demo wins and late decoding cannot replace a local import',async()=>{
 const first=deferred();let requests=0;const h=await harness({fetchImpl:async()=>++requests===1?first.promise:response()});h.context.decodeAudioData=async()=>h.buffer();
 const old=h.api.humanDemo('slt');await tick();await h.api.humanDemo('bdl');const seed=h.api.fileSeed;first.resolve(response());await old;assert.match(h.get('file-name').textContent,/BDL/);assert.equal(h.api.fileSeed,seed);
 const decoding=deferred();h.context.decodeAudioData=()=>decoding.promise;const pending=h.api.humanDemo('slt');await tick();h.context.decodeAudioData=async()=>h.buffer(3);await h.api.loadFile({name:'local.wav',size:8,arrayBuffer:async()=>new ArrayBuffer(8)});const localSeed=h.api.fileSeed;
 decoding.resolve(h.buffer());await pending;assert.equal(h.get('file-name').textContent,'local.wav');assert.equal(h.api.fileSeed,localSeed);
});

test('QA: analog FM fixed-chain controls are visibly inactive and other paths regain their parameters',async()=>{
 const h=await harness();h.api.updateControls();for(const key of ['highpass','lowpass','drive','compression','emphasis','leveler','noise','cueLevel'])assert.equal(h.get(key).disabled,true,key);
 assert.match(h.get('rf-help').textContent,/35.2 dB/);assert.match(h.get('band-screen').textContent,/固定/);assert.match(h.get('parameter-help').textContent,/灰色旧参数不参与/);
 h.api.params.quality=100;h.api.updateControls();assert.match(h.get('rf-help').textContent,/无噪声极限/);
 h.api.params.radio='digital';h.api.updateControls();for(const key of ['highpass','lowpass','drive','compression','emphasis','noise'])assert.equal(h.get(key).disabled,false,key);
 h.api.params.perspective='operator';h.api.updateControls();assert.equal(h.get('noise').disabled,true);assert.equal(h.get('cueLevel').disabled,false);
});

test('QA: closed receiver squelch is distinguished from continued transmission',async()=>{
 const h=await harness();await h.api.playFile();h.api.meter({input:.1,output:0,signal:30,carrier:false,transmitting:true,fmRxOpen:false});
 assert.equal(h.get('carrier-text').textContent,'自动静噪·已静音');assert.match(h.get('receiver-status').textContent,/发射仍在进行/);assert.equal(h.api.playing,true);
 h.api.meter({input:.1,output:.1,signal:90,carrier:true,transmitting:true,fmRxOpen:true});assert.equal(h.get('carrier-text').textContent,'接收');assert.match(h.get('receiver-status').textContent,/自动静噪已放行/);
 h.api.meter({input:0,output:0,signal:90,carrier:false,transmitting:false});assert.equal(h.get('carrier-text').textContent,'待机');
});

test('QA: engine requests interactive 48 kHz and discloses actual fallback rate',async()=>{
 for(const fallback of [false,true]){
  const h=await harness(),calls=[];h.context.sampleRate=fallback?192000:48000;h.window.AudioContext=function(options){calls.push(options);if(fallback&&calls.length===1){const e=Error('unsupported rate');e.name='NotSupportedError';throw e;}return h.context;};h.api.resetContext();await h.api.ensureAudio();
  assert.equal(calls[0].sampleRate,48000);assert.equal(calls[0].latencyHint,'interactive');assert.equal(calls.length,fallback?2:1);assert.match(h.get('engine-rate').textContent,fallback?/192.0 kHz.*可能无法稳定/:/48.0 kHz/);
 }
});

test('QA: receiver open-squelch is explicit, reversible and never starts audio or microphone monitoring',async()=>{
 const h=await harness();h.api.updateControls();assert.equal(h.get('fm-monitor').value,'auto');assert.equal(h.get('fm-monitor').disabled,false);assert.match(h.get('fm-monitor-help').textContent,/先降低试听音量/);
 const seed=h.api.fileSeed;h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.api.playing,false);assert.equal(h.sources.length,0);assert.equal(h.get('monitor').checked,false);assert.equal(h.api.fileSeed,seed);assert.equal(h.get('squelch').disabled,true);
 await h.api.playFile();h.api.meter({input:.1,output:.1,signal:35,transmitting:true,carrier:false,fmRxOpen:true,fmMonitorActive:true});assert.equal(h.get('carrier-text').textContent,'持续开放');assert.match(h.get('receiver-status').textContent,/持续开放接收/);assert.equal(h.get('quality-screen').textContent,'8.8 dB');assert.equal(h.get('quality-value').textContent,'35.2 dB');
 h.get('fm-monitor').value='auto';h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,false);assert.equal(h.get('squelch').disabled,false);assert.equal(h.get('monitor').checked,false);
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('fm-monitor').disabled,true);h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,false);
});
test('QA: near-threshold shortcut exposes C/N and preserves explicit squelch-monitor choice',async()=>{
 const h=await harness();h.api.applyRF('varying');assert.equal(h.api.params.quality,35);assert.equal(h.get('quality-value').textContent,'8.8 dB');assert.equal(h.get('quality-screen').textContent,'8.8 dB');assert.equal(h.get('fm-monitor').value,'auto');
 h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');h.api.applyRF('stable');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.get('quality-value').textContent,'无噪声');
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('quality-value').textContent,'100%');h.api.params.perspective='operator';h.api.updateControls();assert.equal(h.get('quality-screen').textContent,'—');
});

test('QA: receiver-monitor toggle during held PTT preserves transmission and keeps headphones off',async()=>{
 const h=await harness();h.api.switchMode('mic');await h.api.startMic();h.api.ptt(true);const processor=h.processors.at(-1);assert.equal(processor.port.lastMessage.params.tx,true);
 h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');assert.equal(processor.port.lastMessage.params.tx,true);assert.equal(processor.port.lastMessage.params.fmMonitor,true);assert.equal(h.get('monitor').checked,false);assert.equal(h.get('ptt').classList.contains('transmitting'),true);
 h.api.ptt(false);assert.equal(processor.port.lastMessage.params.tx,false);assert.equal(h.get('monitor').checked,false);
});

test('QA: live C/N label uses the same noiseless threshold as the FM model',async()=>{
 const h=await harness();assert.equal(h.api.cnrLabel(99.999),'无噪声');assert.equal(h.api.cnrLabel(99.998),'40.0 dB');assert.equal(h.api.cnrLabel(35),'8.8 dB');
});

test('QA: propagation is opt-in, retains source/channel/monitor and is disabled outside analog reception',async()=>{
 const h=await harness();h.api.updateControls();assert.equal(h.get('fm-propagation').value,'static');const seed=h.api.fileSeed;h.api.applyRF('varying');h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');
 h.get('fm-propagation').value='moving';h.get('fm-propagation').fire('change');assert.equal(h.api.params.fmPropagation,'moving');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.api.params.quality,35);assert.equal(h.api.fileSeed,seed);assert.equal(h.api.playing,false);assert.equal(h.get('monitor').checked,false);assert.match(h.get('quality-label').textContent,/平均/);assert.match(h.get('propagation-help').textContent,/重启该段信道状态/);
 await h.api.playFile();h.api.meter({input:.1,output:.1,signal:35,transmitting:true,fmRxOpen:true,fmMonitorActive:true,fmInstantCnrDb:4.3});assert.equal(h.get('rf-meter-label').textContent,'LIVE C/N');assert.equal(h.get('quality-screen').textContent,'4.3 dB');assert.equal(h.get('channel-state').textContent,'瞬时模型 C/N：4.3 dB');
 h.get('fm-propagation').value='static';h.get('fm-propagation').fire('change');assert.equal(h.api.params.fmPropagation,'static');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.get('channel-state').hidden,true);
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('fm-propagation').disabled,true);h.get('fm-propagation').value='moving';h.get('fm-propagation').fire('change');assert.equal(h.api.params.fmPropagation,'static');assert.match(h.get('propagation-help').textContent,/绕过此设置/);
});

test('QA: moving main signal bars follow instantaneous telemetry while mean slider stays fixed',async()=>{
 const h=await harness();h.api.params.fmPropagation='moving';h.api.params.quality=35;h.api.updateControls();assert.equal(h.get('quality-screen').textContent,'—');await h.api.playFile();
 const report=cnr=>h.api.meter({input:.1,output:.1,signal:35,transmitting:true,fmRxOpen:true,fmInstantCnrDb:cnr});
 report(-8);assert.equal(h.get('quality-screen').textContent,'-8.0 dB');assert.equal(h.get('signal-bars').children.filter(x=>x.classList.contains('on')).length,0);assert.equal(h.get('quality-value').textContent,'8.8 dB');
 report(16);assert.equal(h.get('quality-screen').textContent,'16.0 dB');assert.equal(h.get('signal-bars').children.filter(x=>x.classList.contains('on')).length,6);assert.equal(h.api.params.quality,35);assert.equal(h.get('quality-value').textContent,'8.8 dB');
 report(Infinity);assert.equal(h.get('quality-screen').textContent,'无噪声');assert.equal(h.get('signal-bars').children.filter(x=>x.classList.contains('on')).length,12);
 h.api.meter({input:0,output:0,signal:35,transmitting:false,fmRxOpen:false,fmInstantCnrDb:16});assert.equal(h.get('quality-screen').textContent,'—');assert.equal(h.get('signal-bars').children.filter(x=>x.classList.contains('on')).length,0);
});

test('QA: transmitter controls stay opt-in and use actual model deviation telemetry',async()=>{
 const h=await harness();h.api.updateControls();assert.equal(h.get('txInputGainDb').value,0);assert.equal(h.get('tx-mic-agc').checked,false);assert.match(h.get('tx-input-help').textContent,/未校准假设/);const seed=h.api.fileSeed;
 h.get('txInputGainDb').value=12;h.get('txInputGainDb').fire('input');h.get('tx-mic-agc').checked=true;h.get('tx-mic-agc').fire('change');assert.equal(h.api.params.txInputGainDb,12);assert.equal(h.api.params.txMicAgc,true);assert.equal(h.api.playing,false);assert.equal(h.get('monitor').checked,false);assert.equal(h.api.fileSeed,seed);
 await h.api.playFile();h.api.meter({input:.1,output:.1,signal:90,transmitting:true,fmRxOpen:true,txDeviationPeakHz:1500});assert.equal(h.get('tx-deviation-value').textContent,'1.50 kHz');assert.equal(h.get('tx-deviation-meter').style.width,'60%');assert.match(h.get('tx-deviation-help').textContent,/实际峰值/);
 h.api.meter({input:0,output:0,signal:90,transmitting:false,txDeviationPeakHz:2500});assert.equal(h.get('tx-deviation-value').textContent,'—');assert.equal(h.get('tx-deviation-meter').style.width,'0%');
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('txInputGainDb').disabled,true);assert.equal(h.get('tx-mic-agc').disabled,true);assert.match(h.get('tx-input-help').textContent,/当前路径不使用/);assert.equal(h.get('tx-deviation-value').textContent,'—');
});

const calibrationResult=(gainDb=12.88)=>({data:{proposal:{gainDb,levelDbov:-20.4,bounded:false,p56Conformant:false}}});
test('QA: explicit calibration pauses, updates only TX gain, leaves AGC/A/output untouched and supports undo',async()=>{
 const h=await harness();h.api.params.txInputGainDb=3;h.api.params.txMicAgc=true;h.api.params.output=41;h.api.params.mix=0;const seed=h.api.fileSeed;await h.api.playFile();h.context.currentTime=2.1;h.api.calibrateInput();const job=h.workers.at(-1);assert.equal(h.api.playing,false);assert.equal(h.api.pausedAt,2.1);assert.equal(h.get('calibrate-input').disabled,true);
 job.onmessage(calibrationResult());assert.equal(h.api.params.txInputGainDb,12.88);assert.equal(h.api.params.txMicAgc,true);assert.equal(h.api.params.output,41);assert.equal(h.api.params.mix,0);assert.equal(h.api.fileSeed,seed);assert.equal(h.api.playing,false);assert.equal(h.get('txInputGainDb-value').textContent,'+12.88 dB');assert.match(h.get('calibration-status').textContent,/AGC 仍开启/);assert.equal(h.get('undo-calibration').hidden,false);
 h.api.undoInputCalibration();assert.equal(h.api.params.txInputGainDb,3);assert.equal(h.get('undo-calibration').hidden,true);assert.equal(h.get('monitor').checked,false);
});
test('QA: calibration cancellation, failure, stale source and newer manual gain never overwrite current settings',async()=>{
 for(const action of ['cancel','source','manual','mode','error']){
  const h=await harness();h.api.params.txInputGainDb=2;h.api.calibrateInput();const job=h.workers.at(-1);
  if(action==='cancel')h.get('cancel-calibration').fire('click');if(action==='source')h.api.setFile(h.buffer(2),'new.wav');if(action==='manual'){h.get('txInputGainDb').value=7;h.get('txInputGainDb').fire('input');}if(action==='mode')h.api.switchMode('mic');
  if(action==='error')job.onerror({message:'worker failed'});job.onmessage(calibrationResult());assert.equal(h.api.params.txInputGainDb,action==='manual'?7:2,action);assert.equal(h.get('cancel-calibration').hidden,true);assert.equal(h.api.playing,false);
 }
});
test('QA: clearly labeled nominal demos set visible verified gain without modifying A or starting audio',async()=>{
 const h=await harness({fetchImpl:async()=>response()});h.context.decodeAudioData=async()=>h.buffer();h.api.params.mix=0;h.api.params.txMicAgc=true;const output=h.api.params.output;
 await h.api.humanDemo('bdl');assert.equal(h.api.params.txInputGainDb,12.88);assert.equal(h.get('txInputGainDb-value').textContent,'+12.88 dB');assert.match(h.get('calibration-status').textContent,/示例标称输入/);assert.equal(h.api.params.mix,0);assert.equal(h.api.params.txMicAgc,true);assert.equal(h.api.params.output,output);assert.equal(h.api.playing,false);
 await h.api.humanDemo('slt');assert.equal(h.api.params.txInputGainDb,9.64);assert.equal(h.get('txInputGainDb-value').textContent,'+9.64 dB');h.api.undoInputCalibration();assert.equal(h.api.params.txInputGainDb,12.88);
 await h.api.loadFile({name:'my-file.wav',size:8,arrayBuffer:async()=>new ArrayBuffer(8)});assert.equal(h.api.params.txInputGainDb,12.88);assert.equal(h.get('undo-calibration').hidden,true);
});
test('QA: manual gain adjustment while nominal demo loads wins over delayed demo default',async()=>{
 const pending=deferred();const h=await harness({fetchImpl:async()=>pending.promise});h.context.decodeAudioData=async()=>h.buffer();const loading=h.api.humanDemo('bdl');await tick();h.get('txInputGainDb').value=-2;h.get('txInputGainDb').fire('input');pending.resolve(response());await loading;assert.equal(h.api.params.txInputGainDb,-2);assert.match(h.get('calibration-status').textContent,/保留载入期间手动设置/);
});


test('receiver session stays open across keyboard PTT release, blur, rekey and RF edits without touching headphones',async()=>{
 const h=await harness();h.api.switchMode('mic');await h.api.startMic();const p=h.processors.at(-1);
 assert.equal(p.options.processorOptions.params.receiverActive,false);
 h.get('fm-monitor').value='open';h.get('fm-monitor').fire('change');assert.equal(p.port.lastMessage.params.receiverActive,false);assert.equal(h.get('monitor').checked,false);
 h.get('monitor').checked=true;h.get('monitor').fire('change');assert.equal(p.port.lastMessage.params.receiverActive,true);
 for(const release of ['keyup','blur']){
  h.document.fire('keydown',{code:'Space',repeat:false});assert.equal(p.port.lastMessage.params.tx,true);assert.equal(p.port.lastMessage.params.receiverActive,true);
  (release==='blur'?h.window:h.document).fire(release,{code:'Space'});assert.equal(p.port.lastMessage.params.tx,false);assert.equal(p.port.lastMessage.params.receiverActive,true);
 }
 h.document.fire('keydown',{code:'Space',repeat:false});h.api.applyRF('fringe');assert.equal(p.port.lastMessage.params.tx,true);assert.equal(p.port.lastMessage.params.receiverActive,true);
 h.get('radio').value='digital';h.get('radio').fire('change');assert.equal(p.port.lastMessage.params.tx,false);assert.equal(h.get('monitor').checked,true);
 h.get('radio').value='analog';h.get('radio').fire('change');assert.equal(p.port.lastMessage.params.receiverActive,true);
 h.get('monitor').checked=false;h.get('monitor').fire('change');assert.equal(p.port.lastMessage.params.receiverActive,false);assert.equal(p.disconnected,undefined);
 h.api.ptt(true);h.get('dry').fire('click');assert.equal(p.port.lastMessage.params.tx,true);assert.equal(p.port.lastMessage.params.mix,0);assert.equal(p.port.lastMessage.params.receiverActive,false);
});

test('microphone Stop, hidden page, pagehide and source switch stop fake hardware; restart needs explicit monitoring',async()=>{
 for(const action of ['stop','hidden','pagehide','mode']){
  const h=await harness();let stops=0,opens=0;h.navigator.mediaDevices.getUserMedia=async()=>{opens++;return {getTracks:()=>[{stop(){stops++;},addEventListener(){}}]};};
  h.api.switchMode('mic');await h.api.startMic();h.get('monitor').checked=true;h.get('monitor').fire('change');h.api.ptt(true);const p=h.processors.at(-1);
  if(action==='stop')h.api.stopMic();if(action==='hidden'){h.document.hidden=true;h.document.fire('visibilitychange');}if(action==='pagehide')h.window.fire('pagehide');if(action==='mode')h.api.switchMode('file');
  assert.equal(stops,1,action);assert.equal(h.get('monitor').checked,false);assert.equal(h.get('ptt').disabled,true);assert.equal(p.disconnected,true);
  if(action!=='pagehide'){h.document.hidden=false;if(action==='mode')h.api.switchMode('mic');assert.equal(opens,1);await h.api.startMic();assert.equal(opens,2);assert.equal(h.get('monitor').checked,false);assert.equal(h.processors.at(-1).port.lastMessage.params.receiverActive,false);}
 }
});

test('file natural end schedules a fixed audio-clock envelope before onended and only cleans up after silence',async()=>{
 const h=await harness();h.api.params.fmMonitor=true;await h.api.playFile();const processor=h.processors.at(-1),gain=h.gains.at(-1).gain;
 const ramp=gain.events.find(e=>e[0]==='ramp');assert.deepEqual(ramp,['ramp',0,(480000+16800-1)/48000]);
 assert.ok(gain.events.some(e=>e[0]==='set'&&e[1]===1&&e[2]===10.34));
 // onended may arrive late; it must neither extend nor reapply the envelope.
 h.context.currentTime=10.12;h.sources.at(-1).onended();
 assert.equal(processor.port.lastMessage.params.tx,false);assert.equal(processor.port.lastMessage.params.receiverActive,true);assert.equal(h.get('stop').disabled,false);
 const timer=h.timers.at(-1);assert.ok(Math.abs(timer.ms-230)<1e-8);h.context.currentTime=10.349;timer.fn();assert.equal(processor.disconnected,undefined);
 h.context.currentTime=10.35;h.timers.at(-1).fn();assert.equal(processor.disconnected,true);assert.equal(processor.port.closed,true);assert.equal(h.get('stop').disabled,true);
 assert.equal(gain.events.filter(e=>e[0]==='ramp').length,1);
});

test('Stop, pause, hidden page, new file and route changes fade only the retiring file graph',async()=>{
 for(const action of ['stop','pause','hide','replace','route','mode']){
  const h=await harness();await h.api.playFile();h.context.currentTime=2;
  const old=h.processors.at(-1),oldSource=h.sources.at(-1),oldGain=h.gains.at(-1),monitor=h.gains[0];
  const monitorEvents=monitor.gain.events.length;
  if(action==='stop')h.get('stop').fire('click');
  if(action==='pause')await h.api.playFile();
  if(action==='hide'){h.document.hidden=true;h.document.fire('visibilitychange');}
  if(action==='replace')h.api.setFile(h.buffer(2),'replacement.wav');
  if(action==='route'){h.get('perspective').value='operator';h.get('perspective').fire('change');await tick();}
  if(action==='mode')h.api.switchMode('mic');
  assert.deepEqual(oldGain.gain.events.slice(-3),[['cancel',2],['set',1,2],['ramp',0,2.01]],action);
  assert.equal(oldSource.stopAt,2.01,action);assert.equal(old.disconnected,undefined,action);
  if(action!=='route')assert.equal(monitor.gain.events.length,monitorEvents,action);
  const cleanup=h.timers.find(t=>Math.abs(t.ms-10)<1e-8&&!t.cancelled);assert.ok(cleanup,action);
  h.context.currentTime=2.011;cleanup.fn();assert.equal(old.disconnected,true,action);assert.equal(oldGain.disconnected,true,action);
 }
});

test('late cleanup and source completion cannot mute or disconnect a newer playback',async()=>{
 const h=await harness();await h.api.playFile();const oldSource=h.sources.at(-1),lateEnd=oldSource.onended;
 h.context.currentTime=10;lateEnd();const oldDrain=h.timers.at(-1);
 await h.api.playFile();const fresh=h.processors.at(-1),freshGain=h.gains.at(-1),events=freshGain.gain.events.length;
 h.context.currentTime=10.02;for(const timer of [...h.timers])timer.fn();lateEnd();oldDrain.fn();
 assert.equal(fresh.disconnected,undefined);assert.equal(freshGain.disconnected,undefined);assert.equal(freshGain.gain.events.length,events);assert.equal(h.api.playing,true);
});

test('looping has no end fade and disabling loop schedules the actual current cycle end',async()=>{
 const h=await harness();h.get('loop').checked=true;await h.api.playFile();const gain=h.gains.at(-1).gain;
 assert.equal(gain.events.filter(e=>e[0]==='ramp').length,0);
 h.context.currentTime=23;h.get('loop').checked=false;h.get('loop').fire('change');
 assert.deepEqual(gain.events.at(-1),['ramp',0,(30*48000+16800-1)/48000]);
 h.context.currentTime=24;h.get('loop').checked=true;h.get('loop').fire('change');
 assert.deepEqual(gain.events.slice(-2),[['cancel',24],['set',1,24]]);
 h.get('loop').checked=false;h.get('loop').fire('change');assert.equal(gain.events.at(-1)[2],(30*48000+16800-1)/48000);
});

test('receiver status separates active idle open listening, automatic mute, muted monitor and snapshot telemetry',async()=>{
 const h=await harness();h.api.switchMode('mic');await h.api.startMic();h.api.params.fmMonitor=true;h.get('monitor').checked=true;h.get('monitor').fire('change');
 h.api.meter({input:0,output:.1,signal:35,transmitting:false,carrier:false,fmRxOpen:true,fmMonitorActive:true});assert.equal(h.get('carrier-text').textContent,'持续开放');assert.match(h.get('receiver-status').textContent,/PTT 已释放/);
 h.api.params.fmMonitor=false;h.api.ptt(true);h.api.meter({input:.1,output:0,signal:90,transmitting:true,carrier:false,fmRxOpen:false});assert.equal(h.get('carrier-text').textContent,'自动静噪·已静音');assert.match(h.get('receiver-status').textContent,/开头可能被截去/);
 h.get('monitor').checked=false;h.get('monitor').fire('change');h.api.meter({input:.1,output:0,signal:90,transmitting:true,fmRxOpen:false});assert.match(h.get('receiver-status').textContent,/耳机监听关闭/);
});


test('pending draining path never labels old operator output as live open FM',async()=>{
 const h=await harness();h.api.switchMode('mic');await h.api.startMic();h.get('monitor').checked=true;h.get('monitor').fire('change');h.api.params.fmMonitor=true;
 h.api.meter({input:0,output:0,signal:90,transmitting:false,fmRxOpen:false,fmMonitorActive:false,activePerspective:'operator',activeRadio:'analog'});
 assert.equal(h.get('carrier-text').textContent,'待切换');assert.match(h.get('receiver-status').textContent,/当前通话结束后切换/);assert.doesNotMatch(h.get('receiver-status').textContent,/持续开放/);
 h.api.params.fmPropagation='moving';h.api.ptt(true);h.api.meter({input:.1,output:.1,signal:90,transmitting:true,txDeviationPeakHz:2000,fmInstantCnrDb:12,activePerspective:'operator',activeRadio:'analog'});assert.equal(h.get('tx-deviation-value').textContent,'—');assert.match(h.get('channel-state').textContent,/无此路径的实时信道读数/);assert.equal(h.get('quality-screen').textContent,'—');
});


test('Stop during the final fade preserves current level and never extends the finite window',async()=>{
 const h=await harness();await h.api.playFile();h.context.currentTime=10;h.sources.at(-1).onended();
 const gain=h.gains.at(-1).gain;h.context.currentTime=10.345;h.get('stop').fire('click');
 const events=gain.events.slice(-3),end=(496800-1)/48000;
 assert.equal(events[0][0],'cancel');assert.equal(events[1][0],'set');assert.ok(events[1][1]>.49&&events[1][1]<.51);
 assert.deepEqual(events[2],['ramp',0,end]);
});

test('suspended and closed contexts release retired nodes without waiting on a stopped clock',async()=>{
 for(const state of ['suspended','closed']){const h=await harness();await h.api.playFile();h.context.currentTime=2;h.api.stopPlayback();const old=h.processors.at(-1);h.context.state=state;h.timers.at(-1).fn();assert.equal(old.disconnected,true);}
});


test('22050 Hz preview uses the same rounded postroll and final-sample endpoint as export',async()=>{
 const h=await harness();h.context.sampleRate=22050;await h.api.playFile();
 assert.deepEqual(h.gains.at(-1).gain.events.at(-1),['ramp',0,(220500+Math.round(22050*.35)-1)/22050]);
});


test('loop toggle after source exhaustion cannot cancel its envelope while onended is delayed',async()=>{
 for(const at of [10,10.2,10.345,11]){
  const h=await harness();await h.api.playFile();const gain=h.gains.at(-1).gain,events=gain.events.length;
  h.context.currentTime=at;h.get('loop').checked=true;h.get('loop').fire('change');
  assert.equal(gain.events.length,events);assert.deepEqual(gain.events.at(-1),['ramp',0,(496800-1)/48000]);
  h.get('loop').checked=false;h.get('loop').fire('change');assert.equal(gain.events.length,events);
  h.sources.at(-1).onended();assert.equal(gain.events.length,events);
 }
});
