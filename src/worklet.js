import { RadioKernel } from './dsp.js?v=cue-variation-v1';
class RadioProcessor extends AudioWorkletProcessor {
  constructor(options) { super(); this.kernel = new RadioKernel(sampleRate, options.processorOptions?.params, options.processorOptions?.seed); this.frames = 0; this.port.onmessage = ({data}) => { if (data.type === 'params') this.kernel.setParams(data.params); }; }
  process(inputs, outputs) {
    const channels = inputs[0], out = outputs[0][0];
    for (let i=0; i<out.length; i++) { let x=0; if (channels.length) { for (const ch of channels) x += ch[i] || 0; x /= channels.length; } out[i] = this.kernel.processSample(x); }
    this.frames += out.length;
    if (this.frames >= sampleRate/20) { this.frames = 0; this.port.postMessage({ type: 'meter', input: this.kernel.meterIn, output: this.kernel.meterOut, carrier: this.kernel.carrier, signal: this.kernel.signal, vox: this.kernel.voxHold > 0, transmitting: this.kernel.wasTransmit }); }
    return true;
  }
}
registerProcessor('radio-processor', RadioProcessor);
