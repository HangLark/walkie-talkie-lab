import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RadioKernel, PRESETS, renderRadio } from '../src/dsp.js';
import { prepareComparison } from '../src/comparison.js';
import { encodeWav } from '../src/wav.js';

test('actual AudioWorklet adapter averages channels and matches shared kernel',async()=>{
  let Processor;const events=[];
  class AudioWorkletProcessor { constructor(){this.port={postMessage:m=>events.push(m)};} }
  const code=(await readFile(new URL('../src/worklet.js',import.meta.url),'utf8')).replace("import { RadioKernel } from './dsp.js?v=fm-receiver-session-v2';",'');
  vm.runInNewContext(code,{AudioWorkletProcessor,RadioKernel,sampleRate:48000,registerProcessor:(name,cls)=>{assert.equal(name,'radio-processor');Processor=cls;},Float32Array,Math});
  const p=new Processor({processorOptions:{params:PRESETS.patrol}}), reference=new RadioKernel(48000,PRESETS.patrol);
  for(let block=0;block<30;block++){const left=Float32Array.from({length:128},(_,i)=>Math.sin((block*128+i)*.02)*.3),right=Float32Array.from(left,v=>v*.5),out=new Float32Array(128);assert.equal(p.process([[left,right]],[[out]]),true);for(let i=0;i<128;i++)assert.equal(out[i],Math.fround(reference.processSample((left[i]+right[i])/2)));}
  assert.ok(events.some(m=>m.type==='meter'));p.port.onmessage({data:{type:'params',params:{quality:12}}});assert.equal(p.kernel.target.quality,12);
});

test('actual offline worker exports wet full file even if dry/VOX was selected',async()=>{
  const events=[],self={postMessage:m=>events.push(m)};
  const code=(await readFile(new URL('../src/render-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  vm.runInNewContext(code,{self,RadioKernel,encodeWav,Float32Array,Math});
  const samples=Float32Array.from({length:4097},(_,i)=>Math.sin(i*.1)*.2);self.onmessage({data:{samples,rate:44100,params:{...PRESETS.field,mix:0,vox:true,gateDry:true,tx:false}}});
  const actual=events.find(m=>m.buffer)?.buffer;assert.ok(actual);const expected=encodeWav(renderRadio(samples,44100,{...PRESETS.field,mix:1,vox:false,gateDry:false,tx:true}),44100);assert.deepEqual(new Uint8Array(actual),new Uint8Array(expected));
});

test('static app contract: unique IDs, no remote assets, relative module endpoints',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');const dynamic=['highpass','lowpass','compression','drive','emphasis','quality','quality-label','quality-value','noise','squelch','speaker'];
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1])||dynamic.includes(match[1]),`Missing element: ${match[1]}`);
  assert.ok(!html.match(/(?:src|href)="https?:\/\//));assert.ok(app.includes("new URL('./worklet.js?v=fm-receiver-session-v2',import.meta.url)"));assert.ok(app.includes("new URL('./render-worker.js?v=fm-receiver-session-v2',import.meta.url)"));assert.ok(html.includes('aria-live="polite"'));assert.ok(html.includes('role="tablist"'));
});

test('same take seed reaches actual worklet, comparison worker and WAV worker identically',async()=>{
 const rate=48000,seed=0x1234abcd,params={...PRESETS.field,mix:1,vox:false,gateDry:false,tx:true};
 const samples=Float32Array.from({length:rate},(_,i)=>.2*Math.sin(i*.08));
 let Processor;class AudioWorkletProcessor{constructor(){this.port={postMessage(){}};}}
 const worklet=(await readFile(new URL('../src/worklet.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 vm.runInNewContext(worklet,{AudioWorkletProcessor,RadioKernel,sampleRate:rate,registerProcessor:(_,c)=>{Processor=c;},Float32Array,Math});
 const p=new Processor({processorOptions:{params,seed}}),actual=new Float32Array(samples.length);
 for(let i=0;i<samples.length;i+=128)p.process([[samples.subarray(i,i+128)]],[[actual.subarray(i,i+128)]]);
 const rendered=renderRadio(samples,rate,params,seed);assert.deepEqual(actual,rendered.subarray(0,samples.length));
 const exports=[],exportSelf={postMessage:m=>exports.push(m)};
 vm.runInNewContext((await readFile(new URL('../src/render-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),{self:exportSelf,RadioKernel,encodeWav,Float32Array,Math});
 exportSelf.onmessage({data:{samples,rate,params,seed}});assert.deepEqual(new Uint8Array(exports.find(m=>m.buffer).buffer),new Uint8Array(encodeWav(rendered,rate)));
 let matched;const comparisonSelf={postMessage:m=>{matched=m;}};
 vm.runInNewContext((await readFile(new URL('../src/comparison-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''),{self:comparisonSelf,prepareComparison});
 comparisonSelf.onmessage({data:{samples,rate,params,seed}});
 assert.ok(!matched.error,matched.error);for(let i=0;i<rendered.length;i++)assert.equal(matched.wet[i],Math.fround(rendered[i]*matched.wetGain));
 assert.deepEqual(prepareComparison(samples,rate,params,seed).wet,matched.wet);
 assert.notDeepEqual(renderRadio(samples,rate,params,seed+1),rendered);
});

test('WAV worker owns finite receiver session even when live headphone listening was disabled',async()=>{
 const messages=[],self={postMessage:m=>messages.push(m)},rate=16000,samples=new Float32Array(rate/10),params={quality:90,tailMs:0,fmMonitor:true,receiverActive:false},seed=71;
 const code=(await readFile(new URL('../src/render-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');vm.runInNewContext(code,{self,RadioKernel,encodeWav,Float32Array,Math});
 self.onmessage({data:{samples,rate,params,seed}});const actual=messages.find(m=>m.buffer)?.buffer,expected=renderRadio(samples,rate,params,seed);
 assert.ok(actual);assert.deepEqual(new Uint8Array(actual),new Uint8Array(encodeWav(expected,rate)));assert.equal(expected.length,samples.length+Math.round(rate*.35));assert.ok(expected.subarray(expected.length-800).some(x=>Math.abs(x)>.05));
});
