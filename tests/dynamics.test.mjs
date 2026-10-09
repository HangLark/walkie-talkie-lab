import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechLeveler, BurstFrameChannel, CorrelatedRF, RadioKernel, DEFAULTS, renderRadio } from '../src/dsp.js';
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
const tone=(rate,seconds,amplitude=.1)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amplitude*Math.sin(2*Math.PI*731*i/rate));

test('leveler reduces 20 dB source-level differences without exceeding bounded gain',()=>{
 const values=[];
 for(const amplitude of [.03,.3]){
  const k=new SpeechLeveler(48000),input=tone(48000,2,amplitude),out=Float32Array.from(input,x=>k.tick(x,100));
  values.push(rms(out.slice(48000))); assert.ok(k.gain>=.65&&k.gain<=3);
 }
 const difference=20*Math.log10(values[1]/values[0]);assert.ok(difference<8,`${difference} dB`);
});
test('leveler leaves silence and low hiss unboosted, stops boosting between phrases',()=>{
 const k=new SpeechLeveler(48000);
 for(let i=0;i<48000;i++)assert.equal(k.tick(0,100),0);
 const hiss=tone(48000,1,.003),out=Float32Array.from(hiss,x=>k.tick(x,100));assert.ok(rms(out)<=rms(hiss)*1.001);
 for(const x of tone(48000,1,.03))k.tick(x,100);assert.ok(k.gain>2.9);
 for(let i=0;i<24000;i++)k.tick(0,100);assert.ok(k.gain<=1.001);
 for(const x of hiss)assert.ok(Math.abs(k.tick(x,0)-x)<1e-12);
});
test('leveler gain timing is sample-rate consistent, loud onsets attenuate promptly',()=>{
 const gains=[];
 for(const rate of [8000,22050,44100,48000,96000,192000]){
  const k=new SpeechLeveler(rate);for(let i=0;i<rate*.4;i++)k.tick(.025,100);
  const quiet=k.gain;for(let i=0;i<Math.round(rate*.06);i++)k.tick(.5,100);
  assert.ok(k.gain<.68);gains.push(quiet);
 }
 for(const gain of gains)assert.ok(Math.abs(gain-gains[0])<.002);
});
test('healthy digital channel is sample-transparent with zero frame losses',()=>{
 for(const rate of [8000,22050,44100,48000,96000,192000]){
  const c=new BurstFrameChannel(rate,99),input=tone(rate,.6);
  for(const x of input)assert.equal(c.tick(x,96),x);
  assert.equal(c.lostFrames,0);assert.equal(c.totalFrames,30);
 }
});
test('burst losses are seeded, clustered, nonperiodic and worse at low quality',()=>{
 const run=(quality,seed)=>{const c=new BurstFrameChannel(8000,seed),pattern=[];for(let i=0;i<8000*20;i++){c.tick(.1,quality);if(i%160===0)pattern.push(c.bad);}return {c,pattern};};
 const poor=run(20,99),other=run(20,100),medium=run(48,99),good=run(96,99);
 assert.deepEqual(poor.pattern,run(20,99).pattern);assert.notDeepEqual(poor.pattern,other.pattern);
 assert.ok(poor.c.lostFrames>medium.c.lostFrames*3);assert.equal(good.c.lostFrames,0);assert.ok(poor.c.maxRun>=3);
 assert.ok(poor.pattern.some((value,i)=>i>=23&&value!==poor.pattern[i-23]),'no old 23-frame repeating mask');
});
test('concealment fades stale audio to zero; frame and recovery boundaries are continuous',()=>{
 const c=new BurstFrameChannel(48000,99);c.random=()=>0;
 for(let i=0;i<960;i++)c.tick(.4,100);
 let previous=c.last,maxStep=0;
 for(let i=0;i<960*5;i++){const value=c.tick(.4,0);maxStep=Math.max(maxStep,Math.abs(value-previous));previous=value;}
 assert.equal(c.last,0);assert.ok(maxStep<.01,`conceal step ${maxStep}`);
 for(let i=0;i<960;i++){const value=c.tick(-.4,100);maxStep=Math.max(maxStep,Math.abs(value-previous));previous=value;}
 assert.ok(maxStep<.01,`recovery step ${maxStep}`);assert.ok(Math.abs(c.last+.4)<1e-6);
 c.reset();assert.equal(c.goodLength,0);assert.equal(c.last,0);
});
test('digital loss decisions and counts use elapsed time across sample rates',()=>{
 const patterns=[];
 for(const rate of [8000,22050,44100,48000,96000,192000]){
  const c=new BurstFrameChannel(rate,42),pattern=[];let frame=0;
  for(let i=0;i<rate*2;i++){c.tick(.1,25);if(c.totalFrames!==frame){frame=c.totalFrames;pattern.push(c.bad);}}
  assert.equal(c.totalFrames,100);patterns.push(pattern);
 }
 for(const pattern of patterns)assert.deepEqual(pattern,patterns[0]);
});
test('analog RF has bounded correlated flutter and becomes perfectly steady at full quality',()=>{
 const rf=new CorrelatedRF(48000,42),values=[];let previous=30,maxStep=0;
 for(let i=0;i<48000*3;i++){const q=rf.tick(30);if(i)maxStep=Math.max(maxStep,Math.abs(q-previous));previous=q;if(i%480===0)values.push(q);assert.ok(q>=0&&q<=100);}
 // Ignore initial arbitrary phase when assessing continuity.
 assert.ok(Math.max(...values)-Math.min(...values)>10);assert.ok(maxStep<.03);
 const mean=values.reduce((s,x)=>s+x,0)/values.length;
 const variance=values.reduce((s,x)=>s+(x-mean)**2,0)/values.length;
 const difference=values.slice(1).reduce((s,x,i)=>s+(x-values[i])**2,0)/(values.length-1);
 assert.ok(difference/variance<.1,'10 ms neighbors are strongly correlated');
 for(let i=0;i<48000;i++)assert.equal(rf.tick(100),100);
});
test('operator sidetone and permit are independent of remote RF/noise/squelch',()=>{
 const input=tone(48000,1),base={...DEFAULTS,perspective:'operator',radio:'digital'};
 assert.deepEqual(renderRadio(input,48000,{...base,quality:100,noise:0,squelch:0}),renderRadio(input,48000,{...base,quality:0,noise:100,squelch:65}));
});
test('new dynamics and digital loss preserve block/offline parity through release',()=>{
 const rate=22050,input=tone(rate,1),params={...DEFAULTS,radio:'digital',quality:27,squelch:0};
 const full=renderRadio(input,rate,params,42),k=new RadioKernel(rate,params,42),blocks=new Float32Array(full.length);
 for(let start=0;start<full.length;start+=128)for(let i=start;i<Math.min(start+128,full.length);i++){if(i===input.length)k.setParams({tx:false});blocks[i]=k.processSample(input[i]||0);}
 assert.deepEqual(blocks,full);
});
