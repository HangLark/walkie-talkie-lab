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
test('same seed reproduces analog cues; distinct seeds vary event shape and waveform',()=>{
 const source=quiet(4800);
 assert.deepEqual(renderRadio(source,48000,params,1234),renderRadio(source,48000,params,1234));
 assert.notDeepEqual(renderRadio(source,48000,params,1234),renderRadio(source,48000,params,5678));
 assert.notDeepEqual(event(1234).open,event(5678).open);
 assert.notDeepEqual(event(1234).tail,event(5678).tail);
});
test('each analog PTT gets new envelope without resetting sample-noise stream',()=>{
 const {k,open}=event(1234);k.process(quiet(20000));
 k.setParams({tx:true});k.processSample(0);
 assert.notDeepEqual(k.openCue,open);assert.equal(k.burstCount,2);
 const before={...k.openCue},seed=k.cueSeed;
 k.setParams({tx:true});k.process(quiet(500));
 assert.deepEqual(k.openCue,before);assert.equal(k.cueSeed,seed);
});
test('event parameters have narrow bounded quality-dependent variation at all rates',()=>{
 for(const rate of [8000,22050,44100,48000,96000,192000])for(let seed=1;seed<=60;seed++){
  const strong=event(seed,100,rate,200),weak=event(seed,15,rate,200);
  for(const {k,open,tail,length} of [strong,weak]){
   assert.ok(open.duration>=.021 && open.duration<=.024);
   assert.ok(open.duration*rate<=k.delaySamples);
   assert.ok(open.gain>=.36 && open.gain<=.53);
   assert.ok(open.power>=1.55 && open.power<=2.35);
   assert.ok(tail.attack>=.002 && tail.attack<=.005);
   assert.ok(tail.gain>=.435 && tail.gain<=.65);
   assert.ok(tail.power>=1.2 && tail.power<=1.9);
   assert.ok(length>=Math.round(rate*.19) && length<=Math.round(rate*.2));
  }
  assert.ok(weak.open.gain>strong.open.gain);
  assert.ok(weak.tail.gain>strong.tail.gain);
  assert.ok(weak.tail.attack>=strong.tail.attack);
  assert.ok(weak.length<=strong.length);
 }
});
test('cue event PRNG is independent of elapsed sample-noise draws',()=>{
 const a=new RadioKernel(48000,{...params,tx:false},42),b=new RadioKernel(48000,{...params,tx:false},42);
 a.process(quiet(128));b.process(quiet(15000));
 a.setParams({tx:true});b.setParams({tx:true});a.processSample(0);b.processSample(0);
 assert.deepEqual(a.openCue,b.openCue);assert.equal(a.cueSeed,b.cueSeed);
 assert.notEqual(a.seed,b.seed);
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
test('varied analog cues remain finite, partition-invariant and within export drain',()=>{
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
