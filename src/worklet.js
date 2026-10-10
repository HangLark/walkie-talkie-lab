import { RadioKernel } from './dsp.js?v=fm-auto-squelch-v4';
class RadioProcessor extends AudioWorkletProcessor {
  constructor(options) { super(); this.kernel = new RadioKernel(sampleRate, options.processorOptions?.params, options.processorOptions?.seed); this.frames = 0; this.port.onmessage = ({data}) => { if (data.type === 'params') this.kernel.setParams(data.params); }; }
  process(inputs, outputs) {
    const channels = inputs[0], out = outputs[0][0];
    for (let i=0; i<out.length; i++) { let x=0; if (channels.length) { for (const ch of channels) x += ch[i] || 0; x /= channels.length; } out[i] = this.kernel.processSample(x); }
    this.frames += out.length;
    if (this.frames >= sampleRate/20) {
      this.frames = 0;
      const fm=this.kernel.fm,analog=this.kernel.burstPerspective==='receiver'&&this.kernel.burstRadio==='analog',count=fm.txMeterSamples;
      // Peak covers every internal-rate carrier-on sample since the last
      // report, including peaks between low-rate host samples. Reading/resetting
      // these counters never changes transmitter, RF or receiver state.
      this.port.postMessage({ type: 'meter', input: this.kernel.meterIn, output: this.kernel.meterOut, carrier: this.kernel.carrier, fmRxOpen: this.kernel.fmRxOpen, receiverActive: this.kernel.target.receiverActive, activePerspective: this.kernel.burstPerspective, activeRadio: this.kernel.burstRadio, fmMonitorActive: this.kernel.fmMonitorActive, fmPropagation: fm.propagationMode, fmChannelPower: fm.propagationPower, fmInstantCnrDb: fm.instantaneousCnrDb, signal: this.kernel.signal, vox: this.kernel.voxHold > 0, transmitting: this.kernel.wasTransmit,
        txDeviationPeakHz:analog?fm.txDeviationPeakHz:0,txAgcGainDb:analog?fm.txAgc.appliedGainDb:0,txInputRms:analog?Math.sqrt(fm.txAgc.power):0,txLimiterFraction:analog&&count?fm.txLimitedSamples/count:0,txGuardFraction:analog&&count?fm.txGuardLimitedSamples/count:0 });
      fm.resetTxMeter();
    }
    return true;
  }
}
registerProcessor('radio-processor', RadioProcessor);
