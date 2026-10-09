import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {DEFAULTS,PRESETS} from '../src/dsp.js';
async function harness(){
 const elements=new Map(),workers=[],sources=[],processors=[],downloads=[];
 function element(id=''){const handlers=new Map(),classes=new Set();return {id,tagName:'DIV',style:{setProperty(){}},children:[],dataset:{},checked:false,disabled:false,value:0,classList:{add(x){classes.add(x);},remove(x){classes.delete(x);},contains(x){return classes.has(x);},toggle(x,v){if(v)classes.add(x);else classes.delete(x);}},addEventListener(n,f){handlers.set(n,f);},fire(n){return handlers.get(n)?.({target:this,preventDefault(){}});},setAttribute(){},append(e){this.children.push(e);},querySelector(){return element();},getBoundingClientRect(){return {width:0};},click(){downloads.push(this.download);}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const document={...element(),getElementById:get,createElement:element,querySelectorAll:()=>[],querySelector:element};
 const gain=()=>({value:1,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;}});
 const buffer=(duration=10)=>({sampleRate:48000,duration,length:duration*48000,numberOfChannels:1,getChannelData:()=>new Float32Array(duration*48000).fill(.1)});
 const context={currentTime:0,resume:async()=>{},close(){},createGain:()=>({gain:gain(),connect(){},disconnect(){}}),createBuffer:(channels,length,sampleRate)=>({length,sampleRate,duration:length/sampleRate,copyToChannel(){}}),createBufferSource:()=>{const s={connect(){},disconnect(){this.disconnected=true;},start(at,offset){this.offset=offset;},stop(){this.stopped=true;}};sources.push(s);return s;}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
 class AudioWorkletNode{constructor(c,n,options){this.options=options;this.port={postMessage(){},close(){}};processors.push(this);}connect(){}disconnect(){this.disconnected=true;}}
 const code=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'').replaceAll('import.meta.url',"'https://example.test/src/app.js'");
 const scope={document,window:element(),DEFAULTS,PRESETS,Worker,AudioWorkletNode,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout(){return 1;},clearTimeout(){},URL:class extends URL{static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}},Blob,Float32Array,Math};
 vm.runInNewContext(code+`\nglobalThis.api={applyPreset,playFile,stopPlayback,switchMode,setFile,exportWav,finishExport,setup(c,b){context=c;monitorGain=c.createGain();setFile(b,'original.wav');},get params(){return params;},get playing(){return playing;},get pausedAt(){return pausedAt;},get exportBusy(){return exportBusy;}};`,scope);
 scope.api.setup(context,buffer());return {...scope,get,workers,sources,processors,downloads,context,buffer};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('QA: playing preset replaces whole processor at preserved position; paused preset stays paused',async()=>{
 const h=await harness();await h.api.playFile();h.context.currentTime=3.2;h.api.applyPreset('operator');await tick();
 assert.equal(h.api.playing,true);assert.equal(h.sources.at(-1).offset,3.2);assert.ok(h.sources[0].stopped);assert.ok(h.processors[0].disconnected);
 const applied=h.processors.at(-1).options.processorOptions.params;
 for(const key of ['perspective','radio','permit','quality','noise','squelch','highpass','lowpass'])assert.equal(applied[key],PRESETS.operator[key],key);
 await h.api.playFile();const count=h.sources.length;h.api.applyPreset('patrol');await tick();assert.equal(h.sources.length,count);assert.equal(h.api.playing,false);assert.equal(h.api.pausedAt,3.2);
});
test('QA: rapid preset restart then source-mode switch cannot start old file audio',async()=>{
 const h=await harness();await h.api.playFile();h.context.currentTime=2;h.api.applyPreset('operator');h.api.applyPreset('patrol');h.api.switchMode('mic');await tick();
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
