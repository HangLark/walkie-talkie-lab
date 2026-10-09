/** Optional complex flat-fading channel gain, applied before receiver AWGN.
 * Independent implementation of a seeded sum-of-scattered-rays model.
 * See FADING_MODEL.md: illustrative propagation, not a calibrated scene/device. */
const TAU=2*Math.PI;
export class FlatFading {
  constructor(sampleRate=48000,{mode='static',maxDopplerHz=2,kFactor=4,seed=0x72617973,sinusoids=32}={}) {
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Fading sample rate must be 8000–192000 Hz');
    if(!['static','rayleigh','rician'].includes(mode))throw new RangeError('Unknown fading mode');
    if(!Number.isFinite(maxDopplerHz)||maxDopplerHz<0||maxDopplerHz>40)throw new RangeError('Maximum Doppler must be 0–40 Hz');
    if(!Number.isFinite(kFactor)||kFactor<0||kFactor>1000)throw new RangeError('Rician K must be 0–1000 (linear power ratio)');
    if(!Number.isInteger(sinusoids)||sinusoids<8||sinusoids>128)throw new RangeError('Use 8–128 scattered rays');
    this.sampleRate=sampleRate;this.mode=mode;this.maxDopplerHz=maxDopplerHz;this.kFactor=mode==='rayleigh'?0:kFactor;
    this.sinusoids=sinusoids;this.seed=seed>>>0||1;this.i=1;this.q=0;this.power=1;
    // Doppler gains are slowly varying relative to RF. Update at >=1 kHz and
    // linearly interpolate complex I/Q, never envelope or post-demod audio.
    this.stride=Math.max(1,Math.floor(sampleRate/1000));this.gainRate=sampleRate/this.stride;this.position=0;this.updates=0;
    this.rayI=new Float64Array(sinusoids);this.rayQ=new Float64Array(sinusoids);
    this.rotationI=new Float64Array(sinusoids);this.rotationQ=new Float64Array(sinusoids);
    this.frequencyHz=new Float64Array(sinusoids);
    this.losGain=Math.sqrt(this.kFactor/(this.kFactor+1));this.scatterGain=1/Math.sqrt((this.kFactor+1)*sinusoids);
    if(mode==='static'){this.fromI=this.toI=1;this.fromQ=this.toQ=0;return;}
    // Stratified random angles avoid duplicate/opposite Doppler pairs, which
    // otherwise leave a single realization with improper I/Q covariance.
    // Independent phases give zero ensemble mean scattered gain.
    const offset=this.random()*TAU;
    for(let n=0;n<sinusoids;n++){
      const angle=TAU*(n+.1+.8*this.random())/sinusoids+offset,phase=this.random()*TAU;
      const f=maxDopplerHz*Math.cos(angle),step=TAU*f/this.gainRate;
      this.frequencyHz[n]=f;this.rayI[n]=Math.cos(phase);this.rayQ[n]=Math.sin(phase);
      this.rotationI[n]=Math.cos(step);this.rotationQ[n]=Math.sin(step);
    }
    this.sum();this.fromI=this.sumI;this.fromQ=this.sumQ;
    this.advance();this.toI=this.sumI;this.toQ=this.sumQ;
    this.i=this.fromI;this.q=this.fromQ;this.power=this.i*this.i+this.q*this.q;
  }
  random(){let x=this.seed;x^=x<<13;x^=x>>>17;x^=x<<5;this.seed=x>>>0;return(this.seed+.5)/4294967296;}
  sum(){let i=0,q=0;for(let n=0;n<this.sinusoids;n++){i+=this.rayI[n];q+=this.rayQ[n];}this.sumI=this.losGain+this.scatterGain*i;this.sumQ=this.scatterGain*q;}
  advance(){
    for(let n=0;n<this.sinusoids;n++){
      const i=this.rayI[n],q=this.rayQ[n],c=this.rotationI[n],s=this.rotationQ[n];
      this.rayI[n]=i*c-q*s;this.rayQ[n]=i*s+q*c;
    }
    if((++this.updates&4095)===0)for(let n=0;n<this.sinusoids;n++){const norm=Math.hypot(this.rayI[n],this.rayQ[n]);this.rayI[n]/=norm;this.rayQ[n]/=norm;}
    this.sum();
  }
  /** Updates scalar i/q/power fields; allocation-free. Multiply carrier I/Q by
   * this gain BEFORE adding receiver AWGN. Noise must not be faded with carrier. */
  tick(){
    if(this.mode==='static')return;
    const f=this.position/this.stride;
    this.i=this.fromI+(this.toI-this.fromI)*f;this.q=this.fromQ+(this.toQ-this.fromQ)*f;this.power=this.i*this.i+this.q*this.q;
    if(++this.position===this.stride){this.position=0;this.fromI=this.toI;this.fromQ=this.toQ;this.advance();this.toI=this.sumI;this.toQ=this.sumQ;}
  }
}
