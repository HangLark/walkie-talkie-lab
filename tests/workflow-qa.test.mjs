import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel} from '../src/dsp.js';
async function harness({cryptoAvailable=true,fetchImpl}={}){
 let entropy=100;
 const elements=new Map(),workers=[],sources=[],processors=[],downloads=[];
 function element(id=''){const handlers=new Map(),classes=new Set();return {id,tagName:'DIV',style:{setProperty(){}},children:[],dataset:{},checked:false,disabled:false,value:0,classList:{add(x){classes.add(x);},remove(x){classes.delete(x);},contains(x){return classes.has(x);},toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},addEventListener(n,f){handlers.set(n,f);},fire(n){return handlers.get(n)?.({target:this,preventDefault(){}});},setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},getBoundingClientRect(){return {width:0};},click(){downloads.push(this.download);}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const document={...element(),getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:element};
 const gain=()=>({value:1,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
 const buffer=(duration=10)=>({sampleRate:48000,duration,length:duration*48000,numberOfChannels:1,getChannelData:()=>new Float32Array(duration*48000).fill(.1)});
 const context={sampleRate:48000,audioWorklet:{addModule:async()=>{}},currentTime:0,resume:async()=>{},close(){},createGain:()=>({gain:gain(),connect(){},disconnect(){}}),createBuffer:(channels,length,sampleRate)=>({length,sampleRate,duration:length/sampleRate,copyToChannel(){},getChannelData:()=>new Float32Array(length)}),createMediaStreamSource:()=>({connect(){},disconnect(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){this.disconnected=true;},start(at,offset){this.offset=offset;},stop(){this.stopped=true;}};sources.push(s);return s;}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
 class AudioWorkletNode{constructor(c,n,options){this.options=options;this.port={postMessage(message){this.lastMessage=message;},close(){}};processors.push(this);}connect(){}disconnect(){this.disconnected=true;}}
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={fetch:fetchImpl,AbortController,crypto:cryptoAvailable?{getRandomValues(a){a[0]=++entropy;return a;}}:undefined,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]})}},document,window:{...element(),isSecureContext:true},DEFAULTS,TIMBRE_PROFILES,TIMBRE_KEYS,CHANNEL_PROFILES,applyTimbre,applyChannel,Worker,AudioWorkletNode,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(){return 1;},clearTimeout(){},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},Blob,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={controls,format,cnrLabel,meter,calibrateInput,undoInputCalibration,ensureAudio,resetContext(){context=null;initPromise=null;},loadFile,createTakeSeed,demo,humanDemo,startMic,stopMic,prepareMatch,matchKey,checkComparison,ptt,get fileSeed(){return fileSeed;},get micSeed(){return micSeed;},applyPreset,applyRF,updateControls,playFile,stopPlayback,switchMode,setFile,exportWav,finishExport,setup(c,b){context=c;monitorGain=c.createGain();setFile(b,'original.wav');},get params(){return params;},get playing(){return playing;},get pausedAt(){return pausedAt;},get exportBusy(){return exportBusy;}};`,scope);
 scope.api.setup(context,buffer());return {...scope,get,workers,sources,processors,downloads,context,buffer};
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
 assert.equal(h.get('carrier-text').textContent,'静噪关闭');assert.match(h.get('receiver-status').textContent,/发射仍在进行/);assert.equal(h.api.playing,true);
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
 const h=await harness();h.api.updateControls();assert.equal(h.get('fm-monitor').checked,false);assert.equal(h.get('fm-monitor').disabled,false);assert.match(h.get('fm-monitor-help').textContent,/先降低试听音量/);
 const seed=h.api.fileSeed;h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.api.playing,false);assert.equal(h.sources.length,0);assert.equal(h.get('monitor').checked,false);assert.equal(h.api.fileSeed,seed);assert.equal(h.get('squelch').disabled,true);
 await h.api.playFile();h.api.meter({input:.1,output:.1,signal:35,transmitting:true,carrier:false,fmRxOpen:true,fmMonitorActive:true});assert.equal(h.get('carrier-text').textContent,'静噪打开');assert.match(h.get('receiver-status').textContent,/手动打开接收静噪/);assert.equal(h.get('quality-screen').textContent,'8.8 dB');assert.equal(h.get('quality-value').textContent,'35.2 dB');
 h.get('fm-monitor').checked=false;h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,false);assert.equal(h.get('squelch').disabled,false);assert.equal(h.get('monitor').checked,false);
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('fm-monitor').disabled,true);h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');assert.equal(h.api.params.fmMonitor,false);
});
test('QA: near-threshold shortcut exposes C/N and preserves explicit squelch-monitor choice',async()=>{
 const h=await harness();h.api.applyRF('varying');assert.equal(h.api.params.quality,35);assert.equal(h.get('quality-value').textContent,'8.8 dB');assert.equal(h.get('quality-screen').textContent,'8.8 dB');assert.equal(h.get('fm-monitor').checked,false);
 h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');h.api.applyRF('stable');assert.equal(h.api.params.fmMonitor,true);assert.equal(h.get('quality-value').textContent,'无噪声');
 h.api.params.radio='digital';h.api.updateControls();assert.equal(h.get('quality-value').textContent,'100%');h.api.params.perspective='operator';h.api.updateControls();assert.equal(h.get('quality-screen').textContent,'—');
});

test('QA: receiver-monitor toggle during held PTT preserves transmission and keeps headphones off',async()=>{
 const h=await harness();h.api.switchMode('mic');await h.api.startMic();h.api.ptt(true);const processor=h.processors.at(-1);assert.equal(processor.port.lastMessage.params.tx,true);
 h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');assert.equal(processor.port.lastMessage.params.tx,true);assert.equal(processor.port.lastMessage.params.fmMonitor,true);assert.equal(h.get('monitor').checked,false);assert.equal(h.get('ptt').classList.contains('transmitting'),true);
 h.api.ptt(false);assert.equal(processor.port.lastMessage.params.tx,false);assert.equal(h.get('monitor').checked,false);
});

test('QA: live C/N label uses the same noiseless threshold as the FM model',async()=>{
 const h=await harness();assert.equal(h.api.cnrLabel(99.999),'无噪声');assert.equal(h.api.cnrLabel(99.998),'40.0 dB');assert.equal(h.api.cnrLabel(35),'8.8 dB');
});

test('QA: propagation is opt-in, retains source/channel/monitor and is disabled outside analog reception',async()=>{
 const h=await harness();h.api.updateControls();assert.equal(h.get('fm-propagation').value,'static');const seed=h.api.fileSeed;h.api.applyRF('varying');h.get('fm-monitor').checked=true;h.get('fm-monitor').fire('change');
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
