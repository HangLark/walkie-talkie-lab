import test from 'node:test';
import assert from 'node:assert/strict';
import {AnalogFM,AnalogMicAGC,TX_AUDIO_MODEL} from '../src/analog-fm.js';
import {DEFAULTS,RadioKernel,renderRadio,sanitizeParams,TIMBRE_KEYS} from '../src/dsp.js';
const rates=[8000,16000,44100,48000,96000,192000];
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
function harmonicPower(x,hz,rate){let re=0,im=0;for(let n=0;n<x.length;n++){re+=x[n]*Math.cos(2*Math.PI*hz*n/rate);im+=x[n]*Math.sin(2*Math.PI*hz*n/rate);}return (re*re+im*im)*4/(x.length*x.length);}

test('TX controls are explicit bounded source settings, with unchanged zero/off defaults',()=>{
 assert.equal(DEFAULTS.txInputGainDb,0);assert.equal(DEFAULTS.txMicAgc,false);
 assert.equal(sanitizeParams({txInputGainDb:Infinity,txMicAgc:'true'}).txInputGainDb,0);
 assert.equal(sanitizeParams({txInputGainDb:100,txMicAgc:true}).txInputGainDb,24);
 assert.equal(sanitizeParams({txInputGainDb:-100}).txInputGainDb,-12);
 assert.equal(sanitizeParams({txMicAgc:'true'}).txMicAgc,false);
 assert.ok(!TIMBRE_KEYS.includes('txInputGainDb')&&!TIMBRE_KEYS.includes('txMicAgc'));
});

test('bounded mic AGC reaches its stated digital-RMS target or correction endpoints',()=>{
 for(const rate of rates)for(const amplitude of [.04,.3,1,4]){
  const k=new AnalogMicAGC(rate,true);let last=0;
  for(let n=0;n<rate*3;n++){k.tick(amplitude*Math.sin(2*Math.PI*731*n/rate),true);assert.ok(k.gainDb>=-12&&k.gainDb<=6);last=k.gainDb;}
  const expected=Math.max(-12,Math.min(6,20*Math.log10(.25/(amplitude/Math.SQRT2))));
  assert.ok(Math.abs(last-expected)<.09,`${rate}/${amplitude}: ${last} vs ${expected}`);
 }
});

test('AGC quiet policy does not boost below-floor noise and never makes sound from silence',()=>{
 const rate=48000,k=new AnalogMicAGC(rate,true);
 for(let n=0;n<rate;n++){const x=.002*Math.sin(n*.31);assert.equal(k.tick(x,true),x);}assert.equal(k.gainDb,0);
 for(let n=0;n<rate;n++)k.tick(.04*Math.sin(n*.31),true);assert.ok(k.gainDb>5.8);
 for(let n=0;n<rate*2;n++)assert.equal(k.tick(0,true),0);assert.ok(k.gainDb<.05);
 for(let n=0;n<rate;n++)k.tick(2*Math.sin(n*.31),true);assert.ok(k.gainDb<-11.9);
 while(k.active)k.tick(0,true);
 const held=k.gainDb;for(let n=0;n<rate;n++)k.tick(0,true);assert.equal(k.gainDb,held);
 const state=[k.power,k.gainDb];for(let n=0;n<rate;n++)k.tick(8,true,false);assert.deepEqual([k.power,k.gainDb],state);assert.equal(k.frozen,true);
});

test('AGC corrects a controllable 12 dB source step, smoothly toggles, and off is unity',()=>{
 const rate=48000,k=new AnalogMicAGC(rate,true);
 for(let n=0;n<rate*3;n++)k.tick(.2*Math.sin(n*.17),true);const quiet=k.gainDb;
 for(let n=0;n<rate*3;n++)k.tick(.2*10**(.6)*Math.sin(n*.17),true);assert.ok(Math.abs(quiet-k.gainDb-12)<.15);
 let previous=k.appliedGainDb,maxStep=0;
 for(let n=0;n<rate;n++){k.tick(.2*Math.sin(n*.17),false);maxStep=Math.max(maxStep,Math.abs(k.appliedGainDb-previous));previous=k.appliedGainDb;}
 assert.ok(maxStep<.03);assert.equal(k.appliedGainDb,0);
 const disabled=new AnalogMicAGC(rate);for(let n=0;n<rate;n++){const x=.8*Math.sin(n*.17);assert.equal(disabled.tick(x,false),x);}
});

test('explicit unity input convention and dB gain give predictable 1 kHz FM deviation',()=>{
 for(const rate of rates)for(const gainDb of [-12,0,6]){
  const k=new AnalogFM(rate,{txInputGainDb:gainDb});let sum=0,count=0;
  for(let n=0;n<rate*.3;n++){k.processSample(.2*Math.sin(2*Math.PI*1000*n/rate));if(n>=rate*.1){sum+=k.instantaneousDeviationHz**2;count++;}}
  const expected=2500*.2*10**(gainDb/20)/Math.SQRT2;
  assert.ok(Math.abs(Math.sqrt(sum/count)/expected-1)<.009,`${rate}/${gainDb}`);
 }
});

test('post-limiter filter is nearly flat in-band and removes some clipping harmonics even after guard',()=>{
 for(const rate of rates){
  for(const hz of [300,1000,3000]){
   const a=new AnalogFM(rate),b=new AnalogFM(rate);b.txPostLimit.tick=x=>x;let pa=0,pb=0;
   for(let n=0;n<rate*.3;n++){const x=.1*Math.sin(2*Math.PI*hz*n/rate),ya=a.processSample(x),yb=b.processSample(x);if(n>=rate*.1){pa+=ya*ya;pb+=yb*yb;}}
   const db=10*Math.log10(pa/pb);assert.ok(db<.005&&db>-.045,`${rate}/${hz}: ${db} dB`);
  }
 }
 const rate=48000,a=new AnalogFM(rate,{txInputGainDb:24}),b=new AnalogFM(rate,{txInputGainDb:24});b.txPostLimit.tick=x=>x;
 const filtered=new Float64Array(rate/5),unfiltered=new Float64Array(rate/5);
 for(let n=0;n<rate*.4;n++){const x=.5*Math.sin(2*Math.PI*2000*n/rate);a.processSample(x);b.processSample(x);if(n>=rate*.2){filtered[n-rate*.2]=a.instantaneousDeviationHz;unfiltered[n-rate*.2]=b.instantaneousDeviationHz;}assert.ok(Math.abs(a.instantaneousDeviationHz)<=2500);}
 const filteredOutOfBand=[6000,10000,14000,18000,22000].reduce((s,hz)=>s+harmonicPower(filtered,hz,rate),0),unfilteredOutOfBand=[6000,10000,14000,18000,22000].reduce((s,hz)=>s+harmonicPower(unfiltered,hz,rate),0);
 assert.ok(filteredOutOfBand<unfilteredOutOfBand*.2,`harmonic power ratio ${filteredOutOfBand/unfilteredOutOfBand}`);
 assert.ok(a.txGuardLimitedSamples>0,'postfilter overshoot is measured rather than assumed absent');
});

test('TX gain and AGC never stack with artistic leveler, affect raw A, or alter alternate routes',()=>{
 const rate=16000,x=Float32Array.from({length:rate},(_,n)=>.07*Math.sin(n*.29));
 const p={quality:100,tailMs:0,txInputGainDb:12,txMicAgc:true};
 assert.deepEqual(renderRadio(x,rate,{...p,leveler:0},42),renderRadio(x,rate,{...p,leveler:100},42));
 for(const settings of [{perspective:'operator'},{radio:'digital'},{mix:0}])assert.deepEqual(renderRadio(x,rate,{...settings,txInputGainDb:0,txMicAgc:false},42),renderRadio(x,rate,{...settings,txInputGainDb:24,txMicAgc:true},42));
});

test('TX state, low-rate internal-peak telemetry and export remain partition exact',()=>{
 for(const rate of [8000,44100,48000]){
  const p={quality:35,fmMonitor:true,fmPropagation:'moving',txInputGainDb:18,txMicAgc:true},x=Float32Array.from({length:Math.round(rate*.7)},(_,n)=>.3*Math.sin(n*.39)),a=new RadioKernel(rate,p,77),b=new RadioKernel(rate,p,77),out=a.process(x),parts=new Float32Array(x.length);
  for(let n=0;n<x.length;n+=127){b.process(x.subarray(n,n+127),parts.subarray(n,n+127));b.fm.resetTxMeter();}
  assert.deepEqual(out,parts);assert.equal(a.fm.seed,b.fm.seed);assert.equal(a.fm.txAgc.gainDb,b.fm.txAgc.gainDb);
  const full=renderRadio(x,rate,p,77),c=new RadioKernel(rate,p,77),copy=new Float32Array(full.length);
  for(let n=0;n<copy.length;n++){if(n===x.length)c.setParams({tx:false});copy[n]=c.processSample(x[n]||0);}assert.deepEqual(copy,full);
  assert.ok(full.every(x=>Number.isFinite(x)&&Math.abs(x)<.98));
 }
 const a=new AnalogFM(8000,{txInputGainDb:24}),b=new AnalogFM(8000,{txInputGainDb:24});let peak=0;const original=b.basebandSample.bind(b);b.basebandSample=(x,c)=>{const y=original(x,c);if(c)peak=Math.max(peak,Math.abs(b.instantaneousDeviationHz));return y;};
 for(let n=0;n<803;n++){const x=.3*Math.sin(n*.71);a.processSample(x);b.processSample(x);}assert.equal(a.txDeviationPeakHz,peak);assert.equal(a.txMeterSamples,803*6);a.resetTxMeter();assert.equal(a.txDeviationPeakHz,0);assert.equal(a.txMeterSamples,0);
});

test('live input-drive and AGC changes are smooth, bounded and do not reset a keyed burst',()=>{
 const rate=48000,a=new RadioKernel(rate,{quality:100,tailMs:0}),b=new RadioKernel(rate,{quality:100,tailMs:0});
 for(let n=0;n<rate*.4;n++){const x=.03*Math.sin(n*.1);a.processSample(x);b.processSample(x);}
 const burst=a.burstCount;a.setParams({txInputGainDb:24,txMicAgc:true});
 const x=.03*Math.sin(rate*.4*.1),ya=a.processSample(x),yb=b.processSample(x);assert.ok(Math.abs(ya-yb)<1e-7,'no abrupt signal-path jump on the control sample');
 let gain=a.fm.txInputGainDb,last=ya,maxStep=0;
 for(let n=0;n<rate*.6;n++){
  if(n===rate*.2)a.setParams({txInputGainDb:-12,txMicAgc:false});
  const y=a.processSample(.03*Math.sin((rate*.4+1+n)*.1));
  assert.ok(Math.abs(a.fm.txInputGainDb-gain)<36/(.02*rate));gain=a.fm.txInputGainDb;
  maxStep=Math.max(maxStep,Math.abs(y-last));last=y;assert.ok(Number.isFinite(y)&&Math.abs(y)<.98);
 }
 assert.ok(maxStep<.09,`${maxStep} signal sample step`);assert.equal(a.burstCount,burst);assert.equal(a.wasTransmit,true);
});
