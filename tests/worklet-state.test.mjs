import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RadioKernel, PRESETS, renderRadio } from '../src/dsp.js';

const rate = 48000;
async function processorFactory() {
  let Processor;
  class AudioWorkletProcessor {
    constructor() { this.messages = []; this.port = { postMessage: m => this.messages.push(m) }; }
  }
  const code = (await readFile(new URL('../src/worklet.js', import.meta.url), 'utf8'))
    .replace("import { RadioKernel } from './dsp.js?v=fm-file-ptt-v5';", '');
  vm.runInNewContext(code, { AudioWorkletProcessor, RadioKernel, sampleRate: rate,
    registerProcessor: (_name, cls) => { Processor = cls; } });
  return params => new Processor({ processorOptions: { params } });
}
function process(p, samples) {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 128) {
    p.process([[samples.subarray(i, i + 128)]], [[output.subarray(i, i + 128)]]);
  }
  return output;
}
const latest = p => p.messages.at(-1);

test('worklet reports idle VOX silence, actual speech, hold, then release', async () => {
  const create = await processorFactory();
  const p = create({ ...PRESETS.patrol, vox: true, tx: true });
  process(p, new Float32Array(4800));
  assert.equal(latest(p).vox, false);
  assert.equal(latest(p).transmitting, false);
  assert.equal(p.kernel.burstCount, 0);
  process(p, new Float32Array(4800).fill(.2));
  assert.equal(latest(p).vox, true);
  assert.equal(latest(p).transmitting, true);
  process(p, new Float32Array(4800));
  assert.equal(latest(p).transmitting, true, 'short word gaps retain the VOX hold');
  process(p, new Float32Array(24000));
  assert.equal(latest(p).transmitting, false);
  assert.equal(p.kernel.burstCount, 1);
  assert.equal(p.kernel.endCount, 1);
});

test('worklet distinguishes speech detector activity from permission to transmit', async () => {
  const create = await processorFactory();
  const p = create({ ...PRESETS.operator, vox: true, tx: false });
  process(p, new Float32Array(4800).fill(.2));
  assert.equal(latest(p).vox, true);
  assert.equal(latest(p).transmitting, false);
  assert.equal(p.kernel.burstCount, 0);
  p.port.onmessage({ data: { type: 'params', params: { tx: true } } });
  process(p, new Float32Array(4800).fill(.2));
  assert.equal(latest(p).transmitting, true);
  p.port.onmessage({ data: { type: 'params', params: { tx: false } } });
  process(p, new Float32Array(4800).fill(.2));
  assert.equal(latest(p).vox, true);
  assert.equal(latest(p).transmitting, false);
  assert.equal(p.kernel.endCount, 1);
});

test('fresh file processor applies complete preset at resumed offset and matches offline samples', async () => {
  const create = await processorFactory();
  const input = Float32Array.from({ length: 16384 }, (_, i) => .2 * Math.sin(i * .061));
  const old = create(PRESETS.patrol);
  process(old, input.subarray(0, 4096));
  assert.equal(old.kernel.burstRadio, 'analog');
  const replacement = create(PRESETS.operator);
  const resumed = input.subarray(4096);
  const actual = process(replacement, resumed);
  const expected = renderRadio(resumed, rate, PRESETS.operator).subarray(0, resumed.length);
  assert.deepEqual(actual, expected);
  assert.equal(replacement.kernel.burstPerspective, 'operator');
  assert.equal(replacement.kernel.burstRadio, 'digital');
  assert.equal(replacement.kernel.burstPermit, PRESETS.operator.permit);
  assert.equal(replacement.kernel.burstCount, 1);
});

test('repeated file processor replacement cannot inherit old preset cues or tails', async () => {
  const create = await processorFactory();
  const input = Float32Array.from({ length: 256 }, (_, i) => .2 * Math.sin(i * .07));
  for (const name of ['operator', 'patrol', 'digital', 'field', 'operator', 'clean']) {
    const p = create(PRESETS[name]);
    assert.deepEqual(process(p, input), renderRadio(input, rate, PRESETS[name]).subarray(0, input.length));
    assert.equal(p.kernel.burstPerspective, PRESETS[name].perspective);
    assert.equal(p.kernel.burstRadio, PRESETS[name].radio);
    assert.equal(p.kernel.burstCount, 1);
    assert.equal(p.kernel.endCount, 0);
  }
});

test('FM receiver audibility is separate from keyed transmitter activity', async()=>{
 const create=await processorFactory();
 for(const quality of [30,90]){const p=create({...PRESETS.patrol,quality,tx:true});process(p,new Float32Array(24000));assert.equal(latest(p).transmitting,true);assert.equal(latest(p).fmRxOpen,quality===90);}
});

test('worklet reports open-squelch independently of automatic carrier detection',async()=>{
 const create=await processorFactory(),p=create({...PRESETS.patrol,quality:30,tx:true,fmMonitor:true});process(p,new Float32Array(24000));assert.equal(latest(p).fmMonitorActive,true);assert.equal(latest(p).fmRxOpen,true);assert.equal(latest(p).carrier,false);
 p.port.onmessage({data:{type:'params',params:{fmMonitor:false}}});process(p,new Float32Array(12000));assert.equal(latest(p).fmMonitorActive,false);assert.equal(latest(p).fmRxOpen,false);
});

test('worklet reports mean-channel propagation state and physical instantaneous CNR',async()=>{
 const create=await processorFactory(),p=create({...PRESETS.patrol,quality:35,fmPropagation:'moving',fmMonitor:true});process(p,new Float32Array(12000));const data=latest(p);assert.equal(data.fmPropagation,'moving');assert.ok(data.fmChannelPower>0);assert.ok(Math.abs(data.fmInstantCnrDb-(8.8+10*Math.log10(data.fmChannelPower)))<1e-8);
});

test('worklet TX telemetry reports and resets actual internal-sample window peaks without touching audio',async()=>{
 const create=await processorFactory(),p=create({...PRESETS.patrol,quality:100,txInputGainDb:18,txMicAgc:true}),x=Float32Array.from({length:12000},(_,n)=>.4*Math.sin(n*.31));
 const actual=process(p,x),expected=renderRadio(x,rate,{...PRESETS.patrol,quality:100,txInputGainDb:18,txMicAgc:true}).subarray(0,x.length);assert.deepEqual(actual,expected);
 for(const meter of p.messages){assert.ok(meter.txDeviationPeakHz>=0&&meter.txDeviationPeakHz<=2500);assert.ok(meter.txAgcGainDb>=-12&&meter.txAgcGainDb<=6);assert.ok(meter.txLimiterFraction>=0&&meter.txLimiterFraction<=1);assert.ok(meter.txGuardFraction>=0&&meter.txGuardFraction<=1);assert.ok(Number.isFinite(meter.txInputRms));}
 assert.ok(p.messages.some(m=>m.txDeviationPeakHz===2500));
 p.port.onmessage({data:{type:'params',params:{tx:false}}});process(p,new Float32Array(rate));assert.equal(latest(p).txDeviationPeakHz,0);assert.equal(latest(p).txLimiterFraction,0);assert.equal(latest(p).txGuardFraction,0);
 for(const settings of [{perspective:'operator'},{radio:'digital'}]){const alternate=create({...PRESETS.patrol,...settings,txInputGainDb:24,txMicAgc:true});process(alternate,x);assert.equal(latest(alternate).txDeviationPeakHz,0);assert.equal(latest(alternate).txAgcGainDb,0);}
});

test('live worklet TX gain and AGC timeline matches the offline kernel through release',async()=>{
 const create=await processorFactory(),settings={...PRESETS.patrol,quality:35,fmMonitor:true,fmPropagation:'moving'},p=create(settings),offline=new RadioKernel(rate,settings),events=new Map([[64,{txInputGainDb:24}],[128,{txMicAgc:true}],[192,{txInputGainDb:-12}],[256,{txMicAgc:false}],[320,{tx:false}]]);
 for(let block=0;block<470;block++){
  if(events.has(block)){const params=events.get(block);p.port.onmessage({data:{type:'params',params}});offline.setParams(params);}
  const x=Float32Array.from({length:128},(_,n)=>.1*Math.sin((block*128+n)*.13)),out=new Float32Array(128);p.process([[x]],[[out]]);assert.deepEqual(out,offline.process(x));
 }
 assert.equal(p.kernel.wasTransmit,false);assert.equal(p.kernel.burstCount,1);assert.equal(p.kernel.endCount,1);
});

test('worklet bypass stays silent between bounded calls and honors session stop',async()=>{
 const create=await processorFactory(),params={...PRESETS.patrol,quality:90,tx:false,fmMonitor:true,receiverActive:false,tailMs:0},p=create(params),offline=new RadioKernel(rate,params);
 const events=new Map([[20,{receiverActive:true}],[100,{tx:true}],[140,{tx:false}],[350,{tx:true}],[390,{tx:false}],[600,{receiverActive:false}]]);
 for(let block=0;block<680;block++){
  if(events.has(block)){const update=events.get(block);p.port.onmessage({data:{type:'params',params:update}});offline.setParams(update);}
  const input=Float32Array.from({length:128},(_,n)=>.1*Math.sin((block*128+n)*.13)),out=new Float32Array(128);p.process([[input]],[[out]]);assert.deepEqual(out,offline.process(input));
  if(block===80||block===300||block===550){assert.equal(latest(p).fmRxOpen,false);assert.equal(latest(p).receiverActive,true);assert.equal(latest(p).transmitting,false);}
 }
 assert.equal(latest(p).receiverActive,false);assert.equal(latest(p).fmRxOpen,false);assert.equal(latest(p).fmMonitorActive,false);assert.equal(p.kernel.burstCount,2);
});
