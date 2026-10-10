import test from 'node:test';
import assert from 'node:assert/strict';
import {RadioKernel,DEFAULTS,renderRadio} from '../src/dsp.js';
const silence=n=>new Float32Array(n);
const peak=a=>a.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
test('noiseless carrier-off does not turn undefined IQ phase into a release click',()=>{
 for(const rate of [8000,16000,44100,48000,192000])for(const tailMs of [0,110,200]){
  const k=new RadioKernel(rate,{quality:100,tailMs});k.process(silence(rate/2));k.setParams({tx:false});const y=k.process(silence(Math.round(rate*.35)));assert.equal(peak(y),0);
 }
});
test('zero-tail precloses before noisy RF removal and enabled tail has a soft bounded output',()=>{
 for(const rate of [8000,16000,44100,48000,192000])for(const tailMs of [0,110]){
  const k=new RadioKernel(rate,{quality:90,tailMs});k.process(silence(rate/2));k.setParams({tx:false});const y=k.process(silence(Math.round(rate*.35)));
  if(!tailMs){assert.ok(peak(y)<.03);assert.ok(peak(y.subarray(Math.ceil(rate*.044)))<1e-10);}
  else {assert.ok(peak(y)<=.768001);assert.ok(rms(y)<.15);assert.ok(peak(y.subarray(Math.ceil(rate*.15)))<1e-8);}
 }
});
test('weak channel acquisition cannot blast initial noise before detector settles',()=>{
 for(const rate of [8000,16000,44100,48000,192000]){const k=new RadioKernel(rate,{quality:30});assert.ok(peak(k.process(silence(Math.round(rate*.3))))<.02);}
});
test('selector changes preserve queued voice and release, then adopt the idle selection',()=>{
 const a=new RadioKernel(48000,{quality:85},23),b=new RadioKernel(48000,{quality:85},23),voice=Float32Array.from({length:6000},(_,n)=>.2*Math.sin(n*.2));a.process(voice);b.process(voice);a.setParams({tx:false});b.setParams({tx:false,radio:'digital',perspective:'operator'});assert.deepEqual(a.process(silence(7200)),b.process(silence(7200)));b.process(silence(4800));assert.equal(b.burstCount,1);assert.equal(b.wasTransmit,false);assert.equal(b.burstRadio,'digital');assert.equal(b.burstPerspective,'operator');
});
test('late sibilant and early onset survive buffering and full FM filter drain',()=>{
 for(const rate of [8000,16000,44100,48000]){const input=Float32Array.from({length:Math.round(rate*.08)},(_,n)=>.12*Math.sin(2*Math.PI*(n<rate*.02?800:2600)*n/rate));const out=renderRadio(input,rate,{...DEFAULTS,quality:100,tailMs:0});const d=Math.round(rate*.024);assert.ok(rms(out.subarray(d,d+Math.round(rate*.02)))>.03);assert.ok(rms(out.subarray(input.length+d-Math.round(rate*.01),input.length+d))>.015);assert.ok(peak(out.subarray(input.length+Math.round(rate*.06)))<1e-8);}
});
test('rapid re-key keeps queued voice and channel sequence, and export is partition exact',()=>{
 const rate=16000,a=new RadioKernel(rate,{quality:85},53),b=new RadioKernel(rate,{quality:85},53);let max=0;
 for(let n=0;n<rate*.6;n++){if(n%517===0){const tx=n%1034===0;a.setParams({tx});b.setParams({tx});}const x=n<rate*.3?.15*Math.sin(n*.31):0;const ya=a.processSample(x),yb=b.process(new Float32Array([x]))[0];assert.equal(Math.fround(ya),yb);max=Math.max(max,Math.abs(ya));}assert.ok(max>0&&max<.769);
});

test('explicit open-squelch mode reveals weak FM noise while automatic mode mutes it',()=>{
 for(const rate of [8000,16000,48000,96000]){
  const automatic=new RadioKernel(rate,{quality:30,output:40},41),monitor=new RadioKernel(rate,{quality:30,output:40,fmMonitor:true},41);
  const source=Float32Array.from({length:Math.round(rate*.3)},(_,n)=>.2*Math.sin(2*Math.PI*1000*n/rate));
  const a=automatic.process(source),m=monitor.process(source);assert.equal(peak(a),0);assert.ok(rms(m.subarray(Math.round(rate*.1)))>.02);assert.ok(peak(m)<.385);
  assert.equal(automatic.fm.seed,monitor.fm.seed);assert.equal(automatic.fm.discriminatorHz,monitor.fm.discriminatorHz);
  assert.equal(automatic.fmRxOpen,false);assert.equal(monitor.fmRxOpen,true);assert.equal(monitor.fmMonitorActive,true);
 }
});
test('open-squelch toggle is smoothed, does not key transmitter, and export remains finite',()=>{
 const k=new RadioKernel(48000,{quality:20,output:40,tx:true},82);k.process(silence(12000));const before=k.burstCount;k.setParams({fmMonitor:true});
 let largestStep=0,last=k.gate;for(let n=0;n<4800;n++){k.processSample(0);largestStep=Math.max(largestStep,Math.abs(k.gate-last));last=k.gate;}
 assert.ok(largestStep<.0014);assert.equal(k.burstCount,before);assert.ok(k.gate>.99);
 k.setParams({tx:false});const tail=k.process(silence(16800));assert.ok(rms(tail.subarray(14400))>.05);assert.equal(k.fmRxOpen,true);assert.equal(k.wasTransmit,false);
 k.setParams({fmMonitor:false});k.process(silence(12000));assert.equal(k.fmMonitorActive,false);assert.equal(k.wasTransmit,false);
});
test('monitor respects receiver-session stop and does not affect operator or digital routing',()=>{
 const idle=new RadioKernel(48000,{quality:0,fmMonitor:true,tx:false,receiverActive:false});assert.equal(peak(idle.process(silence(12000))),0);
 for(const params of [{perspective:'operator'},{radio:'digital'}]){const x=Float32Array.from({length:8000},(_,n)=>.1*Math.sin(n*.21));assert.deepEqual(new RadioKernel(48000,{...params,quality:20,fmMonitor:false},23).process(x),new RadioKernel(48000,{...params,quality:20,fmMonitor:true},23).process(x));}
 const k=new RadioKernel(48000,{quality:30,fmMonitor:true,tailMs:0});k.process(silence(12000));k.setParams({tx:false});assert.ok(rms(k.process(silence(16800)).subarray(12000))>.05);
 k.setParams({receiverActive:false});assert.ok(peak(k.process(silence(12000)).subarray(6000))<1e-10);assert.equal(k.fmRxOpen,false);assert.equal(k.fmMonitorActive,false);
});

test('open receiver hisses before PTT and remains open across release and re-key independent of tail setting',()=>{
 for(const rate of [8000,44100,48000,192000])for(const tailMs of [0,110,200]){
  const k=new RadioKernel(rate,{quality:90,fmMonitor:true,receiverActive:true,tx:false,tailMs},42);
  assert.ok(rms(k.process(silence(Math.round(rate*.5))).subarray(Math.round(rate*.3)))>.05);
  assert.equal(k.wasTransmit,false);assert.equal(k.burstCount,0);assert.equal(k.fmRxOpen,true);assert.ok(k.gate>.999999);
  for(let burst=0;burst<2;burst++){
   k.setParams({tx:true});for(let n=0;n<rate*.08;n++){k.processSample(.1*Math.sin(n*.17));assert.equal(k.fmRxOpen,true);assert.ok(k.gate>.999999,'PTT must not retrigger the speaker opening fade');}
   k.setParams({tx:false});const release=k.process(silence(Math.round(rate*.5)));assert.ok(rms(release.subarray(Math.round(rate*.3)))>.05);assert.equal(k.fmRxOpen,true);assert.ok(k.gate>.999999);
  }
  assert.equal(k.burstCount,2);assert.equal(k.endCount,2);
 }
});

test('starting/stopping listening fades the speaker without keying RF or resetting detector history',()=>{
 const k=new RadioKernel(48000,{quality:35,tx:false,fmMonitor:true,receiverActive:false},82);assert.equal(peak(k.process(silence(24000))),0);const power=k.fm.detectorPower;
 k.setParams({receiverActive:true});let largestStep=0,last=k.gate;for(let n=0;n<4800;n++){k.processSample(0);largestStep=Math.max(largestStep,Math.abs(k.gate-last));last=k.gate;if(n===0)assert.ok(k.fm.detectorPower>power*.9);}
 assert.ok(largestStep<.0014);assert.ok(k.gate>.99);assert.equal(k.burstCount,0);assert.equal(k.wasTransmit,false);
 k.setParams({receiverActive:false});const stop=k.process(silence(12000));assert.ok(peak(stop.subarray(6000))<1e-10);assert.equal(k.fmRxOpen,false);
 k.setParams({receiverActive:true});assert.ok(rms(k.process(silence(12000)).subarray(6000))>.05);assert.equal(k.burstCount,0);
});

test('open receiver has no invented idle hiss or start burst in the noiseless limit',()=>{
 const k=new RadioKernel(48000,{quality:100,tx:false,fmMonitor:true,tailMs:0});assert.equal(peak(k.process(silence(24000))),0);
 k.setParams({tx:true});assert.equal(peak(k.process(silence(4800))),0);k.setParams({tx:false});assert.equal(peak(k.process(silence(24000))),0);assert.equal(k.fmRxOpen,true);
});

test('automatic acquisition retains idle detector history and can outlast the fixed voice delay',()=>{
 for(const quality of [90,35]){
  const k=new RadioKernel(48000,{quality,tx:false},42);k.process(silence(24000));const power=k.fm.detectorPower;
  for(let burst=0;burst<2;burst++){
   k.setParams({tx:true});let opened=-1;
   for(let n=0;n<9600;n++){k.processSample(.08*Math.sin(2*Math.PI*440*n/48000));if(n===0&&burst===0)assert.ok(k.fm.detectorPower>power*.9,'no invented fresh-detector confidence');if(opened<0&&k.fmRxOpen)opened=n;}
   assert.equal(k.delaySamples,1152);assert.ok(opened>k.delaySamples,`${quality}: opening ${opened} samples must remain an actual detector result`);assert.ok(opened<9600);
   k.setParams({tx:false});k.process(silence(24000));assert.equal(k.fmRxOpen,false);
  }
 }
});

test('finite open-squelch recording includes its full 350 ms capture window and bounded idle noise',()=>{
 for(const rate of [8000,44100,48000]){
  const input=silence(Math.round(rate*.1)),params={quality:90,fmMonitor:true,receiverActive:false,tailMs:0};
  const out=renderRadio(input,rate,params,72);assert.equal(out.length,input.length+Math.round(rate*.35));assert.ok(rms(out.subarray(out.length-Math.round(rate*.05)))>.05);
  assert.ok(out.every(x=>Number.isFinite(x)&&Math.abs(x)<.98));
  const k=new RadioKernel(rate,{...params,receiverActive:true},72),actual=new Float32Array(out.length);
  for(let n=0;n<actual.length;n++){if(n===input.length)k.setParams({tx:false});actual[n]=k.processSample(input[n]||0);}assert.deepEqual(out,actual);
 }
});

test('receiver power affects wet analog listening but never changes raw A or transmitter state',()=>{
 const rate=16000,a=new RadioKernel(rate,{receiverActive:false,mix:0,gateDry:true,tx:true,quality:90,fmMonitor:true},35),b=new RadioKernel(rate,{receiverActive:true,mix:0,gateDry:true,tx:true,quality:90,fmMonitor:true},35);
 for(let n=0;n<rate/2;n++){const input=.1*Math.sin(n*.23);assert.equal(a.processSample(input),b.processSample(input));}
 assert.equal(a.fm.discriminatorHz,b.fm.discriminatorHz);assert.equal(a.fm.detectorPower,b.fm.detectorPower);assert.equal(a.burstCount,b.burstCount);assert.equal(a.wasTransmit,true);assert.equal(a.fmRxOpen,false);assert.equal(b.fmRxOpen,true);
});

test('idle path changes follow the latest selection without requiring or inventing a PTT',()=>{
 for(const target of [{perspective:'operator',radio:'digital'},{perspective:'receiver',radio:'digital'}]){
  const k=new RadioKernel(48000,{quality:90,fmMonitor:true,tx:false});assert.ok(rms(k.process(silence(12000)).subarray(6000))>.05);
  k.setParams(target);const closing=k.process(silence(12000));assert.ok(peak(closing.subarray(6000))<1e-10);assert.equal(k.burstPerspective,target.perspective);assert.equal(k.burstRadio,target.radio);assert.equal(k.fmRxOpen,false);assert.equal(k.burstCount,0);
  k.setParams({perspective:'receiver',radio:'analog'});assert.ok(rms(k.process(silence(12000)).subarray(6000))>.05);assert.equal(k.fmRxOpen,true);assert.equal(k.wasTransmit,false);assert.equal(k.burstCount,0);
 }
});

test('idle transition preserves an active burst and cancels or supersedes pending selection safely',()=>{
 const a=new RadioKernel(48000,{quality:90,fmMonitor:true},24),b=new RadioKernel(48000,{quality:90,fmMonitor:true},24),voice=Float32Array.from({length:6000},(_,n)=>.1*Math.sin(n*.13));a.process(voice);b.process(voice);
 a.setParams({radio:'digital'});assert.deepEqual(a.process(voice),b.process(voice));assert.equal(a.burstRadio,'analog');
 a.setParams({tx:false});b.setParams({tx:false});assert.deepEqual(a.process(silence(7200)),b.process(silence(7200)));assert.equal(a.burstRadio,'analog');
 a.process(silence(1000));assert.equal(a.idleRoutePending,true);a.setParams({radio:'analog'});a.process(silence(6000));assert.equal(a.burstRadio,'analog');assert.equal(a.fmRxOpen,true);assert.ok(a.gate>.99);
 a.setParams({radio:'digital'});a.process(silence(100));a.setParams({perspective:'operator',radio:'analog'});a.process(silence(6000));assert.equal(a.burstPerspective,'operator');assert.equal(a.burstRadio,'analog');assert.equal(a.burstCount,1);assert.equal(a.endCount,1);
 a.setParams({receiverActive:false,perspective:'receiver',radio:'analog'});assert.equal(peak(a.process(silence(12000)).subarray(6000)),0);assert.equal(a.fmRxOpen,false);assert.equal(a.burstCount,1);
});
