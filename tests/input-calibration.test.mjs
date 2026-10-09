import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateInputLevel,proposeInputCalibration} from '../src/input-calibration.js';
import {AnalogFM} from '../src/analog-fm.js';
function tone(rate,amp=.1,seconds=1) {return Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amp*Math.sin(2*Math.PI*1000*i/rate));}
test('level convention and reference tone are explicit across rates',()=>{
 for(const rate of [8000,16000,44100,48000,96000,192000]) {
  const e=estimateInputLevel(tone(rate),rate);assert.ok(Math.abs(e.levelDbov-(-23.01029996))<1e-5);assert.equal(e.p56Conformant,false);
  const p=proposeInputCalibration(tone(rate),rate);assert.ok(Math.abs(.1*10**(p.gainDb/20)*2500-1500)<1e-3);
 }
});
test('adding exact silence does not normalize a file louder',()=>{
 const x=tone(48000), padded=new Float32Array(48000*12);padded.set(x,48000*5);
 const a=estimateInputLevel(x,48000),b=estimateInputLevel(padded,48000);assert.equal(a.rms,b.rms);assert.ok(b.activeFraction<.1);
});
test('quiet/normal/loud input has inverse suggested gain without mutating PCM',()=>{
 let prior;for(const amp of [.025,.1,.4]){const x=tone(48000,amp),copy=x.slice(),p=proposeInputCalibration(x,48000);
 assert.deepEqual(x,copy);if(prior!==undefined)assert.ok(Math.abs(prior-p.requestedGainDb-12.04119983)<1e-5);prior=p.requestedGainDb;}
});
test('reference sensitivity and source normalization are separate; bounds reported',()=>{
 const p=proposeInputCalibration(tone(48000,.001),48000);assert.equal(p.gainDb,24);assert.equal(p.bounded,true);
 assert.ok(Math.abs(p.requestedGainDb-p.sourceNormalizationDb-p.transmitterSensitivityDb)<1e-10);
 const a=proposeInputCalibration(tone(48000),48000),b=proposeInputCalibration(tone(48000),48000,{responseAt1k:.5});assert.ok(Math.abs(b.requestedGainDb-a.requestedGainDb-6.02059991)<1e-6);
});
test('reject silence, short transients, invalid PCM and invalid options',()=>{
 assert.throws(()=>estimateInputLevel(new Float32Array(48000),48000));const x=new Float32Array(48000);x[100]=1;assert.throws(()=>estimateInputLevel(x,48000));
 assert.throws(()=>estimateInputLevel(tone(48000).fill(NaN),48000));assert.throws(()=>estimateInputLevel(tone(48000).fill(1.1),48000));assert.throws(()=>estimateInputLevel(tone(48000,.1,.1),48000));assert.throws(()=>proposeInputCalibration(tone(48000),48000,{responseAt1k:0}));
});
test('DC does not masquerade as speech or change the suggested AC level',()=>{
 const x=tone(48000),biased=Float32Array.from(x,v=>v+.2);
 assert.ok(Math.abs(estimateInputLevel(x,48000).levelDbov-estimateInputLevel(biased,48000).levelDbov)<1e-5);
 assert.throws(()=>estimateInputLevel(new Float32Array(48000).fill(.2),48000));
});
test('near-threshold modulation utilization improves without changing RF noise configuration',()=>{
 const rate=48000,source=tone(rate,.04),rows=[];
 for(const txInputGainDb of [0,6,12]) {
  const clean=new AnalogFM(rate,{txInputGainDb}),noisy=new AnalogFM(rate,{txInputGainDb,cnrDb:8.8,seed:71});let cc=0,nn=0,cn=0;
  for(let i=0;i<source.length;i++){const c=clean.processSample(source[i]),n=noisy.processSample(source[i]);if(i>rate*.2){cc+=c*c;nn+=n*n;cn+=c*n;}}
  const projection=cn*cn/cc;rows.push({ratio:10*Math.log10(projection/(nn-projection)),noiseStd:noisy.noiseStd,seed:noisy.seed,cnrDb:noisy.cnrDb});
 }
 for(let i=1;i<rows.length;i++){assert.ok(rows[i].ratio>rows[i-1].ratio+3);assert.equal(rows[i].noiseStd,rows[0].noiseStd);assert.equal(rows[i].seed,rows[0].seed);assert.equal(rows[i].cnrDb,8.8);}
});
