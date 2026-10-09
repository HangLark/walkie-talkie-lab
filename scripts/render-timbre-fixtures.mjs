// Synthetic speech-like diagnostics only. No human voice or measured radio recording.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULTS, TIMBRE_PROFILES, applyTimbre, renderRadio } from '../src/dsp.js';
import { encodeWav } from '../src/wav.js';
export const rms = samples => Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/Math.max(1,samples.length));
export function speechSurrogate(rate=24000, seconds=4) {
 let seed=319; const samples=new Float32Array(Math.round(rate*seconds));
 for(let i=0;i<samples.length;i++) {
  const t=i/rate, syllable=t%.47, envelope=Math.min(1,syllable/.025)*Math.min(1,Math.max(0,(.37-syllable)/.06));
  const f0=130, vowel=Math.floor(t/.47)%3, f1=[450,700,320][vowel],f2=[1700,1150,2200][vowel];
  let voiced=0;for(let n=1;n<=30;n++){const f=n*f0;const weight=.12/n+.17*Math.exp(-(((f-f1)/220)**2))+.11*Math.exp(-(((f-f2)/400)**2));voiced+=weight*Math.sin(2*Math.PI*f*t);}
  seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/4294967296*2-1;
  samples[i]=envelope*(.22*voiced+(syllable<.04?.035*noise:0))*(t<seconds/2?.35:1);
 }
 return samples;
}
export function measureTimbres(rate=24000) {
 const source=speechSurrogate(rate),start=Math.round(rate*.15),stop=source.length;
 const settings={...DEFAULTS,quality:100,noise:0,cueLevel:0,tailMs:0,output:80,radio:'analog',perspective:'receiver'};
 const renders={},stats={},pairs={};
 for(const key of Object.keys(TIMBRE_PROFILES)){
  const raw=renderRadio(source,rate,applyTimbre(settings,key),99), gain=.055/rms(raw.subarray(start,stop));
  const matched=Float32Array.from(raw,x=>x*gain);renders[key]=matched;
  stats[key]={gain,matchedRms:rms(matched.subarray(start,stop))};
  stats[key].peak=matched.reduce((p,x)=>Math.max(p,Math.abs(x)),0);
  stats[key].quietLoudContrastDb=20*Math.log10(rms(matched.subarray(rate*2.2,rate*3.8))/rms(matched.subarray(rate*.2,rate*1.8)));
 }
 const keys=Object.keys(renders);for(let a=0;a<keys.length;a++)for(let b=a+1;b<keys.length;b++){
  const x=renders[keys[a]],y=renders[keys[b]];let delta=0;for(let i=start;i<stop;i++)delta+=(x[i]-y[i])**2;
  pairs[`${keys[a]}/${keys[b]}`]=Math.sqrt(delta/(stop-start))/.055;
 }
 return {source,renders,stats,pairs};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const directory=process.argv[2]||'test-results/timbre';await mkdir(directory,{recursive:true});
 const rate=24000,{source,renders,stats,pairs}=measureTimbres(rate);
 await writeFile(resolve(directory,'synthetic-source.wav'),new Uint8Array(encodeWav(source,rate)));
 for(const [key,samples]of Object.entries(renders))await writeFile(resolve(directory,`${key}-rms-matched.wav`),new Uint8Array(encodeWav(samples,rate)));
 await writeFile(resolve(directory,'measurements.json'),JSON.stringify({notice:'Synthetic voiced/fricative surrogate, shared-window RMS match; not human listening, LUFS, intelligibility or equipment calibration.',rate,stats,pairwiseRelativeDifferenceRms:pairs},null,2)+'\n');
 console.log(JSON.stringify({stats,pairs},null,2));
}
