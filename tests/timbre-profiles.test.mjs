import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, TIMBRE_KEYS, TIMBRE_PROFILES, CHANNEL_PROFILES, applyTimbre, applyChannel, RadioKernel, renderRadio, sanitizeParams } from '../src/dsp.js';
import { measureTimbres } from '../scripts/render-timbre-fixtures.mjs';

test('five complete tone-only profiles never smuggle in channel, operating or safety state',()=>{
 assert.equal(Object.keys(TIMBRE_PROFILES).length,5);
 const current={...DEFAULTS,radio:'digital',perspective:'operator',quality:21,noise:58,squelch:42,permit:'off',tailMs:55,cueLevel:37,output:29,mix:0,vox:true,voxThreshold:-31,tx:false,gateDry:true};
 for(const [key,profile]of Object.entries(TIMBRE_PROFILES)){
  assert.deepEqual(Object.keys(profile.params),[...TIMBRE_KEYS]);
  const before={...current},next=applyTimbre(current,key);assert.deepEqual(current,before);
  for(const name of Object.keys(DEFAULTS))assert.equal(next[name],TIMBRE_KEYS.includes(name)?profile.params[name]:current[name],`${key}/${name}`);
  assert.ok(Object.isFrozen(profile.params));
 }
 assert.deepEqual(applyTimbre(current,'not-a-profile'),sanitizeParams(current));
});
test('RF quick choices are immutable and leave voice, radio style and perspective alone',()=>{
 const original=applyTimbre({...DEFAULTS,radio:'digital',perspective:'operator',vox:true,tx:false},'mini');
 for(const key of Object.keys(CHANNEL_PROFILES)){
  const next=applyChannel(original,key);for(const name of Object.keys(DEFAULTS))assert.equal(next[name],['quality','noise','squelch'].includes(name)?CHANNEL_PROFILES[key].params[name]:original[name]);
  assert.deepEqual(applyTimbre(next,'dispatch'),applyChannel(applyTimbre(original,'dispatch'),key));
 }
});
test('new resonance/body parameters are bounded and the classic profile equals defaults',()=>{
 assert.deepEqual(applyTimbre(DEFAULTS,'patrol'),DEFAULTS);
 const p=sanitizeParams({resonanceHz:99999,resonanceQ:0,body:-99});assert.equal(p.resonanceHz,2400);assert.equal(p.resonanceQ,.5);assert.equal(p.body,-9);
 assert.equal(sanitizeParams({body:NaN,resonanceQ:Infinity}).body,0);
});
test('profiles and rapid tone transitions remain finite and bounded at browser rates',()=>{
 for(const rate of [8000,22050,44100,48000,96000,192000]){
  const kernel=new RadioKernel(rate,{...DEFAULTS,quality:100,noise:0,cueLevel:0}),keys=Object.keys(TIMBRE_PROFILES);
  for(let i=0;i<Math.round(rate*.3);i++){
   if(i%503===0)kernel.setParams(TIMBRE_PROFILES[keys[Math.floor(i/503)%keys.length]].params);
   const sample=kernel.processSample(Math.sin(i*.17)*.8);assert.ok(Number.isFinite(sample)&&Math.abs(sample)<=.98);
  }
  for(const key of keys){const out=renderRadio(new Float32Array(Math.round(rate*.03)).fill(.2),rate,applyTimbre(DEFAULTS,key),99);assert.ok(out.every(x=>Number.isFinite(x)&&Math.abs(x)<=.98));}
 }
});
test('same-source RMS-matched profiles are materially distinct without cues or RF noise',()=>{
 const {stats,pairs}=measureTimbres();
 for(const metric of Object.values(stats)){assert.ok(Math.abs(metric.matchedRms-.055)<1e-7);assert.ok(metric.peak<.95);}
 for(const [pair,difference]of Object.entries(pairs))assert.ok(difference>.3,`${pair}: ${difference}`);
 assert.ok(stats.clean.quietLoudContrastDb-stats.compact.quietLoudContrastDb>2.5,'compact reduces level contrasts more than clear direct');
});
