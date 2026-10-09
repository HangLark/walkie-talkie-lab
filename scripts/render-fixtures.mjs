// Synthetic fixtures only: never captures a microphone or uses a person's voice.
import { mkdir, writeFile } from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {RadioKernel,PRESETS} from '../src/dsp.js';
import {encodeWav} from '../src/wav.js';
const directory=process.argv[2]||'test-results/audio';await mkdir(directory,{recursive:true});
const rate=48000, length=rate*3;
const speech=Float32Array.from({length},(_,i)=>{const t=i/rate,p=t%.65,envelope=Math.min(1,p*40)*Math.min(1,Math.max(0,(.48-p)*30));return envelope*(.15*Math.sin(2*Math.PI*145*t)+.09*Math.sin(2*Math.PI*725*t)+.05*Math.sin(2*Math.PI*2030*t));});
const silence=new Float32Array(length),summary={};
async function render(name,Kernel,params,input){
 const k=new Kernel(rate,{...params,tx:false}),out=new Float32Array(rate*4);
 for(let i=0;i<out.length;i++){if(i===rate*.25)k.setParams({tx:true});if(i===rate*3.25)k.setParams({tx:false});out[i]=k.processSample(input[i-rate*.25]||0);}
 await writeFile(resolve(directory,`${name}.wav`),new Uint8Array(encodeWav(out,rate)));
 const rms=(a,b)=>{let sum=0;for(let i=a*rate;i<b*rate;i++)sum+=out[i]**2;return Math.sqrt(sum/((b-a)*rate));};
 summary[name]={peak:out.reduce((m,x)=>Math.max(m,Math.abs(x)),0),startRms:rms(.25,.274),bodyRms:rms(.4,3.2),endRms:rms(3.274,3.384)};
}
await writeFile(resolve(directory,'synthetic-dry.wav'),new Uint8Array(encodeWav(speech,rate)));
for(const name of ['patrol','operator','digital','fringe']){
 await render(`${name}-synthetic`,RadioKernel,PRESETS[name],speech);
 await render(`${name}-silent-cues`,RadioKernel,{...PRESETS[name],noise:0},silence);
}
if(process.argv[3]){const baseline=await import(pathToFileURL(resolve(process.argv[3])));await render('baseline-patrol-synthetic',baseline.RadioKernel,baseline.PRESETS.patrol,speech);await render('baseline-patrol-silent-cues',baseline.RadioKernel,{...baseline.PRESETS.patrol,noise:0},silence);}
await writeFile(resolve(directory,'measurements.json'),JSON.stringify(summary,null,2)+'\n');

// Dynamics diagnostics are synthetic measurements, not intelligibility scores.
const {SpeechLeveler,BurstFrameChannel,renderRadio}=await import('../src/dsp.js');
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
const tone=(seconds,amplitude)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amplitude*Math.sin(2*Math.PI*731*i/rate));
const quiet=tone(2,.03),loud=tone(2,.3);
const leveled=[quiet,loud].map(input=>{const k=new SpeechLeveler(rate);return Float32Array.from(input,x=>k.tick(x,100));});
summary.dynamics={inputContrastDb:20*Math.log10(rms(loud)/rms(quiet)),leveledContrastDb:20*Math.log10(rms(leveled[1].slice(rate))/rms(leveled[0].slice(rate)))};
const hiss=tone(2,.003),leveler=new SpeechLeveler(rate),hissOut=Float32Array.from(hiss,x=>leveler.tick(x,100));
summary.dynamics.lowHissGainDb=20*Math.log10(rms(hissOut)/rms(hiss));
summary.dynamics.digitalFrames={};
for(const quality of [96,48,20]){
 const channel=new BurstFrameChannel(rate,99);
 for(let i=0;i<rate*20;i++)channel.tick(.1,quality);
 summary.dynamics.digitalFrames[quality]={frames:channel.totalFrames,lost:channel.lostFrames,longestBurstFrames:channel.maxRun};
}
const varying=new Float32Array(rate*6);varying.set(quiet,0);varying.set(loud,rate*2);varying.set(hiss,rate*4);
await writeFile(resolve(directory,'dynamics-dry.wav'),new Uint8Array(encodeWav(varying,rate)));
async function diagnostics(label,module){
 const params={...module.PRESETS.clean,quality:100,noise:0,cueLevel:0,tailMs:0};
 const out=module.renderRadio(varying,rate,params,99);
 await writeFile(resolve(directory,`${label}-dynamics.wav`),new Uint8Array(encodeWav(out,rate)));
 const analog=module.renderRadio(speech,rate,{...params,radio:'analog'},99),digital=module.renderRadio(speech,rate,{...params,radio:'digital'},99);
 const delta=digital.slice(rate/2,rate*2.5).map((x,i)=>x-analog[i+rate/2]);
 summary.dynamics[label]={bodyContrastDb:20*Math.log10(rms(out.slice(rate*3,rate*4))/rms(out.slice(rate,rate*2))),strongDigitalVsAnalogDifferenceRms:rms(delta)};
 await writeFile(resolve(directory,`${label}-digital-strong.wav`),new Uint8Array(encodeWav(digital,rate)));
 const weak=module.renderRadio(varying,rate,{...params,radio:'digital',quality:30,squelch:0},99);
 await writeFile(resolve(directory,`${label}-digital-weak.wav`),new Uint8Array(encodeWav(weak,rate)));
}
await diagnostics('current',{PRESETS,renderRadio});
if(process.argv[3])await diagnostics('baseline',await import(pathToFileURL(resolve(process.argv[3]))));
await writeFile(resolve(directory,'measurements.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`Wrote synthetic comparison WAVs and measurements to ${directory}`);
