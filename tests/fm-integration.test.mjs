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

test('explicit open-squelch mode reveals weak FM noise while automatic mode mutes it',()=>{
 for(const rate of [8000,16000,48000,96000]){
  const automatic=new RadioKernel(rate,{quality:30,output:40},41),monitor=new RadioKernel(rate,{quality:30,output:40,fmMonitor:true},41);
  const source=Float32Array.from({length:Math.round(rate*.3)},(_,n)=>.2*Math.sin(2*Math.PI*1000*n/rate));
  const a=automatic.process(source),m=monitor.process(source);assert.equal(peak(a),0);assert.ok(rms(m.subarray(Math.round(rate*.1)))>.02);assert.ok(peak(m)<.385);
  assert.equal(automatic.fm.seed,monitor.fm.seed);assert.equal(automatic.fm.discriminatorHz,monitor.fm.discriminatorHz);
  assert.equal(automatic.fmRxOpen,false);assert.equal(monitor.fmRxOpen,true);assert.equal(monitor.fmMonitorActive,true);
 }
});
test('open-squelch toggle is smoothed, does not key transmitter, and export remains finite',()=>{
 const k=new RadioKernel(48000,{quality:20,output:40,tx:true},82);k.process(silence(12000));const before=k.burstCount;k.setParams({fmMonitor:true});
 let largestStep=0,last=k.gate;for(let n=0;n<4800;n++){k.processSample(0);largestStep=Math.max(largestStep,Math.abs(k.gate-last));last=k.gate;}
 assert.ok(largestStep<.0014);assert.equal(k.burstCount,before);assert.ok(k.gate>.99);
 k.setParams({tx:false});const tail=k.process(silence(16800));assert.ok(peak(tail.subarray(14400))<1e-9);assert.equal(k.wasTransmit,false);
 k.setParams({fmMonitor:false});k.process(silence(12000));assert.equal(k.fmMonitorActive,false);assert.equal(k.wasTransmit,false);
});
test('monitor never overrides source stop/zero-tail or operator and digital routing',()=>{
 const idle=new RadioKernel(48000,{quality:0,fmMonitor:true,tx:false});assert.equal(peak(idle.process(silence(12000))),0);
 for(const params of [{perspective:'operator'},{radio:'digital'}]){const x=Float32Array.from({length:8000},(_,n)=>.1*Math.sin(n*.21));assert.deepEqual(new RadioKernel(48000,{...params,quality:20,fmMonitor:false},23).process(x),new RadioKernel(48000,{...params,quality:20,fmMonitor:true},23).process(x));}
 const k=new RadioKernel(48000,{quality:30,fmMonitor:true,tailMs:0});k.process(silence(12000));k.setParams({tx:false});assert.ok(peak(k.process(silence(16800)).subarray(2200))<1e-10);
});
