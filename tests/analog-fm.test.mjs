import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalogFM,qualityToCnrDb} from '../src/analog-fm.js';
const rates=[8000,22050,44100,48000,96000,192000];
function tone(rate,hz=1000,amplitude=.2,cnrDb=Infinity) {
 const k=new AnalogFM(rate,{cnrDb,seed:42});let power=0,devPower=0,peak=0;
 for(let i=0;i<rate*.3;i++){const y=k.processSample(amplitude*Math.sin(2*Math.PI*hz*i/rate));if(i>=rate*.1){power+=y*y;devPower+=k.instantaneousDeviationHz**2;peak=Math.max(peak,Math.abs(y));}}
 return {rms:Math.sqrt(power/(rate*.2)),deviationRms:Math.sqrt(devPower/(rate*.2)),peak,k};
}
test('FM phase increment realizes the stated deviation in physical Hz',()=>{
 const k=new AnalogFM(48000);let previous=0;
 for(let n=0;n<24000;n++){k.processSample(.4*Math.sin(2*Math.PI*1000*n/48000));let delta=k.phase-previous;delta=Math.atan2(Math.sin(delta),Math.cos(delta));assert.ok(Math.abs(delta*48000/(2*Math.PI)-k.instantaneousDeviationHz)<1e-8);assert.ok(Math.abs(k.instantaneousDeviationHz)<=2500);previous=k.phase;}
 const t=tone(48000,1000,.4);assert.ok(Math.abs(t.deviationRms-1000/Math.sqrt(2))<5);
});
test('noiseless 1 kHz roundtrip preserves level and filter-normalized 300–3000 Hz speech',()=>{
 for(const rate of rates){const t=tone(rate);assert.ok(Math.abs(t.rms-.2/Math.sqrt(2))<.002,`${rate}: ${t.rms}`);assert.ok(t.k.confidence>.99);}
 for(const hz of [500,1000,2000,2500,3000]){const reference=tone(48000,hz).rms;for(const rate of [44100,96000,192000]){const db=20*Math.log10(tone(rate,hz).rms/reference);assert.ok(Math.abs(db)<.22,`${rate}/${hz}: ${db} dB`);}}
});
test('noiseless silence is exactly silent; seeded AWGN rises with decreasing CNR before FM threshold',()=>{
 const noise=[];
 for(const cnrDb of [Infinity,40,30,20,0]){const t=tone(48000,1000,0,cnrDb);noise.push(t.rms);assert.ok(t.k.noiseBandwidthHz>10000&&t.k.noiseBandwidthHz<15000);}
 assert.equal(noise[0],0);for(let i=2;i<4;i++)assert.ok(noise[i]/noise[i-1]>2.8&&noise[i]/noise[i-1]<3.6);assert.ok(noise[4]>noise[3]*15);
});
test('noise detector responds to channel loss rather than speech pauses',()=>{
 const strong=tone(48000,1000,.2,30),silent=tone(48000,1000,0,30),weak=tone(48000,1000,.2,0);
 assert.ok(strong.k.confidence>.8&&silent.k.confidence>.8);assert.ok(weak.k.confidence<.05);
 for(let n=0;n<24000;n++)strong.k.processSample(0,false);assert.ok(strong.k.confidence<.05);
});
test('all supported rates and CNR extremes give finite bounded output and deviation',()=>{
 for(const rate of rates)for(const cnrDb of [Infinity,120,0,-60]){const k=new AnalogFM(rate,{cnrDb});for(let n=0;n<rate*.06;n++){const x=n<3?[NaN,Infinity,-Infinity][n]:8*Math.sin(n*.891);const y=k.processSample(x,n%1000<900);assert.ok(Number.isFinite(y)&&Math.abs(y)<=2);assert.ok(Math.abs(k.instantaneousDeviationHz)<=2500);}}
 assert.throws(()=>new AnalogFM(7999),RangeError);assert.throws(()=>new AnalogFM(192001),RangeError);
});
test('sample processing is partition invariant, repeatable and seed-sensitive',()=>{
 const input=Float32Array.from({length:12037},(_,i)=>.2*Math.sin(i*.27));
 for(const rate of [8000,44100,48000]){const a=new AnalogFM(rate,{cnrDb:18,seed:72}).process(input),b=new Float32Array(input.length),k=new AnalogFM(rate,{cnrDb:18,seed:72});for(let start=0;start<input.length;start+=127)k.process(input.subarray(start,start+127),b.subarray(start,start+127));assert.deepEqual(a,b);assert.notDeepEqual(a,new AnalogFM(rate,{cnrDb:18,seed:73}).process(input));}
});
test('short speech-like onset/sibilants and release remain present without carrier gating',()=>{
 const rate=48000,k=new AnalogFM(rate),bins=new Float64Array(5);
 for(let n=0;n<rate*.1;n++){const t=n/rate;const input=t<.025?.16*Math.sin(2*Math.PI*800*t):t<.05?.08*Math.sin(2*Math.PI*2600*t):0;const y=k.processSample(input);bins[Math.min(4,Math.floor(t/.02))]+=y*y;}
 assert.ok(bins[0]>.1&&bins[1]>.01&&bins[2]>.001);assert.ok(bins[4]<1e-8);
});
test('UI quality mapping identifies noiseless endpoint and is explicitly monotonic CNR',()=>{assert.equal(qualityToCnrDb(100),Infinity);assert.equal(qualityToCnrDb(0),-8);assert.ok(qualityToCnrDb(80)>qualityToCnrDb(40));});
