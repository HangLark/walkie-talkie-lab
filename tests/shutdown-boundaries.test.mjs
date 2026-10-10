import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioKernel,renderRadio} from '../src/dsp.js';
const peak=a=>a.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
for(const rate of [8000,44100,48000,192000])for(const afterPtt of [false,true])for(const change of [{fmMonitor:false},{receiverActive:false}]){
 test(`idle closing envelope remains smooth: ${rate} Hz, after PTT ${afterPtt}, ${Object.keys(change)[0]}`,()=>{
  const k=new RadioKernel(rate,{quality:90,fmMonitor:true,tx:false,tailMs:0},24);
  k.process(new Float32Array(Math.round(rate*.5)));
  if(afterPtt){k.setParams({tx:true});k.process(new Float32Array(Math.round(rate*.1)));k.setParams({tx:false});k.process(new Float32Array(Math.round(rate*.5)));}
  const bursts=k.burstCount,ends=k.endCount;assert.ok(k.gate>.999999);k.setParams(change);
  let last=k.gate,maxStep=0;const closing=new Float32Array(Math.round(rate*.125));
  for(let i=0;i<closing.length;i++){closing[i]=k.processSample(0);assert.ok(k.gate<=last);maxStep=Math.max(maxStep,last-k.gate);last=k.gate;}
  assert.ok(maxStep<=1-Math.exp(-1/(rate*.003))+1e-12,`closing step ${maxStep}`);
  assert.ok(peak(closing.subarray(Math.round(rate*.1)))<1e-10);assert.equal(k.burstCount,bursts);assert.equal(k.endCount,ends);
 });
}
for(const rate of [8000,44100,48000,192000])test(`finite window fades exact endpoint at ${rate} Hz`,()=>{
 const input=new Float32Array(Math.round(rate*.1)),params={quality:90,fmMonitor:true,tailMs:0},seed=24;
 const out=renderRadio(input,rate,params,seed),length=input.length+Math.round(rate*.35),fade=Math.round(rate*.01);
 assert.equal(out.length,length);assert.equal(out.at(-1),0);
 const raw=new RadioKernel(rate,params,seed);
 for(let i=0;i<length;i++){
  if(i===input.length)raw.setParams({tx:false});const sample=Math.fround(raw.processSample(0));
  const gain=i<length-fade?1:(length-1-i)/(fade-1);
  assert.equal(out[i],(i===length-1?0:Math.fround(sample*gain)),`sample ${i}`);
 }
});

test('recording envelope preserves empty/short buffers and does not invent noiseless audio',async()=>{
 const {applyOutputWindowFade,outputFadeSamples,outputWindowGain}=await import('../src/output-boundary.js');
 assert.equal(applyOutputWindowFade(new Float32Array(0),48000).length,0);
 assert.deepEqual(applyOutputWindowFade(new Float32Array([.7]),48000),new Float32Array([0]));
 assert.deepEqual(applyOutputWindowFade(new Float32Array([.7,.8]),48000),new Float32Array([.7,0]));
 for(const rate of [8000,44100,48000,192000]){
  const length=Math.round(rate*.5),fade=outputFadeSamples(rate,length);let previous=1;
  for(let i=length-fade;i<length;i++){const gain=outputWindowGain(i,length,rate);assert.ok(gain>=0&&gain<=previous);assert.ok(previous-gain<=1/(fade-1)+1e-12);previous=gain;}
  assert.equal(previous,0);
  assert.equal(peak(renderRadio(new Float32Array(rate/10),rate,{quality:100,fmMonitor:true,tailMs:0},24)),0);
 }
});
