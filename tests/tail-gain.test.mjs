import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RadioKernel,renderRadio,sanitizeParams,DEFAULTS} from '../src/dsp.js';
const rates=[8000,16000,44100,48000,96000,192000];
const hashes=['85e22bdda83d2db795a2fee4a3b35c758c9d70ba7f1face546f4565a612f3efe','6524e01e855d8362721032d1fe091d1881a0bf879bc41ec4ec8c1f75bff44edf','c6e64859895332940f44ae78c77d7e2905ebac6f6057045d01956fc905553244','52d96dd38912d32819daa69ac240a0c954aa245b3da1aeab606ec5bf4f01abff','c45966a98dbd0e7ab6a2100188d8c504d9ac2a126c35277b41274a06593e1780','fcc78ac5cea436f4d7bd225574a95bc9762f0cda514e3e13539212d0ad97d13a'];
const silence=n=>new Float32Array(n);

test('tail gain defaults to exact pre-feature output and accepts attenuation only',()=>{
 assert.equal(DEFAULTS.tailGainDb,0);assert.equal(sanitizeParams({tailGainDb:12}).tailGainDb,0);assert.equal(sanitizeParams({tailGainDb:-90}).tailGainDb,-24);assert.equal(sanitizeParams({tailGainDb:NaN}).tailGainDb,0);
 for(const [i,rate]of rates.entries()){
  const input=Float32Array.from({length:Math.round(rate*.16)},(_,n)=>.12*Math.sin(n*.19));
  const output=renderRadio(input,rate,{quality:90,tailMs:110},42);
  assert.equal(createHash('sha256').update(new Uint8Array(output.buffer)).digest('hex'),hashes[i],`${rate}: pre-feature waveform`);
 }
});

test('attenuation starts only after RF drain and preserves detector evidence sample-exactly',()=>{
 for(const rate of rates)for(const db of [-6,-12,-24]){
  const a=new RadioKernel(rate,{quality:90,tailMs:200},42),b=new RadioKernel(rate,{quality:90,tailMs:200,tailGainDb:db},42);
  for(let n=0;n<Math.round(rate*.2);n++){const x=.12*Math.sin(n*.19);assert.equal(a.processSample(x),b.processSample(x));}
  a.setParams({tx:false});b.setParams({tx:false});const drain=a.delaySamples+a.fmDrainSamples,ratio=10**(db/20);let powerA=0,powerB=0;
  for(let n=0;n<Math.round(rate*.35);n++){
   const x=a.processSample(0),y=b.processSample(0);
   assert.equal(a.fm.detectorPower,b.fm.detectorPower);assert.equal(a.fm.discriminatorHz,b.fm.discriminatorHz);assert.equal(a.carrier,b.carrier);assert.equal(a.gate,b.gate);
   if(n<drain){assert.equal(x,y);assert.equal(b.tailOutputGain,1);}
   if(n>=drain+b.tailOutputRampSamples){assert.ok(Math.abs(y-x*ratio)<1e-14);powerA+=x*x;powerB+=y*y;}
  }
  assert.ok(powerA>0);assert.ok(Math.abs(10*Math.log10(powerB/powerA)-db)<1e-9);
 }
});

test('RF-continuous rekey stays unity and post-RF rekey recovers smoothly before new speech',()=>{
 for(const rate of [8000,44100,48000,192000])for(const gapMs of [23,24,43,44,50,100]){
  const k=new RadioKernel(rate,{quality:90,tailGainDb:-12},42);k.process(silence(Math.round(rate*.2)));k.setParams({tx:false});k.process(silence(Math.round(rate*gapMs/1000)));
  if(gapMs<=44)assert.equal(k.tailOutputGain,1);
  const old=k.tailOutputGain;k.setParams({tx:true});let previous=old;
  for(let n=0;n<k.delaySamples+1;n++){
   k.processSample(.1*Math.sin(n*.2));assert.ok(k.tailOutputGain>=previous);assert.ok(k.tailOutputGain-previous<=1/k.tailOutputRampSamples+1e-12);previous=k.tailOutputGain;
   if(n>=k.tailOutputRampSamples-1)assert.equal(k.tailOutputGain,1);
  }
 }
});

test('zero-tail, noiseless, raw A, operator and digital output are unchanged',()=>{
 for(const settings of [{quality:90,tailMs:0},{quality:100},{mix:0},{perspective:'operator'},{radio:'digital'}]){
  const rate=48000,input=Float32Array.from({length:9600},(_,n)=>settings.quality===100?0:.1*Math.sin(n*.19));
  const a=renderRadio(input,rate,settings,42),b=renderRadio(input,rate,{...settings,tailGainDb:-12},42);assert.deepEqual(a,b);
 }
});

test('mid-tail control changes and block partition keep a bounded finite gain envelope',()=>{
 const a=new RadioKernel(48000,{quality:90},42),b=new RadioKernel(48000,{quality:90},42);
 const changes=new Map([[9600,{tx:false}],[12000,{tailGainDb:-24}],[12100,{tailGainDb:-6}],[12200,{tailGainDb:0}],[12400,{tx:true}]]);
 for(let n=0;n<16800;n++){
  if(changes.has(n)){a.setParams(changes.get(n));b.setParams(changes.get(n));}
  const input=Math.fround(.1*Math.sin(n*.19)),previous=a.tailOutputGain,x=a.processSample(input),y=b.process(new Float32Array([input]))[0];assert.equal(Math.fround(x),y);
  assert.ok(a.tailOutputGain>=10**(-24/20)&&a.tailOutputGain<=1);assert.ok(Math.abs(a.tailOutputGain-previous)<=1/a.tailOutputRampSamples+1e-12);
 }
});
