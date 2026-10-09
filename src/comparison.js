import { renderRadio, sanitizeParams } from './dsp.js?v=sound-profiles-v1';

/** Fixed, shared-mask RMS matching, not perceptual loudness or speech recognition. */
export function prepareComparison(input, rate, settings, seed) {
  const p = sanitizeParams(settings);
  if (input.length < rate*.5) throw Error('至少需要 0.5 秒音频。');
  let peak = 0;
  for (const x of input) { if (!Number.isFinite(x) || Math.abs(x)>1) throw Error('源音频含无效或超满幅采样，请先检查输入。'); peak=Math.max(peak,Math.abs(x)); }
  if (peak<.0001 || !p.output) throw Error('音频太安静或输出音量为零，无法可靠匹配。');
  const wet=renderRadio(input,rate,{...p,mix:1,tx:true,vox:false,gateDry:false},seed);
  const dry=new Float32Array(wet.length);
  const delay=Math.round(rate*(p.perspective==='operator'&&p.permit!=='off'?.09:.024));
  for(let i=0;i<input.length;i++) dry[i+delay]=input[i]*p.output/100;
  const frame=Math.max(1,Math.round(rate*.02)), threshold=Math.max(1e-8,(peak*.03)**2);
  let dryPower=0,wetPower=0,count=0;
  // Initial cue and settling are excluded; mask is identical for both paths.
  for(let start=Math.round(rate*.12);start+frame<=input.length;start+=frame){
    let power=0;for(let j=start;j<start+frame;j++)power+=input[j]**2;
    if(power/frame<threshold)continue;
    for(let j=start+delay;j<start+frame+delay;j++){dryPower+=dry[j]**2;wetPower+=wet[j]**2;count++;}
  }
  if(count<rate*.3 || dryPower/count<1e-10 || wetPower/count<1e-10)throw Error('有效音频不足或效果静音，无法可靠匹配。');
  const dryRms=Math.sqrt(dryPower/count),wetRms=Math.sqrt(wetPower/count),target=Math.min(dryRms,wetRms);
  let dryGain=target/dryRms,wetGain=target/wetRms,max=0;
  for(let i=0;i<wet.length;i++)max=Math.max(max,Math.abs(dry[i]*dryGain),Math.abs(wet[i]*wetGain));
  const headroom=Math.min(1,.95/Math.max(max,1e-12));dryGain*=headroom;wetGain*=headroom;
  for(let i=0;i<wet.length;i++){dry[i]*=dryGain;wet[i]*=wetGain;}
  return {dry,wet,delaySamples:delay,dryGain,wetGain,measuredSeconds:count/rate,differenceDb:20*Math.log10(wetRms/dryRms)};
}
