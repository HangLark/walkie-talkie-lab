import { applyOutputWindowFade } from './output-boundary.js?v=fm-output-boundary-v3';
import { RadioKernel } from './dsp.js?v=fm-output-boundary-v3';
import { encodeWav } from './wav.js';
self.onmessage = ({ data }) => {
  try {
    const { samples, rate, params, seed } = data, kernel = new RadioKernel(rate, { ...params, receiverActive: true, mix: 1, tx: true, vox: false, gateDry: false }, seed);
    // Capture fade is separate from physical receiver/PTT state.
    const output = new Float32Array(samples.length + Math.round(rate*.35));
    for (let i=0; i<output.length; i++) { if (i===samples.length) kernel.setParams({ tx:false }); output[i] = kernel.processSample(i<samples.length ? samples[i] : 0); if (i % 262144 === 0) self.postMessage({ progress:i/output.length }); }
    applyOutputWindowFade(output, rate);
    const buffer = encodeWav(output, rate); self.postMessage({ buffer }, [buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
