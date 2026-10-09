import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {AnalogFM} from '../src/analog-fm.js';
import {RadioKernel,renderRadio,DEFAULTS} from '../src/dsp.js';
const golden=JSON.parse(readFileSync(new URL('./fixtures/static-fm-b9a10ad.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
test('static RF remains bit-exact with frozen b9a10ad when the new TX postfilter is instrumented out',()=>{
 // This is a channel-regression isolation test, not an assertion that adding
 // the new transmitter filter leaves the full application waveform unchanged.
 for(const {rate,quality,sha256} of golden.cases){
  const x=Float32Array.from({length:Math.round(rate*.08)},(_,n)=>.2*Math.sin(2*Math.PI*701*n/rate)+.05*Math.sin(2*Math.PI*2311*n/rate)),k=new RadioKernel(rate,{...DEFAULTS,quality,fmMonitor:true,tailMs:55},918273),out=new Float32Array(x.length+Math.round(rate*.35));
  k.fm.txPostLimit.tick=x=>x;
  for(let n=0;n<out.length;n++){if(n===x.length)k.setParams({tx:false});out[n]=k.processSample(x[n]||0);}
  assert.equal(sha(out),sha256,`${rate}/${quality}`);
 }
});
test('moving propagation does not change thermal-noise sequence and is seeded/partition exact',()=>{
 const a=new AnalogFM(48000,{cnrDb:10,seed:22}),b=new AnalogFM(48000,{cnrDb:10,seed:22,propagation:'moving'});let difference=0;
 for(let n=0;n<48000;n++){const x=.2*Math.sin(n*.17);difference+=Math.abs(a.processSample(x)-b.processSample(x));assert.equal(a.seed,b.seed);}assert.ok(difference>1);
 const x=Float32Array.from({length:17003},(_,n)=>.2*Math.sin(n*.17)),params={quality:35,fmPropagation:'moving',fmMonitor:true},c=new RadioKernel(44100,params,88),d=new RadioKernel(44100,params,88);const whole=c.process(x),parts=new Float32Array(x.length);for(let n=0;n<x.length;n+=127)d.process(x.subarray(n,n+127),parts.subarray(n,n+127));assert.deepEqual(whole,parts);
});
test('propagation transitions are bounded 50 ms coherent RF blends and static returns to unity',()=>{
 const k=new AnalogFM(48000,{cnrDb:20});k.setPropagation('moving');let last=0;for(let n=0;n<2400;n++){k.processSample(0);assert.ok(k.propagationMix-last<=1/2400+1e-12);last=k.propagationMix;}assert.ok(k.propagationMix>.999999);k.setPropagation('static');for(let n=0;n<2500;n++)k.processSample(0);assert.equal(k.propagationMix,0);assert.equal(k.propagationPower,1);
});
test('mean CNR stays fixed and instantaneous CNR follows pre-noise channel power',()=>{
 const k=new AnalogFM(48000,{cnrDb:12,propagation:'moving',seed:71});const sigma=k.noiseStd;let min=Infinity,max=0;
 for(let n=0;n<48000*3;n++){k.processSample(.1*Math.sin(n*.17));assert.equal(k.cnrDb,12);assert.equal(k.noiseStd,sigma);assert.ok(Math.abs(k.instantaneousCnrDb-(12+10*Math.log10(k.propagationPower)))<1e-10);min=Math.min(min,k.propagationPower);max=Math.max(max,k.propagationPower);}assert.ok(max/min>3);
});
test('optional moving model cannot affect operator/digital routing or turn stopped playback into noise',()=>{
 const x=Float32Array.from({length:4000},(_,n)=>.15*Math.sin(n*.17));for(const params of [{perspective:'operator'},{radio:'digital'}])assert.deepEqual(renderRadio(x,48000,{...params,fmPropagation:'static'},19),renderRadio(x,48000,{...params,fmPropagation:'moving'},19));
 const k=new RadioKernel(48000,{fmPropagation:'moving',fmMonitor:true,quality:20,tx:false});assert.ok(k.process(new Float32Array(8000)).every(x=>x===0));
});

test('noiseless strong FM remains nearly transparent under slow IQ motion rather than audio fading',()=>{
 const a=new AnalogFM(48000,{cnrDb:Infinity,seed:22}),b=new AnalogFM(48000,{cnrDb:Infinity,seed:22,propagation:'moving'});let error=0,p=0,count=0;
 for(let n=0;n<48000*3;n++){const x=.2*Math.sin(2*Math.PI*1000*n/48000),ya=a.processSample(x),yb=b.processSample(x);if(n>4800){error+=(ya-yb)**2;p+=ya*ya;count++;}}assert.ok(Math.sqrt(error/count)<.001);assert.ok(error/p<.00005);
});
