// Deterministic tone diagnostics. This is not a regulatory emission-mask test.
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {AnalogFM} from '../src/analog-fm.js';
const destination=resolve(process.argv[2]||'test-results/transmitter/spectral-measurements.json');
const rate=48000,TAU=2*Math.PI;
function harmonicPower(x,hz){let re=0,im=0;for(let n=0;n<x.length;n++){re+=x[n]*Math.cos(TAU*hz*n/rate);im+=x[n]*Math.sin(TAU*hz*n/rate);}return (re*re+im*im)*4/(x.length*x.length);}
function rfPower(i,q){const n=i.length;let total=0,outside=0;for(let bin=0;bin<n;bin++){let re=0,im=0;for(let t=0;t<n;t++){const a=TAU*bin*t/n;re+=i[t]*Math.cos(a)+q[t]*Math.sin(a);im+=q[t]*Math.cos(a)-i[t]*Math.sin(a);}const power=(re*re+im*im)/(n*n),hz=(bin<=n/2?bin:bin-n)*rate/n;total+=power;if(Math.abs(hz)>6250)outside+=power;}return outside/total;}
function harmonics(x){return Object.fromEntries([2000,6000,10000,14000,18000,22000].map(hz=>[hz,harmonicPower(x,hz)]));}
const aboveBand=h=>Object.entries(h).filter(([hz])=>+hz>3000).reduce((s,[,v])=>s+v,0);
const overload={};
for(const bypass of [true,false]){
 const k=new AnalogFM(rate,{txInputGainDb:24});if(bypass)k.txPostLimit.tick=x=>x;
 const deviation=[],beforeGuard=[],i=[],q=[];let filteredPeak=0;
 for(let n=0;n<rate;n++){k.processSample(.5*Math.sin(TAU*2000*n/rate));if(n>=rate/2)filteredPeak=Math.max(filteredPeak,Math.abs(k.txPostLimitValue));if(n>=rate-240){deviation.push(k.instantaneousDeviationHz);beforeGuard.push(k.txPostLimitValue*2500);i.push(Math.cos(k.phase));q.push(Math.sin(k.phase));}}
 const h=harmonics(deviation),before=harmonics(beforeGuard);
 overload[bypass?'withoutPostFilter':'withPostFilterAndGuard']={filteredPeak,limiterFraction:k.txLimitedSamples/k.txMeterSamples,guardFraction:k.txGuardLimitedSamples/k.txMeterSamples,harmonicPower:h,beforeGuardHarmonicPower:before,audioOutOfBandPower:aboveBand(h),beforeGuardAudioOutOfBandPower:aboveBand(before),rfPowerOutside6250Hz:rfPower(i,q)};
}
const clean={};
for(const hz of [1000,3000]){
 const k=new AnalogFM(rate),samples=[];
 for(let n=0;n<rate;n++){const y=k.processSample(.1*Math.sin(TAU*hz*n/rate));if(n>=rate-4800)samples.push(y);}
 const fundamental=harmonicPower(samples,hz);let higher=0;for(let h=2;h<=8&&hz*h<rate/2;h++)higher+=harmonicPower(samples,hz*h);
 clean[hz]={fundamentalAmplitude:Math.sqrt(fundamental),thdDb:10*Math.log10(higher/fundamental)};
}
const harmonicReductionDb=10*Math.log10(overload.withPostFilterAndGuard.audioOutOfBandPower/overload.withoutPostFilter.audioOutOfBandPower),guardHarmonicIncreaseDb=10*Math.log10(overload.withPostFilterAndGuard.audioOutOfBandPower/overload.withPostFilterAndGuard.beforeGuardAudioOutOfBandPower);
const report={test:'Severe 2 kHz sine, peak .5, +24 dB drive, native 48 kHz. Final 240 samples contain ten periods after settling. Complex-FM spectral power beyond ±6250 Hz is an illustrative diagnostic, not regulatory occupied-bandwidth compliance. Clean metrics use .1 peak tone, 0 dB and AGC off.',harmonicReductionDb,guardHarmonicIncreaseDb,clean,overload};
await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
