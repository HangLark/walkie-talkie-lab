// Reproducible developer diagnostics using the licensed bundled CMU recordings.
// No microphone access, upload, hardware-fidelity score or P.56 claim.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {AnalogFM} from '../src/analog-fm.js';
import {RadioKernel} from '../src/dsp.js';
import {proposeInputCalibration} from '../src/input-calibration.js';
import {encodeWav} from '../src/wav.js';
const directory=resolve(process.argv[2]||'test-results/transmitter');await mkdir(directory,{recursive:true});
const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length),peak=x=>x.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
const quantiles=x=>{const a=x.sort((a,b)=>a-b);return {p05:a[Math.floor(a.length*.05)],p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]};};
function decode(bytes){const rate=bytes.readUInt32LE(24);let offset=12;while(bytes.toString('ascii',offset,offset+4)!=='data')offset+=8+bytes.readUInt32LE(offset+4);const input=new Float32Array(bytes.readUInt32LE(offset+4)/2);for(let i=0;i<input.length;i++)input[i]=bytes.readInt16LE(offset+8+i*2)/32768;return {rate,input};}
function responseAt1k(rate){const k=new AnalogFM(rate);let sum=0,count=0;for(let n=0;n<rate*.3;n++){k.processSample(.1*Math.sin(2*Math.PI*1000*n/rate));if(n>=rate*.1){sum+=k.instantaneousDeviationHz**2;count++;}}return Math.sqrt(sum/count)*Math.SQRT2/250;}
function activeMask(input,rate){const frame=Math.round(rate*.02),power=[];for(let start=0;start<input.length;start+=frame){let p=0;for(let n=start;n<Math.min(start+frame,input.length);n++)p+=input[n]**2;power.push(p/Math.min(frame,input.length-start));}const sorted=power.filter(p=>p>=1e-7).sort((a,b)=>a-b),threshold=Math.max(1e-7,sorted[Math.floor((sorted.length-1)*.9)]*.01);return n=>n>=Math.round(rate*.12)&&n<input.length&&power[Math.floor(n/frame)]>=threshold;}
const report={description:'Original generic TX chain diagnostics. Clean CMU speech, not paired physical-radio data. Above-full-scale synthetic loud input is kept as float for stress testing; delivered WAVs are attenuated before PCM encoding.',referenceConvention:'RMS relative to digital overload amplitude 1. Full-scale sine is -3.0103 dB. Calibration is approximate windowed RMS, not P.56.',listening:'Compare same voice and relative-level files with identical listening volume. Every variant and raw-A in each group shares one active mask, RMS target and common peak headroom. Matching attenuates only, is not LUFS, and nominal 24 ms alignment does not remove filter group delay.',cases:[]};
for(const voice of ['bdl','slt']){
 const {rate,input:original}=decode(await readFile(new URL(`../assets/speech/clean-human-${voice}-a0001-a0003.wav`,import.meta.url)));
 const response=responseAt1k(rate),calibration=proposeInputCalibration(original,rate,{responseAt1k:response});
 for(const relativeDb of [-12,0,12]){
  const input=Float32Array.from(original,x=>x*10**(relativeDb/20)),active=activeMask(input,rate),delay=Math.round(rate*.024),group=[],dry=new Float32Array(input.length+Math.round(rate*.35));for(let n=0;n<input.length;n++)dry[n+delay]=input[n]*.8;
  const variants=[{name:'previous-unity',gain:0,agc:false,bypass:true},{name:'nominal-agc-off',gain:calibration.gainDb,agc:false},{name:'nominal-agc-on',gain:calibration.gainDb,agc:true}];
  for(const variant of variants){
   const k=new RadioKernel(rate,{quality:100,tailMs:0,txInputGainDb:variant.gain,txMicAgc:variant.agc},42),out=new Float32Array(dry.length);if(variant.bypass)k.fm.txPostLimit.tick=x=>x;
   let inputIndex=0,count=0,limited=0,guard=0,prePower=0,prePeak=0,postPower=0,postPeak=0,safety=0,outputActive=0;const gain=[];
   const baseband=k.fm.basebandSample.bind(k.fm);k.fm.basebandSample=(x,carrier)=>{const y=baseband(x,carrier);if(carrier&&active(inputIndex-delay)){count++;limited+=k.fm.txLimited;guard+=k.fm.txGuardLimited;prePower+=k.fm.txPreLimit**2;prePeak=Math.max(prePeak,Math.abs(k.fm.txPreLimit));postPower+=k.fm.instantaneousDeviationHz**2;postPeak=Math.max(postPeak,Math.abs(k.fm.instantaneousDeviationHz));}return y;};
   const presence=k.presence.tick.bind(k.presence);k.presence.tick=x=>{const y=presence(x);if(active(inputIndex-delay)){safety+=Math.abs(y)>.85;outputActive++;}return y;};
   for(inputIndex=0;inputIndex<out.length;inputIndex++){if(inputIndex===input.length)k.setParams({tx:false});out[inputIndex]=k.processSample(input[inputIndex]||0);if(active(inputIndex-delay))gain.push(k.fm.txAgc.appliedGainDb);}
   let power=0,samples=0;for(let n=0;n<out.length;n++)if(active(n-delay)){power+=out[n]**2;samples++;}
   const measurement={voice,relativeDb,variant:variant.name,rate,sourcePeak:peak(input),sourceFullRms:rms(input),calibrationGainDb:calibration.gainDb,responseAt1k:response,appliedInputGainDb:variant.gain,agc:variant.agc,activeSeconds:samples/rate,internalActiveSamples:count,preLimitPeakDeviationHz:prePeak*2500,preLimitRmsDeviationHz:Math.sqrt(prePower/count)*2500,actualPeakDeviationHz:postPeak,actualRmsDeviationHz:Math.sqrt(postPower/count),limiterFraction:limited/count,guardFraction:guard/count,agcGainDb:quantiles(gain),outputSafetyFraction:safety/outputActive,outputActiveRms:Math.sqrt(power/samples),outputPeak:peak(out)};
   group.push({name:variant.name,audio:out,rms:measurement.outputActiveRms,measurement});report.cases.push(measurement);
  }
  let dryPower=0,drySamples=0;for(let n=0;n<dry.length;n++)if(active(n-delay)){dryPower+=dry[n]**2;drySamples++;}group.unshift({name:'raw-A',audio:dry,rms:Math.sqrt(dryPower/drySamples)});
  const target=Math.min(...group.map(g=>g.rms));let maximum=0;for(const g of group)maximum=Math.max(maximum,peak(g.audio)*target/g.rms);const headroom=Math.min(1,.9/maximum);
  for(const g of group){const gain=target/g.rms*headroom,matched=Float32Array.from(g.audio,x=>x*gain),filename=`${voice}-${relativeDb===0?'normal':relativeDb<0?'quiet':'loud'}-${g.name}-matched.wav`;await writeFile(resolve(directory,filename),new Uint8Array(encodeWav(matched,rate)));if(g.measurement){g.measurement.listeningFile=filename;g.measurement.matchGainDb=20*Math.log10(gain);g.measurement.matchedActiveRms=target*headroom;}}
 }
}
await copyFile(new URL('../assets/speech/ATTRIBUTION.txt',import.meta.url),resolve(directory,'SPEECH-ATTRIBUTION.txt'));
await writeFile(resolve(directory,'measurements.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(directory,'LISTENING.txt'),`${report.description}\n\n${report.listening}\n\nFor each voice, normal uses its explicit model-reference file gain. Quiet and loud change source float amplitude by -12/+12 dB while keeping that setup gain fixed. AGC on/off comparisons therefore test bounded response to changed talk level. Previous-unity instruments out the new post-limiter filter and uses zero input gain and no mic AGC. No RF noise, fading or speaker coloration is present. Start at low headphone volume. These are numerical/listening fixtures, not evidence of a hardware match. Full source credit and licenses: SPEECH-ATTRIBUTION.txt.\n`);
console.log(JSON.stringify({directory,cases:report.cases.length,files:24,nominal:report.cases.filter(x=>x.relativeDb===0).map(x=>({voice:x.voice,variant:x.variant,gainDb:x.appliedInputGainDb,limiterPercent:x.limiterFraction*100,guardPercent:x.guardFraction*100,peakHz:x.actualPeakDeviationHz,agcGainDb:x.agcGainDb,safetyPercent:x.outputSafetyFraction*100}))},null,2));
