import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RadioKernel, PRESETS, renderRadio } from '../src/dsp.js';
import { encodeWav } from '../src/wav.js';

test('actual AudioWorklet adapter averages channels and matches shared kernel',async()=>{
  let Processor;const events=[];
  class AudioWorkletProcessor { constructor(){this.port={postMessage:m=>events.push(m)};} }
  const code=(await readFile(new URL('../src/worklet.js',import.meta.url),'utf8')).replace("import { RadioKernel } from './dsp.js';",'');
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
  const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');const dynamic=['highpass','lowpass','compression','drive','emphasis','quality','noise','squelch','speaker'];
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(match[1])||dynamic.includes(match[1]),`Missing element: ${match[1]}`);
  assert.ok(!html.match(/(?:src|href)="https?:\/\//));assert.ok(app.includes("new URL('./worklet.js',import.meta.url)"));assert.ok(app.includes("new URL('./render-worker.js',import.meta.url)"));assert.ok(html.includes('aria-live="polite"'));assert.ok(html.includes('role="tablist"'));
});
