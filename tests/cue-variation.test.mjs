import test from 'node:test';
import assert from 'node:assert/strict';
import { RadioKernel, renderRadio } from '../src/dsp.js';
const params={noise:0, quality:100, tx:true};
const quiet=n=>new Float32Array(n);
function event(seed,quality=100,rate=48000,tailMs=110){
 const k=new RadioKernel(rate,{...params,quality,tailMs},seed);
 k.processSample(0);const open={...k.openCue};
 k.setParams({tx:false});k.processSample(0);
 return {k,open,tail:{...k.tailCue},length:k.releaseLength};
}
test('same seed reproduces FM channel; different seeds vary finite-CNR reception',()=>{
 const source=quiet(4800),p={...params,quality:80};
 assert.deepEqual(renderRadio(source,48000,p,1234),renderRadio(source,48000,p,1234));
 assert.notDeepEqual(renderRadio(source,48000,p,1234),renderRadio(source,48000,p,5678));
 assert.deepEqual(renderRadio(source,48000,params,1234),renderRadio(source,48000,params,5678));
});
test('analog keying never resets channel PRNG or draws synthetic cue envelopes',()=>{
 const k=new RadioKernel(48000,{...params,quality:80},123);k.process(quiet(100));const seed=k.fm.seed,cueSeed=k.cueSeed;
 k.setParams({tx:false});k.process(quiet(100));assert.notEqual(k.fm.seed,seed);
 k.setParams({tx:true});k.processSample(0);assert.equal(k.cueSeed,cueSeed);assert.equal(k.burstCount,2);
});
test('analog tail cap uses exact real time at every sample rate',()=>{
 for(const rate of [8000,22050,44100,48000,96000,192000])for(const ms of [0,55,110,200])assert.equal(event(22,80,rate,ms).length,Math.round(rate*ms/1000));
});
test('exact fixed permit waveforms are seed-invariant; digital receiver has no invented cue',()=>{
 for(const rate of [8000,44100,48000,192000])for(const permit of ['single','triple']){
  const p={...params,perspective:'operator',radio:'digital',permit};
  const a=new RadioKernel(rate,p,1),b=new RadioKernel(rate,p,999);
  const count=Math.round(rate*.09),out=a.process(quiet(count));
  assert.deepEqual(out,b.process(quiet(count)));
  for(let i=0;i<count;i++){
   const age=i/rate,duration=permit==='single'?.065:.019,slot=permit==='single'?0:Math.floor(age/.028),local=permit==='single'?age:age-slot*.028;
   let cue=0;
   if(age<.085 && slot<3 && local<duration)cue=.22*Math.min(1,local/.002,(duration-local)/.003)*Math.sin(2*Math.PI*(permit==='single'?960:[910,1210,1510][slot])*age);
   assert.equal(out[i],Math.fround(Math.tanh(cue*.65*1.25)*.96*.8)||0);
  }
  assert.equal(a.cueSeed,(1^0x51c0a7e3)>>>0);assert.equal(b.cueSeed,(999^0x51c0a7e3)>>>0);
 }
 for(const seed of [1,20,500])assert.ok(renderRadio(quiet(5000),48000,{...params,radio:'digital'},seed).every(x=>x===0));
});
test('FM carrier tails remain finite, partition-invariant and within export drain',()=>{
 for(const rate of [8000,44100,48000,192000]){
  const p={...params,quality:25,tailMs:200},a=new RadioKernel(rate,p,42),b=new RadioKernel(rate,p,42);
  const source=quiet(Math.round(rate*.08));source.fill(.1);
  assert.deepEqual(a.process(source),Float32Array.from([...b.process(source.subarray(0,17)),...b.process(source.subarray(17,129)),...b.process(source.subarray(129))]));
  a.setParams({tx:false});b.setParams({tx:false});
  const tail=a.process(quiet(Math.round(rate*.35)));
  assert.deepEqual(tail,b.process(quiet(tail.length)));assert.ok(tail.every(Number.isFinite));
  assert.ok(tail.subarray(Math.round(rate*.3)).every(x=>Math.abs(x)<1e-9));
 }
});
test('zero controls and fast re-key preserve existing silence and queued speech contracts',()=>{
 const muted=renderRadio(quiet(4800),48000,{...params,cueLevel:0},123);assert.ok(muted.every(x=>x===0));
 assert.equal(event(123,100,48000,0).length,0);
 const k=new RadioKernel(48000,params,123);k.process(new Float32Array(100).fill(.2));
 k.setParams({tx:false});k.process(quiet(5));const before=k.delayBuffer.reduce((s,x)=>s+Math.abs(x),0);
 k.setParams({tx:true});k.processSample(0);assert.equal(k.releaseAge,-1);
 assert.ok(k.delayBuffer.reduce((s,x)=>s+Math.abs(x),0)>=before-.001);
 k.setParams({tx:false});const out=k.process(quiet(16800));assert.ok(out.subarray(14400).every(x=>Math.abs(x)<1e-9));
});
