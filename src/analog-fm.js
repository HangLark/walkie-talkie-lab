/** Narrowband FM complex-baseband link. No RF hardware, device or codec emulation.
 * See ANALOG_FM_MODEL.md for units, noise reference, approximations and sources. */
const TAU = 2 * Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
class Biquad {
  constructor(kind, hz, rate, q = Math.SQRT1_2) {
    const w = TAU * hz / rate, c = Math.cos(w), a = Math.sin(w) / (2*q), s = kind === 'high' ? 1 : -1;
    this.b0 = (1+s*c)/(2*(1+a)); this.b1 = -s*(1+s*c)/(1+a); this.b2 = this.b0;
    this.a1 = -2*c/(1+a); this.a2 = (1-a)/(1+a); this.z1 = this.z2 = 0;
  }
  tick(x) { const y = this.b0*x + this.z1; this.z1 = this.b1*x-this.a1*y+this.z2; this.z2 = this.b2*x-this.a2*y; return y; }
}
class Butterworth4 {
  constructor(kind, hz, rate) { this.a = new Biquad(kind,hz,rate,.541196100146197); this.b = new Biquad(kind,hz,rate,1.306562964876377); }
  tick(x) { return this.b.tick(this.a.tick(x)); }
}
function lowpassFIR(length, cutoff, shift = 0) {
  const h = new Float64Array(length); let sum = 0;
  for(let i=0;i<length;i++) { const t=i-(length-1)/2+shift; const sinc = Math.abs(t)<1e-12 ? 2*cutoff : Math.sin(TAU*cutoff*t)/(Math.PI*t); h[i] = sinc*(.42-.5*Math.cos(TAU*i/(length-1))+.08*Math.cos(2*TAU*i/(length-1))); sum+=h[i]; }
  for(let i=0;i<length;i++) h[i]/=sum;
  return h;
}
/** quality is an uncalibrated UI scale, never RSSI, distance or SINAD.
 * 100 means a mathematical noiseless link. Intermediate values are CNR dB. */
export function qualityToCnrDb(quality) { return quality >= 99.999 ? Infinity : -8 + 48*clamp(Number.isFinite(quality)?quality:0,0,100)/100; }
export class AnalogFM {
  constructor(sampleRate = 48000, {cnrDb = Infinity, seed = 0x464d7266} = {}) {
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000) throw new RangeError('FM audio rate must be 8000–192000 Hz');
    this.sampleRate=sampleRate; this.oversample=Math.ceil(48000/sampleRate); this.basebandRate=sampleRate*this.oversample;
    this.deviationHz=2500; this.channelCutoffHz=6000; this.deemphasisSeconds=.00075;
    const r=this.basebandRate;
    this.txHigh=new Biquad('high',300,r); this.txLow=new Butterworth4('low',3000,r);
    this.rxI=new Butterworth4('low',6000,r); this.rxQ=new Butterworth4('low',6000,r);
    this.audioLow=new Butterworth4('low',3000,r); this.detectorHigh=new Butterworth4('high',4500,r);
    // Measure discrete impulse energy; for complex white noise this is the
    // fraction of total input noise power passed by our actual channel filter.
    const probe=new Butterworth4('low',6000,r); let energy=0;
    for(let i=0;i<Math.ceil(r*.025);i++){const y=probe.tick(i===0?1:0);energy+=y*y;}
    this.channelNoiseFraction=energy; this.noiseBandwidthHz=energy*r;
    this.emphasisPole=Math.exp(-1/(r*this.deemphasisSeconds));
    this.emphasisNorm=Math.sqrt(1+this.emphasisPole*this.emphasisPole-2*this.emphasisPole*Math.cos(TAU*1000/r))/(1-this.emphasisPole);
    this.detectorAlpha=1-Math.exp(-1/(.015*r));
    this.seed=seed>>>0||1; this.phase=0; this.previousI=1; this.previousQ=0; this.prePrevious=0; this.deState=0;
    this.instantaneousDeviationHz=0; this.discriminatorHz=0; this.discriminatorNoiseHz=0; this.detectorPower=0; this.confidence=1;
    this.channelPower=1; this.noiseStd=0; this.setCnrDb(cnrDb);
    this.inputPosition=0; this.outputPosition=0;
    this.inputHistory=new Float64Array(32); this.interpolation=[];
    if(this.oversample>1) for(let j=0;j<this.oversample;j++) this.interpolation.push(lowpassFIR(32,.43,j/this.oversample));
    this.outputCoefficients=this.oversample>1?lowpassFIR(this.oversample*32+1,sampleRate*.43/r):null;
    this.outputHistory=new Float64Array(this.outputCoefficients?.length||1);
    // Nominal FIR group delay; subphase emission shifts it by < one host sample.
    this.resamplerDelaySeconds=this.oversample>1?(15.5+16)/sampleRate:0;
  }
  setCnrDb(db) {
    if (db === this.cnrDb) return;
    if(db!==Infinity&&!Number.isFinite(db)) return;
    this.cnrDb=db===Infinity?Infinity:clamp(db,-60,120);
    this.noiseStd=db===Infinity?0:Math.sqrt(10**(-this.cnrDb/10)/(2*this.channelNoiseFraction));
  }
  random() { let x=this.seed; x^=x<<13; x^=x>>>17; x^=x<<5; this.seed=x>>>0; return (this.seed+.5)/4294967296; }
  /** One internal complex sample. carrier=false removes carrier before the
   * channel; finite CNR still supplies thermal noise. CNR references carrier=1. */
  basebandSample(audio, carrier=true) {
    const speech=this.txLow.tick(this.txHigh.tick(audio));
    const emphasized=(speech-this.emphasisPole*this.prePrevious)/((1-this.emphasisPole)*this.emphasisNorm);
    this.prePrevious=speech;
    this.instantaneousDeviationHz=clamp(emphasized,-1,1)*this.deviationHz;
    this.phase+=TAU*this.instantaneousDeviationHz/this.basebandRate;
    if(this.phase>Math.PI)this.phase-=TAU; else if(this.phase< -Math.PI)this.phase+=TAU;
    let i=carrier?Math.cos(this.phase):0, q=carrier?Math.sin(this.phase):0;
    if(this.noiseStd) { const radius=this.noiseStd*Math.sqrt(-2*Math.log(this.random())), angle=TAU*this.random(); i+=radius*Math.cos(angle); q+=radius*Math.sin(angle); }
    i=this.rxI.tick(i); q=this.rxQ.tick(q);
    const power=i*i+q*q;
    const phaseDifference=power<1e-24||(!carrier&&this.noiseStd===0)?0:Math.atan2(q*this.previousI-i*this.previousQ,i*this.previousI+q*this.previousQ);
    this.previousI=i; this.previousQ=q;
    this.discriminatorHz=phaseDifference*this.basebandRate/TAU;
    const high=this.detectorHigh.tick(this.discriminatorHz);
    this.detectorPower+=(high*high-this.detectorPower)*this.detectorAlpha;
    this.channelPower+=(power-this.channelPower)*this.detectorAlpha;
    this.discriminatorNoiseHz=Math.sqrt(Math.max(0,this.detectorPower));
    // A detector score, not a measured CNR/SINAD. 250 Hz is a model-specific
    // noise threshold, and the power term rejects noiseless absent carriers.
    this.confidence=clamp(this.channelPower/.05,0,1)/(1+this.detectorPower/(250*250));
    this.deState=this.emphasisPole*this.deState+(1-this.emphasisPole)*this.emphasisNorm*this.discriminatorHz/this.deviationHz;
    return this.audioLow.tick(this.deState);
  }
  processSample(input, carrier=true) {
    const x=Number.isFinite(input)?clamp(input,-8,8):0;
    if(this.oversample===1) return clamp(this.basebandSample(x,carrier),-2,2);
    this.inputHistory[this.inputPosition]=x;
    let result=0;
    for(let j=0;j<this.oversample;j++) {
      const h=this.interpolation[j]; let interpolated=0, k=this.inputPosition;
      for(let n=0;n<h.length;n++){interpolated+=h[n]*this.inputHistory[k];if(--k<0)k=this.inputHistory.length-1;}
      this.outputHistory[this.outputPosition]=this.basebandSample(interpolated,carrier);
      if(++this.outputPosition===this.outputHistory.length)this.outputPosition=0;
    }
    this.inputPosition=(this.inputPosition+1)%this.inputHistory.length;
    let k=this.outputPosition-1;if(k<0)k=this.outputHistory.length-1;
    for(let n=0;n<this.outputCoefficients.length;n++){result+=this.outputCoefficients[n]*this.outputHistory[k];if(--k<0)k=this.outputHistory.length-1;}
    return clamp(result,-2,2);
  }
  process(input, output=new Float32Array(input.length), carrier=true) { for(let i=0;i<input.length;i++)output[i]=this.processSample(input[i],carrier);return output; }
}
