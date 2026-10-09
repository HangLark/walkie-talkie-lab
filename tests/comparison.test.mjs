import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {prepareComparison} from '../src/comparison.js';
import {DEFAULTS,PRESETS} from '../src/dsp.js';
const rate=48000;
const tone=(amplitude=.2)=>Float32Array.from({length:rate},(_,i)=>amplitude*Math.sin(2*Math.PI*731*i/rate));
test('comparison attenuates only, aligns dry voice, matches shared RMS and preserves tail length',()=>{
 for(const p of [PRESETS.patrol,PRESETS.operator,{...PRESETS.operator,permit:'off'}]){
  const input=tone(),a=prepareComparison(input,rate,p),delay=Math.round(rate*(p.perspective==='operator'&&p.permit!=='off'?.09:.024));
  assert.equal(a.delaySamples,delay);assert.equal(a.wet.length,input.length+rate*.35);assert.equal(a.dry.length,a.wet.length);
  assert.ok(a.dryGain>0&&a.dryGain<=1&&a.wetGain>0&&a.wetGain<=1);
  assert.ok(a.dry.slice(0,delay).every(x=>x===0));
  assert.ok(Math.abs(a.dry[delay+37]-input[37]*p.output/100*a.dryGain)<1e-7);
  let d=0,w=0;for(let i=Math.round(rate*.12)+delay;i<rate+delay;i++){d+=a.dry[i]**2;w+=a.wet[i]**2;}
  assert.ok(Math.abs(10*Math.log10(d/w))<.0001);
  assert.ok(a.wet.every(x=>Number.isFinite(x)&&Math.abs(x)<=.950001));
 }
});
test('comparison rejects silence, short signals, muted output and overrange/nonfinite source',()=>{
 for(const x of [new Float32Array(rate),new Float32Array(50),tone(2),Float32Array.from({length:rate},()=>NaN)])assert.throws(()=>prepareComparison(x,rate,DEFAULTS));
 assert.throws(()=>prepareComparison(tone(),rate,{...DEFAULTS,output:0}));
 const a=tone(),opposite=Float32Array.from(a,x=>-x),mono=Float32Array.from(a,(x,i)=>(x+opposite[i])/2);assert.throws(()=>prepareComparison(mono,rate,DEFAULTS));
});
test('comparison gain is fixed, deterministic and rate-scaled for operator delay',()=>{
 const x=tone(.9),a=prepareComparison(x,rate,DEFAULTS),b=prepareComparison(x,rate,DEFAULTS);assert.deepEqual(a,b);
 for(const fs of [8000,22050,44100,96000]){
  const input=Float32Array.from({length:fs},(_,i)=>.1*Math.sin(2*Math.PI*731*i/fs));
  const c=prepareComparison(input,fs,PRESETS.operator);assert.equal(c.delaySamples,Math.round(fs*.09));
 }
});
test('actual comparison worker transfers two snapshots and reports invalid input',async()=>{
 const code=(await readFile(new URL('../src/comparison-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');let result,transfer;
 const self={postMessage:(r,t)=>{result=r;transfer=t;}};vm.runInNewContext(code,{self,prepareComparison});
 self.onmessage({data:{samples:tone(),rate,params:DEFAULTS}});assert.equal(transfer.length,2);assert.equal(result.dry.length,Math.round(rate*1.35));
 self.onmessage({data:{samples:new Float32Array(rate),rate,params:DEFAULTS}});assert.ok(result.error);
});
