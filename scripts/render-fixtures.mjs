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
console.log(`Wrote synthetic comparison WAVs and measurements to ${directory}`);
