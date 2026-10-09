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
    .replace("import { RadioKernel } from './dsp.js?v=cue-variation-v1';", '');
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
