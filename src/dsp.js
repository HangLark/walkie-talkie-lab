/** Shared, allocation-free per-sample radio sound-design kernel. Not a hardware/codec emulator. */
export const DEFAULTS = Object.freeze({ highpass: 300, lowpass: 3000, drive: 1.4, compression: 3.5, leveler: 65, emphasis: 1.2, quality: 90, noise: 12, squelch: 18, speaker: 3, cueLevel: 65, tailMs: 110, perspective: 'receiver', radio: 'analog', permit: 'triple', output: 80, mix: 1, vox: false, gateDry: false, voxThreshold: -42, tx: true });
export const PRESETS = Object.freeze({
  patrol: { name: '巡逻频道', description: '模拟接收端：清晰窄带语音、开台声与可调静噪尾音', ...DEFAULTS },
  operator: { name: '警务手台', description: '操作员监听：三段本机许可音 + 发话侧音；并非远端接收的提示音', ...DEFAULTS, perspective: 'operator', radio: 'digital', quality: 96, noise: 2, tailMs: 0, drive: 1.2 },
  digital: { name: '数字警务', description: '数字风格近似：紧凑语音、干净收尾；非 P25 编解码器', ...DEFAULTS, radio: 'digital', quality: 96, noise: 2, highpass: 320, lowpass: 3200, drive: 1.2, compression: 4, speaker: 2.5, tailMs: 0 },
  field: { name: '野外联络', description: '窄带喇叭音色，中等信号起伏', ...DEFAULTS, highpass: 450, lowpass: 2400, quality: 66, noise: 24, speaker: 3, drive: 2.1 },
  fringe: { name: '边缘信号', description: '不规则衰落、静噪开合与嘶声', ...DEFAULTS, highpass: 380, lowpass: 2700, quality: 30, noise: 43, squelch: 22, drive: 1.8 },
  clean: { name: '近距直通', description: '强信号、低失真，保留语音动态', ...DEFAULTS, quality: 100, noise: 3, drive: 1.1, compression: 2.5, speaker: 1, leveler: 35 }
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ranges = { highpass: [150, 800], lowpass: [1600, 4200], drive: [1, 5], compression: [1, 8], leveler: [0, 100], emphasis: [0, 3], quality: [0, 100], noise: [0, 100], squelch: [0, 65], speaker: [0, 6], cueLevel: [0, 100], tailMs: [0, 200], output: [0, 100], mix: [0, 1], voxThreshold: [-65, -15] };
const PARAM_KEYS = Object.keys(ranges);
const PERMIT_FREQUENCIES = [910, 1210, 1510];
export function sanitizeParams(params = {}, base = DEFAULTS) {
  const p = { ...base };
  for (const [key, range] of Object.entries(ranges)) if (Number.isFinite(params[key])) p[key] = clamp(params[key], ...range);
  for (const key of ['vox', 'tx', 'gateDry']) if (typeof params[key] === 'boolean') p[key] = params[key];
  for (const [key, choices] of Object.entries({ perspective: ['receiver', 'operator'], radio: ['analog', 'digital'], permit: ['off', 'single', 'triple'] })) if (choices.includes(params[key])) p[key] = params[key];
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
// Bounded speech-level aid, not a speech recognizer or noise suppressor.
export class SpeechLeveler {
  constructor(rate) {
    this.power = 0; this.noisePower = 1e-6; this.gain = 1;
    this.detect = 1-Math.exp(-1/(.012*rate));
    this.noiseTrack = 1-Math.exp(-1/(.5*rate));
    this.reduce = 1-Math.exp(-1/(.012*rate));
    this.raise = 1-Math.exp(-1/(.22*rate));
    this.idle = 1-Math.exp(-1/(.3*rate));
  }
  tick(x, amount) {
    this.power += (x*x-this.power)*this.detect;
    // Estimate only low-level background, never learn sustained speech as noise.
    if (this.power < .008**2) this.noisePower += (this.power-this.noisePower)*this.noiseTrack;
    const active = this.power > Math.max(.009**2, this.noisePower*6.25);
    const wanted = active ? clamp(.075/Math.sqrt(this.power+1e-12), .65, 3) : Math.min(1,this.gain);
    const speed = wanted < this.gain ? this.reduce : active ? this.raise : this.idle;
    this.gain += (wanted-this.gain)*speed;
    return x*(1+(this.gain-1)*amount/100);
  }
}
// Correlated slow shadowing plus modest faster flutter. Quality is an artistic
// control, not RSSI/SINAD, distance, speed or a propagation measurement.
export class CorrelatedRF {
  constructor(rate, seed) {
    this.rate=rate; this.seed=seed>>>0||1; this.count=0; this.slow=0; this.fast=0; this.target=0;
    this.a=1-Math.exp(-1/(.16*rate)); this.b=1-Math.exp(-1/(.018*rate));
    this.phase=this.random()*2*Math.PI; this.frequency=3+this.random()*4;
  }
  random() { let x=this.seed; x^=x<<13; x^=x>>>17; x^=x<<5; this.seed=x>>>0; return this.seed/4294967296; }
  tick(quality) {
    if (this.count--<=0) { this.target=(this.random()-.52)*2; this.fastTarget=this.random()*2-1; this.count=Math.round(this.rate*.04)-1; }
    this.slow+=(this.target-this.slow)*this.a; this.fast+=(this.fastTarget-this.fast)*this.b;
    this.phase+=2*Math.PI*this.frequency/this.rate; if(this.phase>2*Math.PI)this.phase-=2*Math.PI;
    return clamp(quality+(100-quality)*(.85*this.slow+.13*this.fast+.08*Math.sin(this.phase)),0,100);
  }
}
// Seeded two-state burst channel, 20 ms frames. Repeat only the last good frame
// briefly, decay to silence, then crossfade recovery. No codec is simulated.
export class BurstFrameChannel {
  constructor(rate, seed) {
    this.rate=rate; this.seed=seed>>>0||1;
    this.good=new Float32Array(Math.ceil(rate*.02)); this.current=new Float32Array(this.good.length);
    this.crossfade=Math.max(1,Math.round(rate*.002)); this.reset();
  }
  reset() { this.position=0; this.frames=0; this.clock=0; this.next=0; this.bad=false; this.lossSamples=0; this.goodLength=0; this.last=0; this.blend=0; this.blendFrom=0; this.lostFrames=0; this.totalFrames=0; this.maxRun=0; this.run=0; this.good.fill(0); this.current.fill(0); }
  random() { let x=this.seed; x^=x<<13; x^=x>>>17; x^=x<<5; this.seed=x>>>0; return this.seed/4294967296; }
  tick(x, quality) {
    if(this.clock>=this.next) {
      if(this.frames && !this.bad) { const temp=this.good; this.good=this.current; this.current=temp; this.goodLength=this.position; }
      const previous=this.bad;
      const severity=clamp((62-quality)/62,0,1);
      this.bad=severity>0 && this.random()<(previous ? .30+.63*severity : .38*severity*severity);
      this.totalFrames++; if(this.bad){this.lostFrames++;this.run++;this.maxRun=Math.max(this.maxRun,this.run);}else this.run=0;
      if(previous!==this.bad || this.bad){this.blend=this.crossfade;this.blendFrom=this.last;}
      if(!this.bad)this.lossSamples=0;
      this.position=0; this.frames++; this.next=Math.round(this.frames*this.rate*.02);
    }
    let y=x;
    if(this.bad) {
      y=this.goodLength ? this.good[this.position%this.goodLength]*Math.max(0,1-this.lossSamples/(this.rate*.035)) : 0;
      this.lossSamples++;
    } else this.current[this.position]=x;
    if(this.blend>0){const w=1-this.blend/this.crossfade;y=this.blendFrom*(1-w)+y*w;this.blend--;}
    this.position++;this.clock++;this.last=y;return y;
  }
}
export class RadioKernel {
  constructor(sampleRate = 48000, params = {}, seed = 0x72616469) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Unsupported sample rate');
    this.cueSeed = ((seed >>> 0) ^ 0x51c0a7e3) >>> 0 || 1;
    this.openCue = { duration: .024, gain: .38, power: 2 };
    this.tailCue = { attack: .003, gain: .48, power: 1.5 };
    this.rate = sampleRate; this.target = sanitizeParams(params); this.p = { ...this.target }; this.seed = seed >>> 0 || 1;
    this.hp2 = new Biquad(); this.lp2 = new Biquad(); this.presence = new Biquad(); this.hp = new Biquad(); this.lp = new Biquad(); this.noiseHP = new Biquad(); this.noiseLP = new Biquad(); this.color = new Biquad();
    this.noiseScale = Math.sqrt(sampleRate/48000);
    this.noiseHP.configure('high', 650, sampleRate); this.noiseLP.configure('low', 3600, sampleRate);
    this.pre = this.de = this.env = this.rms = this.gate = this.fade = this.meterIn = this.meterOut = 0;
    this.rf = new CorrelatedRF(sampleRate, seed ^ 0x4f391a); this.leveler = new SpeechLeveler(sampleRate); this.frames = new BurstFrameChannel(sampleRate, seed ^ 0x735abc); this.carrier = false; this.hold = this.voxHold = this.tickCount = 0;
    this.dryGate = 0; this.wasTransmit = false; this.signal = this.p.quality; this.smooth = 1 - Math.exp(-1 / (.02 * sampleRate));
    this.fadeSmooth = 1 - Math.exp(-1 / (.010406 * sampleRate)); this.meterDecay = Math.exp(-1 / (.041656 * sampleRate));
    this.emphasisA = 1 - Math.exp(-2 * Math.PI * 900 / sampleRate);
    this.attack = Math.exp(-1 / (.004 * sampleRate)); this.release = Math.exp(-1 / (.09 * sampleRate));
    this.delayBuffer = new Float32Array(Math.ceil(sampleRate*.1)+1); this.delayWrite = 0; this.delaySamples = 0;
    this.txAge = -1; this.releaseAge = -1; this.releaseLength = 0; this.burstCount = 0; this.endCount = 0; 
    this.burstPerspective = this.p.perspective; this.burstRadio = this.p.radio; this.burstPermit = this.p.permit;
    this.configure();
  }
  random() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0; return this.seed / 4294967296; }
  // Event draws are independent of per-sample noise/RF and audio block sizes.
  cueRandom() { let x = this.cueSeed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.cueSeed = x >>> 0; return this.cueSeed / 4294967296; }
  startReceiverCue() {
    const weak = 1-clamp(this.signal/100,0,1);
    // Never exceed the fixed 24 ms voice buffer: variation cannot clip a syllable.
    this.openCue.duration = .0225 - .0015*weak + this.cueRandom()*(.0005+.002*weak);
    this.openCue.gain = .38 + .10*weak + (this.cueRandom()-.5)*(.04+.06*weak);
    this.openCue.power = 2.2 - .5*weak + (this.cueRandom()-.5)*.3;
  }
  endReceiverCue(tailMs) {
    const weak = 1-clamp(this.signal/100,0,1);
    // tailMs remains a hard upper bound; zero means no receiver tail.
    const duration = tailMs/1000*(1-this.cueRandom()*(.01+.04*weak));
    this.tailCue.attack = .002 + this.cueRandom()*(.001+.002*weak);
    this.tailCue.gain = .46 + .13*weak + (this.cueRandom()-.5)*(.05+.07*weak);
    this.tailCue.power = 1.75 - .4*weak + (this.cueRandom()-.5)*.3;
    return Math.round(this.rate*duration);
  }
  setParams(p) { this.target = sanitizeParams(p, this.target); }
  configure() { this.hp.configure('high', this.p.highpass, this.rate); this.lp.configure('low', this.p.lowpass, this.rate); this.color.configure('peak', 1450, this.rate, this.p.speaker, 1.1); this.presence.configure('peak', 2350, this.rate, this.p.speaker*.45, 1.4); this.hp2.configure('high', this.p.highpass*.82, this.rate); this.lp2.configure('low', this.p.lowpass, this.rate); }
  processSample(input) {
    let x = Number.isFinite(input) ? clamp(input, -8, 8) : 0;
    const p = this.p, t = this.target;
    for (const key of PARAM_KEYS) p[key] += (t[key] - p[key]) * this.smooth;
    if ((this.tickCount++ & 63) === 0) this.configure();
    this.signal = this.rf.tick(p.quality);
    // Carrier quality drives squelch, independently of word pauses. 120 ms hold + hysteresis.
    if (this.signal > p.squelch + 4) { this.carrier = true; this.hold = this.rate * .12; }
    else if (this.signal < p.squelch) { if (--this.hold <= 0) this.carrier = false; }
    this.rms += (x*x - this.rms) * (1 - Math.exp(-1 / (.012*this.rate)));
    if (10*Math.log10(this.rms + 1e-12) > p.voxThreshold) this.voxHold = this.rate * .25;
    else this.voxHold = Math.max(0, this.voxHold - 1);
    const transmit = t.tx && (!t.vox || this.voxHold > 0);
    // Snapshot cue identity at key-down. Repeated params/VOX word pauses cannot retrigger it.
    if (transmit && !this.wasTransmit) {
      const pendingVoice = this.releaseAge >= 0 && this.releaseAge < this.delaySamples;
      this.txAge = 0; this.releaseAge = -1; this.burstCount++;
      this.burstPerspective = t.perspective; this.burstRadio = t.radio; this.burstPermit = t.permit;
      if (this.burstPerspective === 'receiver' && this.burstRadio === 'analog') this.startReceiverCue();
      // Fast re-key keeps queued speech and its current delay rather than clearing a syllable.
      if (!pendingVoice) {
        this.delaySamples = Math.round(this.rate * (t.perspective === 'operator' && t.permit !== 'off' ? .09 : .024));
        this.delayBuffer.fill(0); this.delayWrite = 0; this.frames.reset();
      }
    }
    if (this.wasTransmit && !transmit) {
      this.releaseAge = 0; this.endCount++;
      this.releaseLength = this.burstRadio === 'analog' && this.burstPerspective === 'receiver' ? this.endReceiverCue(t.tailMs) : Math.round(this.rate*(this.burstPerspective === 'operator' ? .012 : 0));
    }
    this.wasTransmit = transmit;
    const draining = !transmit && this.releaseAge >= 0 && this.releaseAge < this.delaySamples;
    const local = this.burstPerspective === 'operator';
    const receiving = (transmit || draining) && (local || this.carrier);
    const gateTarget = receiving ? 1 : 0;
    this.gate += (gateTarget - this.gate) * (1 - Math.exp(-1 / (this.rate * (gateTarget ? .003 : .006))));
    // Delay only wet voice, preserving the first syllable behind the opening cue.
    const read = (this.delayWrite - this.delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
    this.delayBuffer[this.delayWrite] = transmit ? x : 0;
    x = this.delayBuffer[read]; this.delayWrite = (this.delayWrite+1) % this.delayBuffer.length;
    x = this.leveler.tick(this.hp2.tick(this.hp.tick(x)), p.leveler);
    const absolute = Math.abs(x); const a = absolute > this.env ? this.attack : this.release; this.env = a*this.env + (1-a)*absolute;
    const over = Math.max(0, 20*Math.log10(this.env + 1e-12) + 20);
    x *= 10 ** (-over*(1-1/p.compression)/20) * 2.2;
    this.pre += this.emphasisA*(x-this.pre); x += p.emphasis*(x-this.pre);
    x = Math.tanh(x*p.drive) / Math.sqrt(p.drive);
    x = this.lp2.tick(this.lp.tick(x));
    const noise = this.noiseLP.tick(this.noiseHP.tick(this.random()*2-1)) * this.noiseScale;
    const reception = local || this.burstRadio === 'digital' ? 1 : clamp(this.signal / 32, 0, 1);
    this.fade += ((receiving ? reception : 0) - this.fade) * this.fadeSmooth;
    x = x*this.fade + noise * (local || this.burstRadio === 'digital' ? 0 : p.noise/100) * (.025 + (1-this.signal/100)**2*.5);
    // Exact inverse of the one-pole preemphasis stage for the current amount.
    const dryEmphasis = (x + p.emphasis*(1-this.emphasisA)*this.de) / (1 + p.emphasis*(1-this.emphasisA));
    this.de += this.emphasisA*(dryEmphasis-this.de); x = dryEmphasis;
    if (this.burstRadio === 'digital' && !local) x = this.frames.tick(x, this.signal);
    x = this.presence.tick(this.color.tick(x*this.gate));
    let cue = 0;
    const age = this.txAge / this.rate;
    if (transmit && this.txAge >= 0) {
      if (this.burstPerspective === 'operator' && this.burstPermit !== 'off' && age < .085) {
        const pulseDuration = this.burstPermit === 'single' ? .065 : .019;
        const slot = this.burstPermit === 'single' ? 0 : Math.floor(age/.028);
        const local = this.burstPermit === 'single' ? age : age-slot*.028;
        if (slot < 3 && local < pulseDuration) {
          const envelope = Math.min(1, local/.002, (pulseDuration-local)/.003);
          cue = .22 * envelope * Math.sin(2*Math.PI*(this.burstPermit === 'single' ? 960 : PERMIT_FREQUENCIES[slot])*age);
        }
      } else if (this.burstPerspective === 'receiver' && this.burstRadio === 'analog' && age < this.openCue.duration) {
        const envelope = Math.sin(Math.PI*age/this.openCue.duration)**this.openCue.power;
        cue = noise*this.openCue.gain*envelope;
        // Digital receiver opening is clean, not an invented courtesy/permit beep.
      }
    }
    const endSample = this.releaseAge-this.delaySamples;
    if (!transmit && endSample >= 0 && endSample < this.releaseLength) {
      const seconds = endSample/this.rate, duration = this.releaseLength/this.rate;
      const envelope = Math.min(1, seconds/this.tailCue.attack) * (1-seconds/duration)**this.tailCue.power;
      cue += this.burstPerspective === 'receiver' && this.burstRadio === 'analog' ? noise*this.tailCue.gain*envelope : noise*.14*Math.exp(-seconds*350)*Math.min(1,seconds/.001);
    }
    if (transmit) this.txAge++;
    if (this.releaseAge >= 0) this.releaseAge++;
    // Cues bypass speech deemphasis/compression and noise amount; output and A/B still apply.
    const wet = Math.tanh((x + cue*p.cueLevel/100)*1.25) * .96;
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
