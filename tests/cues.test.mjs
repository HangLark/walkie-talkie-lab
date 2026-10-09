import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioKernel, PRESETS, DEFAULTS, sanitizeParams } from '../src/dsp.js';
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/Math.max(1,a.length));
function burst(rate,params={},duration=.3){
 const k=new RadioKernel(rate,{...DEFAULTS,noise:0,quality:100,tx:false,...params});
 k.process(new Float32Array(Math.round(rate*.05)));
 k.setParams({tx:true});const start=k.process(new Float32Array(Math.round(rate*duration)));
 k.setParams({tx:false});const end=k.process(new Float32Array(Math.round(rate*.4)));
 return {k,start,end};
}
test('silent PTT has measurable receiver start and end cues with noise slider at zero',()=>{
 for(const rate of [8000,22050,44100,48000,96000,192000]){
  const {start,end,k}=burst(rate);
  assert.ok(rms(start.slice(0,Math.round(rate*.024)))>.02,`start ${rate}`);
  assert.ok(rms(end.slice(Math.round(rate*.027),Math.round(rate*.10)))>.015,`end ${rate}`);
  assert.ok(rms(start.slice(Math.round(rate*.1)))<1e-9);
  assert.ok(rms(end.slice(Math.round(rate*.3)))<1e-9);
  assert.equal(k.burstCount,1);assert.equal(k.endCount,1);
 }
});
test('cue gain zero disables synthetic cues; tail zero removes receiver end noise',()=>{
 const silent=burst(48000,{cueLevel:0});assert.equal(rms(silent.start),0);assert.equal(rms(silent.end),0);
 const noTail=burst(48000,{tailMs:0});assert.ok(rms(noTail.start)>.005);assert.equal(rms(noTail.end),0);
});
test('operator permit single/triple are local only, selectable and end without a roger tone',()=>{
 for(const permit of ['single','triple']){
  const {start,end}=burst(48000,{perspective:'operator',permit,radio:'digital'});
  assert.ok(rms(start.slice(0,4000))>.03);assert.equal(rms(start.slice(5000)),0);
  assert.ok(rms(end.slice(0,4320))===0);assert.ok(rms(end.slice(5000))===0);
 }
 const off=burst(48000,{perspective:'operator',permit:'off',radio:'digital'});assert.equal(rms(off.start),0);
 const rx=burst(48000,{radio:'digital'});assert.equal(rms(rx.end),0);assert.ok(rms(rx.start.slice(480))<.002);
});
test('cue and wet-voice delay timings scale with sample rate, not render block boundaries',()=>{
 for(const rate of [8000,44100,48000,96000,192000])for(const perspective of ['receiver','operator']){
  const k=new RadioKernel(rate,{...DEFAULTS,perspective,noise:0,quality:100,tx:true,cueLevel:0});
  const delay=Math.round(rate*(perspective==='operator'?.09:.024));
  for(let i=0;i<delay;i++)assert.equal(k.processSample(.3),0);
  let energy=0;for(let i=0;i<Math.round(rate*.01);i++)energy+=Math.abs(k.processSample(.3));assert.ok(energy>0);
  assert.equal(k.delaySamples,delay);
 }
});
test('VOX word gaps and repeated tx messages do not add cue bursts, new phrases do',()=>{
 const rate=48000,k=new RadioKernel(rate,{...DEFAULTS,vox:true,tx:true});
 k.process(new Float32Array(2400));assert.equal(k.burstCount,0);
 for(let word=0;word<4;word++){
  k.setParams({tx:true});k.process(new Float32Array(2400).fill(.2));k.process(new Float32Array(4800));
 }
 assert.equal(k.burstCount,1);assert.equal(k.endCount,0);
 k.process(new Float32Array(24000));assert.equal(k.endCount,1);
 k.process(new Float32Array(2400).fill(.2));assert.equal(k.burstCount,2);
 k.setParams({tx:false});k.process(new Float32Array(24000));assert.equal(k.endCount,2);assert.ok(k.gate<1e-10);
});
test('rapid release/re-key cancels stale tails and never sticks transmitting',()=>{
 const k=new RadioKernel(48000,{...DEFAULTS,tx:false});
 for(let i=0;i<20;i++){k.setParams({tx:true});k.process(new Float32Array(128));k.setParams({tx:false});k.process(new Float32Array(128));}
 assert.equal(k.burstCount,20);assert.equal(k.endCount,20);
 const out=k.process(new Float32Array(24000));assert.ok(rms(out.slice(18000))<1e-10);assert.equal(k.wasTransmit,false);
});
test('new controls reject malformed values and all six presets expose complete cue choices',()=>{
 const p=sanitizeParams({perspective:'injected',radio:42,permit:'roger',tailMs:999,cueLevel:-1});
 assert.equal(p.perspective,'receiver');assert.equal(p.radio,'analog');assert.equal(p.permit,'triple');assert.equal(p.tailMs,200);assert.equal(p.cueLevel,0);
 assert.equal(Object.keys(PRESETS).length,6);assert.equal(PRESETS.operator.perspective,'operator');
});
test('fast re-key preserves speech already queued behind the permit cue',()=>{
 const k=new RadioKernel(48000,{...DEFAULTS,perspective:'operator',cueLevel:0,noise:0,quality:100,tx:true});
 k.process(new Float32Array(960).fill(.2));k.setParams({tx:false});k.process(new Float32Array(128));
 const before=k.delayBuffer.reduce((s,x)=>s+Math.abs(x),0);assert.ok(before>100);
 k.setParams({tx:true});k.processSample(0);
 assert.ok(k.delayBuffer.reduce((s,x)=>s+Math.abs(x),0)>=before-.001);
 assert.equal(k.delaySamples,4320);
 assert.ok(rms(k.process(new Float32Array(5000)))>.01);
});
