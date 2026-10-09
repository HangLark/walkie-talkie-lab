import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioKernel,DEFAULTS,renderRadio} from '../src/dsp.js';
const silence=n=>new Float32Array(n);
const peak=a=>a.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
test('noiseless carrier-off does not turn undefined IQ phase into a release click',()=>{
 for(const rate of [8000,16000,44100,48000,192000])for(const tailMs of [0,110,200]){
  const k=new RadioKernel(rate,{quality:100,tailMs});k.process(silence(rate/2));k.setParams({tx:false});const y=k.process(silence(Math.round(rate*.35)));assert.equal(peak(y),0);
 }
});
test('zero-tail precloses before noisy RF removal and enabled tail has a soft bounded output',()=>{
 for(const rate of [8000,16000,44100,48000,192000])for(const tailMs of [0,110]){
  const k=new RadioKernel(rate,{quality:90,tailMs});k.process(silence(rate/2));k.setParams({tx:false});const y=k.process(silence(Math.round(rate*.35)));
  if(!tailMs){assert.ok(peak(y)<.03);assert.ok(peak(y.subarray(Math.ceil(rate*.044)))<1e-10);}
  else {assert.ok(peak(y)<=.768001);assert.ok(rms(y)<.15);assert.ok(peak(y.subarray(Math.ceil(rate*.15)))<1e-8);}
 }
});
test('weak channel acquisition cannot blast initial noise before detector settles',()=>{
 for(const rate of [8000,16000,44100,48000,192000]){const k=new RadioKernel(rate,{quality:30});assert.ok(peak(k.process(silence(Math.round(rate*.3))))<.02);}
});
test('selector changes during release preserve the active burst chain until next keydown',()=>{
 const a=new RadioKernel(48000,{quality:85},23),b=new RadioKernel(48000,{quality:85},23),voice=Float32Array.from({length:6000},(_,n)=>.2*Math.sin(n*.2));a.process(voice);b.process(voice);a.setParams({tx:false});b.setParams({tx:false,radio:'digital',perspective:'operator'});assert.deepEqual(a.process(silence(8000)),b.process(silence(8000)));b.setParams({tx:true});b.processSample(0);assert.equal(b.burstRadio,'digital');assert.equal(b.burstPerspective,'operator');
});
test('late sibilant and early onset survive buffering and full FM filter drain',()=>{
 for(const rate of [8000,16000,44100,48000]){const input=Float32Array.from({length:Math.round(rate*.08)},(_,n)=>.12*Math.sin(2*Math.PI*(n<rate*.02?800:2600)*n/rate));const out=renderRadio(input,rate,{...DEFAULTS,quality:100,tailMs:0});const d=Math.round(rate*.024);assert.ok(rms(out.subarray(d,d+Math.round(rate*.02)))>.03);assert.ok(rms(out.subarray(input.length+d-Math.round(rate*.01),input.length+d))>.015);assert.ok(peak(out.subarray(input.length+Math.round(rate*.06)))<1e-8);}
});
test('rapid re-key keeps queued voice and channel sequence, and export is partition exact',()=>{
 const rate=16000,a=new RadioKernel(rate,{quality:85},53),b=new RadioKernel(rate,{quality:85},53);let max=0;
 for(let n=0;n<rate*.6;n++){if(n%517===0){const tx=n%1034===0;a.setParams({tx});b.setParams({tx});}const x=n<rate*.3?.15*Math.sin(n*.31):0;const ya=a.processSample(x),yb=b.process(new Float32Array([x]))[0];assert.equal(Math.fround(ya),yb);max=Math.max(max,Math.abs(ya));}assert.ok(max>0&&max<.769);
});
