/** Shared, allocation-free per-sample radio sound-design kernel. Not a hardware/codec emulator. */
export const DEFAULTS = Object.freeze({ highpass: 300, lowpass: 3000, drive: 1.6, compression: 4, emphasis: 1.2, quality: 90, noise: 12, squelch: 18, speaker: 2, output: 80, mix: 1, vox: false, gateDry: false, voxThreshold: -42, tx: true });
export const PRESETS = Object.freeze({
  patrol: { name: '巡逻频道', description: '清晰、紧凑，带一点模拟底噪', ...DEFAULTS },
  field: { name: '野外联络', description: '窄带喇叭音色，中等信号起伏', ...DEFAULTS, highpass: 450, lowpass: 2400, quality: 66, noise: 24, speaker: 3, drive: 2.1 },
  fringe: { name: '边缘信号', description: '不规则衰落、静噪开合与嘶声', ...DEFAULTS, highpass: 380, lowpass: 2700, quality: 30, noise: 43, squelch: 22, drive: 1.8 },
  clean: { name: '近距直通', description: '强信号、低失真，保留语音动态', ...DEFAULTS, quality: 100, noise: 3, drive: 1.1, compression: 2.5, speaker: 1 }
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ranges = { highpass: [150, 800], lowpass: [1600, 4200], drive: [1, 5], compression: [1, 8], emphasis: [0, 3], quality: [0, 100], noise: [0, 100], squelch: [0, 65], speaker: [0, 6], output: [0, 100], mix: [0, 1], voxThreshold: [-65, -15] };
const PARAM_KEYS = Object.keys(ranges);
export function sanitizeParams(params = {}, base = DEFAULTS) {
  const p = { ...base };
  for (const [key, range] of Object.entries(ranges)) if (Number.isFinite(params[key])) p[key] = clamp(params[key], ...range);
  for (const key of ['vox', 'tx', 'gateDry']) if (typeof params[key] === 'boolean') p[key] = params[key];
  return p;
}
class Biquad {
  constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  configure(type, frequency, rate, gain = 0, q = 0.707) {
    const w = 2 * Math.PI * Math.min(frequency, rate * 0.45) / rate, c = Math.cos(w), a = Math.sin(w) / (2 * q), A = 10 ** (gain / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'peak') { b0 = 1 + a * A; b1 = -2 * c; b2 = 1 - a * A; a0 = 1 + a / A; a1 = -2 * c; a2 = 1 - a / A; }
    else { const s = type === 'high' ? 1 : -1; b0 = (1 + s * c) / 2; b1 = -s * (1 + s * c); b2 = b0; a0 = 1 + a; a1 = -2 * c; a2 = 1 - a; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x) { const y = this.b0*x + this.b1*this.x1 + this.b2*this.x2 - this.a1*this.y1 - this.a2*this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = Number.isFinite(y) ? y : 0; return this.y1; }
}
export class RadioKernel {
  constructor(sampleRate = 48000, params = {}, seed = 0x72616469) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported sample rate');
    this.rate = sampleRate; this.target = sanitizeParams(params); this.p = { ...this.target }; this.seed = seed >>> 0 || 1;
    this.hp = new Biquad(); this.lp = new Biquad(); this.noiseHP = new Biquad(); this.noiseLP = new Biquad(); this.color = new Biquad();
    this.noiseHP.configure('high', 650, sampleRate); this.noiseLP.configure('low', 3600, sampleRate);
    this.pre = this.de = this.env = this.rms = this.gate = this.fade = this.meterIn = this.meterOut = 0;
    this.qualityOffset = this.nextQuality = 0; this.carrier = false; this.hold = this.voxHold = this.tail = this.tickCount = 0;
    this.dryGate = 0; this.wasTransmit = false; this.signal = this.p.quality; this.smooth = 1 - Math.exp(-1 / (.02 * sampleRate));
    this.signalSmooth = 1 - Math.exp(-1 / (.020823 * sampleRate)); this.fadeSmooth = 1 - Math.exp(-1 / (.010406 * sampleRate)); this.meterDecay = Math.exp(-1 / (.041656 * sampleRate));
    this.emphasisA = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate);
    this.attack = Math.exp(-1 / (.004 * sampleRate)); this.release = Math.exp(-1 / (.09 * sampleRate));
    this.configure();
  }
  random() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
  setParams(p) { this.target = sanitizeParams(p, this.target); }
  configure() { this.hp.configure('high', this.p.highpass, this.rate); this.lp.configure('low', this.p.lowpass, this.rate); this.color.configure('peak', 1300, this.rate, this.p.speaker, .8); }
  processSample(input) {
    let x = Number.isFinite(input) ? clamp(input, -8, 8) : 0;
    const p = this.p, t = this.target;
    for (const key of PARAM_KEYS) p[key] += (t[key] - p[key]) * this.smooth;
    if ((this.tickCount++ & 63) === 0) this.configure();
    if (this.tickCount >= this.nextQuality) { this.qualityOffset = (this.random() - .55) * (100-p.quality) * .72; this.nextQuality = this.tickCount + Math.floor(this.rate * (.045 + this.random() * .24)); }
    this.signal += (clamp(p.quality + this.qualityOffset, 0, 100) - this.signal) * this.signalSmooth;
    // Carrier quality drives squelch, independently of word pauses. 120 ms hold + hysteresis.
    if (this.signal > p.squelch + 4) { this.carrier = true; this.hold = this.rate * .12; }
    else if (this.signal < p.squelch) { if (--this.hold <= 0) this.carrier = false; }
    this.rms += (x*x - this.rms) * (1 - Math.exp(-1 / (.012*this.rate)));
    if (10*Math.log10(this.rms + 1e-12) > p.voxThreshold) this.voxHold = this.rate * .25;
    else this.voxHold = Math.max(0, this.voxHold - 1);
    const transmit = t.tx && (!t.vox || this.voxHold > 0);
    if (this.wasTransmit && !transmit) this.tail = this.rate * .065;
    this.wasTransmit = transmit;
    const tail = this.tail > 0 ? this.tail-- / (this.rate*.065) : 0;
    const gateTarget = (transmit && this.carrier) || tail > 0 ? 1 : 0;
    this.gate += (gateTarget - this.gate) * (1 - Math.exp(-1 / (this.rate * (gateTarget ? .003 : .012))));
    x = this.hp.tick(x);
    const absolute = Math.abs(x); const a = absolute > this.env ? this.attack : this.release; this.env = a*this.env + (1-a)*absolute;
    const over = Math.max(0, 20*Math.log10(this.env + 1e-12) + 24);
    x *= 10 ** (-over*(1-1/p.compression)/20) * 1.7;
    this.pre += this.emphasisA*(x-this.pre); x += p.emphasis*(x-this.pre);
    x = Math.tanh(x*p.drive) / Math.sqrt(p.drive);
    x = this.lp.tick(x);
    const noise = this.noiseLP.tick(this.noiseHP.tick(this.random()*2-1));
    const reception = clamp(this.signal / 32, 0, 1);
    this.fade += ((transmit ? reception : 0) - this.fade) * this.fadeSmooth;
    x = x*this.fade + noise * (p.noise/100) * (.025 + (1-this.signal/100)**2*.5) + noise*tail*.045;
    // Exact inverse of the one-pole preemphasis stage for the current amount.
    const dryEmphasis = (x + p.emphasis*(1-this.emphasisA)*this.de) / (1 + p.emphasis*(1-this.emphasisA));
    this.de += this.emphasisA*(dryEmphasis-this.de); x = dryEmphasis;
    x = this.color.tick(x*this.gate);
    const wet = Math.tanh(x*1.25) * .96;
    this.dryGate += ((transmit ? 1 : 0) - this.dryGate) * this.fadeSmooth;
    const dry = clamp(Number.isFinite(input) ? input : 0, -1, 1) * (t.gateDry ? this.dryGate : 1);
    const out = clamp((wet*p.mix + dry*(1-p.mix)) * p.output/100, -.98, .98);
    this.meterIn = Math.max(Math.abs(Number.isFinite(input) ? input : 0), this.meterIn*this.meterDecay);
    this.meterOut = Math.max(Math.abs(out), this.meterOut*this.meterDecay);
    return Number.isFinite(out) ? out : 0;
  }
  process(input, output = new Float32Array(input.length)) { for (let i=0; i<input.length; i++) output[i] = this.processSample(input[i]); return output; }
}
export function renderRadio(input, sampleRate, params, seed) {
  const kernel = new RadioKernel(sampleRate, params, seed), result = new Float32Array(input.length + Math.round(sampleRate*.35));
  for (let i=0; i<result.length; i++) { if (i === input.length) kernel.setParams({ tx: false }); result[i] = kernel.processSample(i<input.length ? input[i] : 0); }
  return result;
}
