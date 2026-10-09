// Reproduce the input-drive/CNR comparison. No downloads or output audio.
// Ratio is a least-squares clean-waveform projection over the entire fixture
// INCLUDING pauses. It is NOT standardized SINAD, SNR certification, or a
// listening-quality score. Both noisy runs use identical CNR and PRNG seed.
import { readFileSync } from 'node:fs';
import { AnalogFM } from '../src/analog-fm.js';
import { proposeInputCalibration } from '../src/input-calibration.js';
function wav(path) {
  const b=readFileSync(path);let rate,pcm;
  for(let at=12;at<b.length;){const n=b.readUInt32LE(at+4),id=b.toString('ascii',at,at+4);if(id==='fmt ')rate=b.readUInt32LE(at+12);if(id==='data')pcm=b.subarray(at+8,at+8+n);at+=8+n+(n%2);}
  return {rate,samples:Float32Array.from({length:pcm.length/2},(_,i)=>pcm.readInt16LE(i*2)/32768)};
}
const rows=[];
for(const speaker of ['bdl','slt']) {
  const {rate,samples}=wav(new URL(`../assets/speech/clean-human-${speaker}-a0001-a0003.wav`,import.meta.url));
  const probe=new AnalogFM(rate);let sum=0,count=0;
  for(let i=0;i<rate*.4;i++){probe.processSample(.05*Math.sin(2*Math.PI*1000*i/rate));if(i>=rate*.2){sum+=probe.instantaneousDeviationHz**2;count++;}}
  const responseAt1k=Math.sqrt(sum/count)/(2500*.05/Math.SQRT2);
  const proposed=proposeInputCalibration(samples,rate,{responseAt1k});
  for(const txInputGainDb of [0,proposed.gainDb]) {
    const clean=new AnalogFM(rate,{txInputGainDb}),noisy=new AnalogFM(rate,{txInputGainDb,cnrDb:8.8,seed:71});
    let cc=0,nn=0,cn=0;
    for(const x of samples){const c=clean.processSample(x),n=noisy.processSample(x);cc+=c*c;nn+=n*n;cn+=c*n;}
    const projectionPower=cn*cn/cc;
    rows.push({speaker,rate,cnrDb:noisy.cnrDb,txInputGainDb,noiseStd:noisy.noiseStd,finalNoiseSeed:noisy.seed,
      projectionSignalToResidualDb:10*Math.log10(projectionPower/(nn-projectionPower)),correlation:cn/Math.sqrt(cc*nn),
      internalLimiterFraction:clean.txLimitedSamples/clean.txMeterSamples,internalGuardFraction:clean.txGuardLimitedSamples/clean.txMeterSamples});
  }
}
console.log(JSON.stringify({metric:'full-fixture clean-projection/residual; includes pauses; NOT SINAD or listening score',rows},null,2));
