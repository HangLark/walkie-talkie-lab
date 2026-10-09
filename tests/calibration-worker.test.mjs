import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {AnalogFM} from '../src/analog-fm.js';
import {proposeInputCalibration} from '../src/input-calibration.js';
async function run(samples,rate){let result;const self={postMessage(data){result=data;}};const code=(await readFile(new URL('../src/calibration-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');vm.runInNewContext(code,{self,AnalogFM,proposeInputCalibration,Math});self.onmessage({data:{samples,rate}});return result;}
test('calibration worker measures current TX response and returns a proposal without changing PCM',async()=>{
 const rate=48000,x=Float32Array.from({length:rate},(_,i)=>.1*Math.sin(2*Math.PI*1000*i/rate)),copy=x.slice(),result=await run(x,rate);assert.ok(!result.error);assert.deepEqual(x,copy);assert.equal(result.proposal.p56Conformant,false);assert.ok(Math.abs(result.proposal.responseAt1k-.995926)<.0002);
 const expected=20*Math.log10(1500/(2500*.1*result.proposal.responseAt1k));assert.ok(Math.abs(result.proposal.gainDb-expected)<.001);
});
test('calibration worker rejects silence, DC and invalid rates without a gain proposal',async()=>{
 for(const [x,rate]of [[new Float32Array(48000),48000],[new Float32Array(48000).fill(.3),48000],[new Float32Array(48000),0]]){const result=await run(x,rate);assert.ok(result.error);assert.equal(result.proposal,undefined);}
});
